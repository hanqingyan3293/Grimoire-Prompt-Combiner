import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import * as repository from './task-repository'
import { taskEvent, transitionTask } from './task-state'
import { serializeComfyExecution, type ComfyExecutionState } from '../../shared/comfy-execution'
import type { TaskKind, TaskRecord } from '../../shared/task-types'

const at = new Date('2026-11-07T00:00:00.000Z')
const failure = { error_code: 'WORKER_TEMPORARY', error_message: 'temporary fixture failure' }
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-task-repository-'))
  await initDatabase()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

function running(kind: TaskKind = 'wd14', maxRetries = 2): TaskRecord {
  const task = repository.createPersistedTask({ kind, input: { fixture: true }, maxRetries })
  return repository.updatePersistedTask(task.id, transitionTask(task, 'running', {}, at))
}

function fail(task: TaskRecord, allowRetry = true) {
  return repository.failAndRetryPersistedTask(task.id, failure, { allowRetry, now: at })
}

const endpoint = 'http://127.0.0.1:8188'
const requested = '11111111-1111-4111-8111-111111111111'
const real = '22222222-2222-4222-8222-222222222222'
const otherReal = '33333333-3333-4333-8333-333333333333'

function comfy(input: unknown = { workflowId: 'fixture', values: { seed: 1 } }): TaskRecord {
  return repository.createPersistedTask({ kind: 'comfyui', input })
}

function frozenInput() {
  return { prompt: { '1': { class_type: 'KSampler', inputs: { seed: 7 } } } }
}

function prepare(task: TaskRecord, input: unknown = frozenInput()): TaskRecord {
  return repository.prepareComfyExecution(task.id, endpoint, input)
}

function executionRaw(id: string): string | null {
  const value = getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [id])[0]?.values?.[0]?.[0]
  return value == null ? null : String(value)
}

function executionOf(task: TaskRecord): ComfyExecutionState {
  if (!task.execution) throw new Error('fixture task has no execution state')
  return task.execution
}

describe('task repository atomic lifecycle (P2)', () => {
  it('atomically turns a running failure into one queued retry with a persisted deadline', () => {
    const task = running()
    const next = fail(task)
    expect(next).toMatchObject({ id: task.id, status: 'queued', retry_count: 1, next_attempt_at: '2026-11-07T00:00:01.000Z', error_code: failure.error_code, error_message: failure.error_message, started_at: null, finished_at: null })
    expect(repository.getPersistedTask(task.id)).toEqual(next)
  })

  it('defaults to no automatic replay when the caller has no retry evidence', () => {
    const task = running('comfyui')
    const next = repository.failAndRetryPersistedTask(task.id, failure, { now: at })
    expect(next).toMatchObject({ status: 'failed', retry_count: 0, error_code: failure.error_code, finished_at: at.toISOString(), next_attempt_at: null })
  })

  it('keeps the existing retry limit and exponential delay sequence', () => {
    let task = running('wd14', 5)
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      task = fail(task)
      expect(Date.parse(task.next_attempt_at!) - at.getTime()).toBe(delay)
      task = repository.updatePersistedTask(task.id, transitionTask(task, 'running', {}, at))
    }
    const exhausted = fail(task)
    expect(exhausted).toMatchObject({ status: 'failed', retry_count: 5, next_attempt_at: null })
  })

  it('settles cancellation before an otherwise retryable failure', () => {
    const task = running()
    repository.cancelPersistedTask(task.id)
    const next = fail(task)
    expect(next).toMatchObject({ status: 'cancelled', retry_count: 0, error_code: 'TASK_CANCELLED' })
    expect(repository.getPersistedTask(task.id)).toEqual(next)
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('does not overwrite the %s terminal result with a late failure', terminal => {
    const task = running()
    const done = repository.updatePersistedTask(task.id, transitionTask(task, terminal === 'cancelled' ? 'cancelling' : terminal, {}, at))
    const finished = terminal === 'cancelled' ? repository.updatePersistedTask(task.id, transitionTask(done, 'cancelled', {}, at)) : done
    expect(fail(task)).toEqual(finished)
  })

  it('does not apply the same failure again after it already queued a retry', () => {
    const task = running()
    const queued = fail(task)
    expect(() => fail(task)).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(task.id)).toEqual(queued)
  })

  it.each(['ABORT', 'ROLLBACK'])('retains the running row and counter after SQLite %s rejects the atomic write', mode => {
    const task = running()
    getDatabase().exec(`CREATE TRIGGER fail_retry BEFORE UPDATE ON task_jobs WHEN NEW.status='queued' BEGIN SELECT RAISE(${mode},'atomic retry fixture'); END`)
    expect(() => fail(task)).toThrow(/atomic retry fixture/)
    expect(repository.getPersistedTask(task.id)).toEqual(task)
  })

  it('does not return a fake queued row when COMMIT fails', () => {
    const task = running()
    const db = getDatabase(); const execute = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => { if (sql === 'COMMIT') throw new Error('commit fixture'); return execute(sql, parameters) })
    expect(() => fail(task)).toThrow(/commit fixture/)
    expect(repository.getPersistedTask(task.id)).toEqual(task)
  })

  it('rejects a stale success after cancellation has been requested', () => {
    const task = running()
    const cancelling = repository.cancelPersistedTask(task.id)
    expect(() => repository.updatePersistedTask(task.id, transitionTask(task, 'succeeded', { output_json: '{"fixture":true}' }))).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(task.id)).toEqual(cancelling)
  })

  it('rejects a late terminal rewrite and a mismatched task identity', () => {
    const task = running()
    const done = repository.updatePersistedTask(task.id, transitionTask(task, 'succeeded', {}, at))
    expect(() => repository.updatePersistedTask(task.id, { ...done, status: 'failed' })).toThrow(/TASK_STATE_CONFLICT/)
    const other = running()
    expect(() => repository.updatePersistedTask(other.id, { ...other, id: task.id })).toThrow(/TASK_ID_MISMATCH/)
    expect(repository.getPersistedTask(task.id)).toEqual(done)
    expect(repository.getPersistedTask(other.id)).toEqual(other)
  })

  it.each(['COMFY_SUBMIT_UNCERTAIN', 'COMFY_POST_SUBMIT_FAILURE', 'COMFY_HTTP_503', 'APP_RESTARTED'])('blocks blind manual replay of a Comfy failure classified %s', code => {
    const task = running('comfyui')
    const failed = repository.updatePersistedTask(task.id, transitionTask(task, 'failed', { error_code: code }, at))
    expect(() => repository.retryPersistedTask(task.id)).toThrow(/TASK_REPLAY_BLOCKED/)
    expect(repository.getPersistedTask(task.id)).toEqual(failed)
  })

  it('still permits an explicit retry of an unsubmitted preparation failure', () => {
    const task = running('comfyui')
    const failed = repository.updatePersistedTask(task.id, transitionTask(task, 'failed', { error_code: 'COMFY_PREPARE_FAILED' }, at))
    expect(repository.retryPersistedTask(failed.id)).toMatchObject({ status: 'queued', retry_count: 1 })
  })

  it('reads an explicit column projection rather than coupling to SELECT-star order', () => {
    const task = running()
    const spy = vi.spyOn(getDatabase(), 'exec')
    expect(repository.getPersistedTask(task.id)).toEqual(task)
    expect(repository.listPersistedTasks('running')).toEqual([task])
    expect(spy.mock.calls.filter(([sql]) => /SELECT/i.test(sql)).every(([sql]) => !/SELECT\s+\*/i.test(sql))).toBe(true)
  })

  it('keeps same-timestamp queued tasks in insertion order rather than random id order', () => {
    repository.createPersistedTask({ id: 'z_first', kind: 'wd14', input: {} })
    repository.createPersistedTask({ id: 'a_second', kind: 'wd14', input: {} })
    expect(repository.listPersistedTasks('queued').map(task => task.id)).toEqual(['z_first', 'a_second'])
  })

  it('keeps the retry deadline and failure diagnostics after reopening the database', async () => {
    const task = running()
    const queued = fail(task)
    closeDatabase()
    await initDatabase()
    expect(repository.getPersistedTask(task.id)).toEqual(queued)
  })
})

describe('task repository Comfy execution identity (C1)', () => {
  it('creates every task with an explicit NULL execution identity', () => {
    const task = comfy({ workflowId: 'fixture' })
    expect(task.execution).toBeNull()
    expect(executionRaw(task.id)).toBeNull()
    expect(repository.getPersistedTask(task.id)).toEqual(task)
  })

  it('freezes the endpoint and input while minting one canonical requested UUID', () => {
    const task = comfy()
    const input = frozenInput()
    const prepared = prepare(task, input)
    expect(prepared.execution).toMatchObject({ version: 1, endpoint, phase: 'prepared', promptId: null, cancelOutcome: 'none' })
    expect(executionOf(prepared).requestedPromptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(prepared.input_json).toBe(JSON.stringify(input))
    expect(prepared.status).toBe('queued')
    expect(repository.getPersistedTask(task.id)).toEqual(prepared)
  })

  it('returns the exact existing state on repeated prepare without changing IDs or input', () => {
    const task = comfy()
    const first = prepare(task)
    const second = repository.prepareComfyExecution(task.id, 'http://127.0.0.1:9000/', { different: true })
    expect(second).toEqual(first)
    expect(executionOf(second).requestedPromptId).toBe(executionOf(first).requestedPromptId)
    expect(second.input_json).toBe(first.input_json)
    expect(second.updated_at).toBe(first.updated_at)
  })

  it('prepares a running Comfy task and keeps the running status and attempt fields', () => {
    const task = prepare(running('comfyui'))
    expect(task.status).toBe('running')
    expect(task.retry_count).toBe(0)
    expect(task.started_at).not.toBeNull()
    expect(executionOf(task).phase).toBe('prepared')
  })

  it('rejects a non-Comfy task without changing it', () => {
    const task = running('wd14')
    expect(() => prepare(task)).toThrow(/Comfy/i)
    expect(repository.getPersistedTask(task.id)).toEqual(task)
  })

  it.each(['failed', 'succeeded', 'cancelled', 'paused'] as const)('only prepares queued or running tasks, not %s', status => {
    const task = status === 'cancelled' ? comfy() : running('comfyui')
    const persisted = repository.updatePersistedTask(task.id, transitionTask(task, status, {}, at))
    expect(() => prepare(persisted)).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(task.id)).toEqual(persisted)
  })

  it.each([
    'http://user:pass@127.0.0.1:8188',
    'http://127.0.0.1:8188?token=1',
    'http://127.0.0.1:8188#fragment',
    'http://127.0.0.1:8188?',
    'http://127.0.0.1:8188#',
    'http://example.com:8188',
    'ftp://127.0.0.1:8188',
  ])('rejects endpoint %j during the main-process write and keeps the row untouched', value => {
    const task = comfy()
    const before = repository.getPersistedTask(task.id)!
    expect(() => repository.prepareComfyExecution(task.id, value, frozenInput())).toThrow()
    expect(repository.getPersistedTask(task.id)).toEqual(before)
  })

  it('rejects input that cannot be frozen as JSON without a partial write', () => {
    const task = comfy()
    const before = repository.getPersistedTask(task.id)!
    expect(() => prepare(task, { bad: BigInt(1) })).toThrow()
    expect(repository.getPersistedTask(task.id)).toEqual(before)
  })

  it.each(['ABORT', 'ROLLBACK'])('rolls back a rejected prepare after SQLite %s', mode => {
    const task = comfy()
    const before = repository.getPersistedTask(task.id)!
    getDatabase().exec(`CREATE TRIGGER prepare_failure BEFORE UPDATE ON task_jobs WHEN NEW.execution_json IS NOT NULL BEGIN SELECT RAISE(${mode},'prepare fixture'); END`)
    expect(() => prepare(task)).toThrow(/prepare fixture/)
    expect(repository.getPersistedTask(task.id)).toEqual(before)
  })

  it('does not return a prepared row when COMMIT fails', () => {
    const task = comfy()
    const before = repository.getPersistedTask(task.id)!
    const db = getDatabase(); const execute = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => { if (sql === 'COMMIT') throw new Error('prepare commit fixture'); return execute(sql, parameters) })
    expect(() => prepare(task)).toThrow(/prepare commit fixture/)
    expect(repository.getPersistedTask(task.id)).toEqual(before)
  })

  it('keeps the frozen endpoint, input and requested ID across a database reopen', async () => {
    const prepared = prepare(comfy())
    closeDatabase()
    await initDatabase()
    expect(repository.getPersistedTask(prepared.id)).toEqual(prepared)
  })

  it('does not clear execution through an ordinary lifecycle update or an old-shaped record', () => {
    const prepared = prepare(running('comfyui'))
    const legacy = { ...prepared, execution: undefined } as TaskRecord
    const updated = repository.updatePersistedTask(prepared.id, { ...legacy, progress: 0.5 })
    expect(updated.progress).toBe(0.5)
    expect(updated.execution).toEqual(prepared.execution)
    expect(taskEvent(updated).execution).toEqual(prepared.execution)
  })

  it('walks prepared to submitting to waiting to importing while preserving task fields', () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const waiting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    const importing = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(waiting), phase: 'importing' })
    expect([submitting.execution?.phase, waiting.execution?.phase, importing.execution?.phase]).toEqual(['submitting', 'waiting', 'importing'])
    expect(importing).toMatchObject({ status: 'running', retry_count: 0, error_code: null, error_message: null, next_attempt_at: null, input_json: prepared.input_json })
    expect(executionOf(importing)).toMatchObject({ endpoint, requestedPromptId: executionOf(prepared).requestedPromptId, promptId: real })
    expect(repository.getPersistedTask(prepared.id)).toEqual(importing)
  })

  it('rejects a stale raw execution value with zero writes', () => {
    const prepared = prepare(running('comfyui'))
    const raw = executionRaw(prepared.id)
    repository.updateComfyExecution(prepared.id, raw, { ...executionOf(prepared), phase: 'submitting' })
    const before = repository.getPersistedTask(prepared.id)!
    expect(() => repository.updateComfyExecution(prepared.id, raw, { ...executionOf(before), phase: 'waiting', promptId: real })).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(prepared.id)).toEqual(before)
  })

  it('refuses to create execution state through update on a legacy NULL row', () => {
    const task = comfy()
    expect(() => repository.updateComfyExecution(task.id, null, { version: 1, endpoint, phase: 'prepared', requestedPromptId: requested, promptId: null, cancelOutcome: 'none' })).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(task.id)).toEqual(task)
  })

  it('keeps endpoint and requested ID immutable and never replaces a real prompt ID', () => {
    const prepared = prepare(running('comfyui'))
    const current = executionOf(prepared)
    expect(() => repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...current, endpoint: 'http://127.0.0.1:9000' })).toThrow(/endpoint/i)
    expect(() => repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...current, requestedPromptId: otherReal })).toThrow(/requestedPromptId/i)
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...current, phase: 'submitting' })
    const waiting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    const raw = executionRaw(prepared.id)
    expect(() => repository.updateComfyExecution(prepared.id, raw, { ...executionOf(waiting), promptId: otherReal })).toThrow(/promptId/i)
    expect(() => repository.updateComfyExecution(prepared.id, raw, { ...executionOf(waiting), promptId: null })).toThrow(/promptId/i)
    expect(repository.getPersistedTask(prepared.id)).toEqual(waiting)
  })

  it.each([
    ['prepared to importing', 'prepared', 'importing', real],
    ['prepared to waiting', 'prepared', 'waiting', real],
    ['waiting to submitting', 'waiting', 'submitting', real],
  ] as const)('rejects the illegal phase transition %s', (_label, from, to, promptId) => {
    const prepared = prepare(running('comfyui'))
    let current = prepared
    let raw = executionRaw(prepared.id)
    if (from === 'waiting') {
      current = repository.updateComfyExecution(prepared.id, raw, { ...executionOf(prepared), phase: 'submitting' })
      current = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(current), phase: 'waiting', promptId: real })
      raw = executionRaw(prepared.id)
    }
    const before = repository.getPersistedTask(prepared.id)!
    expect(() => repository.updateComfyExecution(prepared.id, raw, { ...executionOf(current), phase: to, promptId })).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(prepared.id)).toEqual(before)
  })

  it('persists a real submit acknowledgement on a cancelling row without changing status or cancel intent', () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const cancelling = repository.cancelPersistedTask(prepared.id)
    const acknowledged = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    expect(cancelling.status).toBe('cancelling')
    expect(acknowledged.status).toBe('cancelling')
    expect(acknowledged.execution).toMatchObject({ phase: 'waiting', promptId: real, cancelOutcome: 'none', requestedPromptId: executionOf(submitting).requestedPromptId })
    expect(acknowledged.input_json).toBe(prepared.input_json)
  })

  it('records a real ack and then remote cancellation on an already cancelled row without touching the task result', () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const cancelling = repository.cancelPersistedTask(prepared.id)
    const cancelled = repository.updatePersistedTask(prepared.id, transitionTask(cancelling, 'cancelled', {}, at))
    const acknowledged = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    expect(acknowledged.status).toBe('cancelled')
    const local = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(acknowledged), cancelOutcome: 'local-only' })
    const remote = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(local), cancelOutcome: 'remote-confirmed' })
    expect(remote.status).toBe('cancelled')
    expect(remote.finished_at).toBe(cancelled.finished_at)
    expect(remote.execution).toMatchObject({ phase: 'waiting', endpoint, requestedPromptId: executionOf(prepared).requestedPromptId, promptId: real, cancelOutcome: 'remote-confirmed' })
    expect(remote.input_json).toBe(prepared.input_json)
  })

  it.each(['failed', 'succeeded'] as const)('rejects execution changes on a terminal %s task', terminal => {
    const prepared = prepare(running('comfyui'))
    const finished = repository.updatePersistedTask(prepared.id, transitionTask(prepared, terminal, {}, at))
    expect(() => repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), cancelOutcome: 'local-only' })).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(prepared.id)).toEqual(finished)
  })

  it('does not rewrite a remote-confirmed cancellation outcome', () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const waiting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real, cancelOutcome: 'remote-confirmed' })
    const before = repository.getPersistedTask(prepared.id)!
    expect(() => repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(waiting), cancelOutcome: 'failed' })).toThrow(/cancelOutcome/i)
    expect(repository.getPersistedTask(prepared.id)).toEqual(before)
  })

  it.each(['ABORT', 'ROLLBACK'])('keeps the row unchanged when SQLite %s rejects an execution CAS write', mode => {
    const prepared = prepare(running('comfyui'))
    const before = repository.getPersistedTask(prepared.id)!
    getDatabase().exec(`CREATE TRIGGER update_failure BEFORE UPDATE ON task_jobs WHEN NEW.execution_json IS NOT NULL BEGIN SELECT RAISE(${mode},'update fixture'); END`)
    expect(() => repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })).toThrow(/update fixture/)
    expect(repository.getPersistedTask(prepared.id)).toEqual(before)
  })

  it('does not return an updated row when COMMIT fails', () => {
    const prepared = prepare(running('comfyui'))
    const before = repository.getPersistedTask(prepared.id)!
    const db = getDatabase(); const execute = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => { if (sql === 'COMMIT') throw new Error('update commit fixture'); return execute(sql, parameters) })
    expect(() => repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })).toThrow(/update commit fixture/)
    expect(repository.getPersistedTask(prepared.id)).toEqual(before)
  })

  it('guards the CAS write with id, status, retry_count and the exact execution value', () => {
    const prepared = prepare(running('comfyui'))
    const spy = vi.spyOn(getDatabase(), 'run')
    repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const sql = spy.mock.calls.map(([statement]) => String(statement)).find(statement => /UPDATE task_jobs SET execution_json/.test(statement))
    expect(sql).toBeDefined()
    expect(sql).toMatch(/WHERE id=\?/)
    expect(sql).toMatch(/status=\?/)
    expect(sql).toMatch(/retry_count=\?/)
    expect(sql).toMatch(/execution_json IS \?/)
  })

  it('keeps execution and existing failure/backoff fields through failure, manual retry and interrupt recovery', () => {
    const prepared = prepare(running('comfyui'))
    const failed = repository.failAndRetryPersistedTask(prepared.id, { error_code: 'COMFY_PREPARE_FAILED', error_message: 'prepare fixture' }, { now: at })
    expect(failed).toMatchObject({ status: 'failed', retry_count: 0, error_code: 'COMFY_PREPARE_FAILED', next_attempt_at: null })
    expect(failed.execution).toEqual(prepared.execution)
    const retried = repository.retryPersistedTask(prepared.id)
    expect(retried).toMatchObject({ status: 'queued', retry_count: 1, next_attempt_at: '2026-11-07T00:00:01.000Z' })
    expect(retried.execution).toEqual(prepared.execution)
    const interrupted = prepare(repository.updatePersistedTask(prepared.id, transitionTask(retried, 'running', {}, at)))
    expect(repository.markInterruptedTasks()).toBe(1)
    // A prepared identity has not reached POST yet, so recovery may resume it.
    expect(repository.getPersistedTask(prepared.id)).toMatchObject({ status: 'queued', error_code: null, retry_count: 1 })
    expect(repository.getPersistedTask(prepared.id)?.execution).toEqual(interrupted.execution)
  })

  it('keeps a waiting identity across a database reopen', async () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const waiting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    closeDatabase()
    await initDatabase()
    expect(repository.getPersistedTask(prepared.id)).toEqual(waiting)
    expect(executionRaw(prepared.id)).toBe(serializeComfyExecution(executionOf(waiting)))
  })
})

describe('task repository C1 R6 durable read park', () => {
  it.each(['submitting', 'submit-uncertain'] as const)('requeues %s only through an explicit read-only reconciliation path', phase => {
    const prepared = prepare(running('comfyui'))
    const uncertain = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase })
    const deadline = '2026-11-07T00:00:05.000Z'
    repository.updatePersistedTask(prepared.id, { ...uncertain, next_attempt_at: deadline, progress: 0.4 })
    const raw = executionRaw(prepared.id)
    expect(() => repository.requeueComfyReadTask(prepared.id)).toThrow('TASK_STATE_CONFLICT')
    const next = repository.requeueComfyReadTask(prepared.id, { reconcileUnconfirmed: true })
    expect(next).toMatchObject({ status: 'queued', retry_count: 0, next_attempt_at: deadline, progress: 0.4, input_json: prepared.input_json, execution: uncertain.execution })
    expect(executionRaw(prepared.id)).toBe(raw)
    const active = repository.updatePersistedTask(prepared.id, transitionTask(next, 'running'))
    repository.failAndRetryPersistedTask(active.id, { error_code: 'COMFY_SUBMIT_UNCERTAIN', error_message: 'still unproven' })
    expect(() => repository.retryPersistedTask(prepared.id)).toThrow('TASK_REPLAY_BLOCKED')
  })

  it('does not admit a prepared or legacy NULL identity through reconciliation', () => {
    const prepared = prepare(running('comfyui')); const legacy = running('comfyui')
    for (const task of [prepared, legacy]) {
      expect(() => repository.requeueComfyReadTask(task.id, { reconcileUnconfirmed: true })).toThrow('TASK_STATE_CONFLICT')
      expect(repository.getPersistedTask(task.id)).toEqual(task)
    }
  })

  it('atomically parks importing and its truthful partial output without changing the accepted identity', () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const waiting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    const importing = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(waiting), phase: 'importing' })
    const partial = JSON.stringify({ version: 1, promptId: real, imageIds: [1], imageResults: [{ filename: 'a.png', status: 'imported' }, { filename: 'b.png', status: 'pending' }] })
    const raw = executionRaw(prepared.id)
    const next = repository.requeueComfyReadTask(prepared.id, { outputJson: partial, expected: { retryCount: 0, state: executionOf(importing) } })
    expect(next).toMatchObject({ status: 'queued', retry_count: 0, output_json: partial, execution: importing.execution })
    expect(executionRaw(prepared.id)).toBe(raw)
  })

  it.each(['attempt', 'identity'] as const)('does zero park writes for a stale %s owner', boundary => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const waiting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
    const before = repository.getPersistedTask(prepared.id)
    const state = boundary === 'identity' ? { ...executionOf(waiting), promptId: otherReal } : executionOf(waiting)
    expect(() => repository.requeueComfyReadTask(prepared.id, { expected: { retryCount: boundary === 'attempt' ? 1 : 0, state } })).toThrow('TASK_STATE_CONFLICT')
    expect(repository.getPersistedTask(prepared.id)).toEqual(before)
  })
})

describe('task repository C1 recovery and corrupt-row projection', () => {
  function waiting(task: TaskRecord = running('comfyui')): TaskRecord {
    const prepared = prepare(task)
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    return repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(submitting), phase: 'waiting', promptId: real })
  }

  it('returns a per-row blocked DTO for corrupt execution JSON instead of failing the whole list', () => {
    const first = comfy(); const bad = comfy(); const later = comfy()
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', ['{bad json', bad.id])
    const listed = repository.listPersistedTasks('queued')
    expect(listed.map(task => task.id)).toEqual(expect.arrayContaining([first.id, bad.id, later.id]))
    const blocked = listed.find(task => task.id === bad.id)!
    expect(blocked.execution).toBeNull()
    expect(blocked.execution_error).toMatch(/^COMFY_EXECUTION_INVALID: /)
    expect(blocked.execution_error).not.toContain('{bad json')
    expect(repository.getPersistedTask(bad.id)?.execution_error).toBe(blocked.execution_error)
    expect(repository.getPersistedTask(first.id)?.execution_error).toBeUndefined()
  })

  it('settles a corrupt identity explicitly and leaves normal rows untouched', () => {
    const bad = comfy(); const good = comfy()
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', ['{"version":2}', bad.id])
    const failed = repository.failInvalidExecutionTask(bad.id)
    expect(failed).toMatchObject({ status: 'failed', error_code: 'COMFY_EXECUTION_INVALID', retry_count: 0 })
    expect(failed.execution_error).toMatch(/COMFY_EXECUTION_INVALID/)
    expect(repository.getPersistedTask(good.id)).toMatchObject({ status: 'queued', execution: null })
  })

  it('exposes the exact persisted execution text and never re-serializes a formatted legacy value', () => {
    const prepared = prepare(running('comfyui'))
    const formatted = JSON.stringify(executionOf(prepared), null, 2)
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', [formatted, prepared.id])
    const snapshot = repository.getComfyExecutionSnapshot(prepared.id)!
    expect(snapshot.raw).toBe(formatted)
    const submitted = repository.updateComfyExecution(prepared.id, snapshot.raw, { ...snapshot.state, phase: 'submitting' })
    expect(submitted.execution?.phase).toBe('submitting')
    const compact = executionRaw(prepared.id)
    expect(compact).not.toBe(formatted)
    expect(() => repository.updateComfyExecution(prepared.id, formatted, { ...snapshot.state, phase: 'waiting', promptId: real })).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(prepared.id)?.execution?.phase).toBe('submitting')
  })

  it('refuses to update an unreadable execution value without writing', () => {
    const task = comfy()
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', ['[]', task.id])
    expect(() => repository.updateComfyExecution(task.id, '[]', { version: 1, endpoint, phase: 'submitting', requestedPromptId: requested, promptId: null, cancelOutcome: 'none' })).toThrow(/TASK_EXECUTION_INVALID/)
    expect(executionRaw(task.id)).toBe('[]')
  })

  it('requeues a running waiting identity for the same GET and preserves input/deadline', () => {
    const task = waiting()
    const deadline = '2026-11-07T00:00:05.000Z'
    const rawBefore = executionRaw(task.id)
    repository.updatePersistedTask(task.id, { ...repository.getPersistedTask(task.id)!, next_attempt_at: deadline })
    expect(repository.markInterruptedTasks()).toBe(1)
    const recovered = repository.getPersistedTask(task.id)!
    expect(recovered).toMatchObject({ status: 'queued', error_code: null, next_attempt_at: deadline })
    expect(recovered.execution).toEqual(task.execution)
    expect(recovered.input_json).toBe(task.input_json)
    expect(executionRaw(task.id)).toBe(rawBefore)
  })

  it('turns an interrupted submitting identity into explicit submit-uncertain without changing its IDs', () => {
    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    expect(repository.markInterruptedTasks()).toBe(1)
    const recovered = repository.getPersistedTask(prepared.id)!
    expect(recovered).toMatchObject({ status: 'queued' })
    expect(recovered.execution).toMatchObject({ phase: 'submit-uncertain', endpoint, requestedPromptId: executionOf(submitting).requestedPromptId, promptId: null })
    expect(recovered.input_json).toBe(prepared.input_json)
  })

  it('keeps the old APP_RESTARTED policy for a NULL identity and for WD14', () => {
    const comfyNull = running('comfyui'); const wd14 = running('wd14')
    expect(repository.markInterruptedTasks()).toBe(2)
    expect(repository.getPersistedTask(comfyNull.id)).toMatchObject({ status: 'failed', error_code: 'APP_RESTARTED', execution: null })
    expect(repository.getPersistedTask(wd14.id)).toMatchObject({ status: 'failed', error_code: 'APP_RESTARTED' })
  })

  it('keeps a cancelling row and its identity for the runner owner path', () => {
    const task = waiting()
    const cancelling = repository.cancelPersistedTask(task.id)
    repository.markInterruptedTasks()
    const recovered = repository.getPersistedTask(task.id)!
    expect(recovered.status).toBe('cancelling')
    expect(recovered.execution).toEqual(cancelling.execution)
  })

  it('requeues an acknowledged read after persistence recovery without incrementing retries or changing the deadline', () => {
    const task = waiting()
    const deadline = '2026-11-07T00:00:05.000Z'
    repository.updatePersistedTask(task.id, { ...task, next_attempt_at: deadline })
    const raw = executionRaw(task.id)
    const next = repository.requeueComfyReadTask(task.id)
    expect(next).toMatchObject({ status: 'queued', retry_count: task.retry_count, max_retries: task.max_retries, next_attempt_at: deadline, started_at: null, finished_at: null })
    expect(next.input_json).toBe(task.input_json)
    expect(executionRaw(task.id)).toBe(raw)
    expect(repository.requeueComfyReadTask(task.id)).toEqual(next)
  })

  it('does not requeue an unacknowledged or cancelling identity as a normal read', () => {
    const prepared = prepare(running('comfyui'))
    expect(() => repository.requeueComfyReadTask(prepared.id)).toThrow(/TASK_STATE_CONFLICT/)
    const task = waiting()
    const cancelling = repository.cancelPersistedTask(task.id)
    expect(() => repository.requeueComfyReadTask(task.id)).toThrow(/TASK_STATE_CONFLICT/)
    expect(repository.getPersistedTask(task.id)).toEqual(cancelling)
  })

  it('rolls back read requeue when its COMMIT fails', () => {
    const task = waiting()
    const before = repository.getPersistedTask(task.id)
    const db = getDatabase(); const execute = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => { if (sql === 'COMMIT') throw new Error('read requeue commit fixture'); return execute(sql, parameters) })
    expect(() => repository.requeueComfyReadTask(task.id)).toThrow(/read requeue commit fixture/)
    expect(repository.getPersistedTask(task.id)).toEqual(before)
  })

  it('allows a manual retry only when it can resume reads, never an unproven submit', () => {
    const waitingTask = waiting()
    const failedWaiting = repository.failAndRetryPersistedTask(waitingTask.id, { error_code: 'COMFY_POST_SUBMIT_FAILURE', error_message: 'query' }, { now: at })
    expect(failedWaiting.status).toBe('failed')
    expect(repository.retryPersistedTask(waitingTask.id)).toMatchObject({ status: 'queued', execution: { phase: 'waiting', promptId: real } })

    const prepared = prepare(running('comfyui'))
    const submitting = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const failedSubmit = repository.failAndRetryPersistedTask(submitting.id, { error_code: 'COMFY_SUBMIT_UNCERTAIN', error_message: 'unknown' }, { now: at })
    expect(failedSubmit.status).toBe('failed')
    expect(() => repository.retryPersistedTask(submitting.id)).toThrow(/TASK_REPLAY_BLOCKED/)
  })

  it('reopens a mixed legacy/corrupt/read/import/uncertain/cancelling/WD14/terminal database without erasing identities or deadlines', async () => {
    const legacy = running('comfyui'); const bad = running('comfyui')
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', ['{broken mixed fixture', bad.id])
    const read = waiting()
    const delayed = repository.failAndRetryPersistedTask(read.id, { error_code: 'COMFY_QUERY_TRANSIENT', error_message: 'mixed delay' }, { allowRetry: true, now: at })
    repository.updatePersistedTask(read.id, transitionTask(delayed, 'running'))
    const importTask = waiting()
    const importing = repository.updateComfyExecution(importTask.id, executionRaw(importTask.id), { ...executionOf(importTask), phase: 'importing' })
    const partial = JSON.stringify({ version: 1, imageIds: [7], imageResults: [] })
    repository.updatePersistedTask(importing.id, { ...importing, progress: 0.4, output_json: partial, next_attempt_at: '2026-11-07T00:00:05.000Z' })
    const prepared = prepare(running('comfyui'))
    const unknown = repository.updateComfyExecution(prepared.id, executionRaw(prepared.id), { ...executionOf(prepared), phase: 'submitting' })
    const cancelTask = waiting(); const cancelling = repository.cancelPersistedTask(cancelTask.id)
    const wd14 = running('wd14')
    const sealed = waiting(); const terminal = repository.updatePersistedTask(sealed.id, transitionTask(sealed, 'succeeded', { output_json: '{"sealed":true}' }))
    const inputsBefore = [read, importing, unknown].map(task => repository.getPersistedTask(task.id)!.input_json)
    closeDatabase(); await initDatabase(); vi.setSystemTime(new Date('2026-11-07T00:00:10.000Z'))
    expect(repository.markInterruptedTasks()).toBe(6)
    expect(repository.getPersistedTask(legacy.id)).toMatchObject({ status: 'failed', error_code: 'APP_RESTARTED', execution: null })
    expect(repository.getPersistedTask(bad.id)).toMatchObject({ status: 'failed', error_code: 'COMFY_EXECUTION_INVALID', execution: null })
    expect(executionRaw(bad.id)).toBe('{broken mixed fixture')
    expect(repository.getPersistedTask(read.id)).toMatchObject({ status: 'queued', retry_count: 1, next_attempt_at: delayed.next_attempt_at, execution: { endpoint, phase: 'waiting', promptId: real } })
    expect(repository.getPersistedTask(importing.id)).toMatchObject({ status: 'queued', progress: 0.4, output_json: partial, next_attempt_at: '2026-11-07T00:00:05.000Z', execution: { endpoint, phase: 'importing', promptId: real } })
    expect(repository.getPersistedTask(unknown.id)).toMatchObject({ status: 'queued', execution: { phase: 'submit-uncertain', requestedPromptId: unknown.execution!.requestedPromptId, promptId: null } })
    expect(repository.getPersistedTask(cancelling.id)).toEqual(cancelling)
    expect(repository.getPersistedTask(wd14.id)).toMatchObject({ status: 'failed', error_code: 'APP_RESTARTED' })
    expect(repository.getPersistedTask(terminal.id)).toEqual(terminal)
    expect([read, importing, unknown].map(task => repository.getPersistedTask(task.id)!.input_json)).toEqual(inputsBefore)
  })

  it.each(['waiting', 'importing'] as const)('keeps committed partial output and progress during a manual same-ID %s read retry', phase => {
    let task = waiting()
    if (phase === 'importing') task = repository.updateComfyExecution(task.id, executionRaw(task.id), { ...executionOf(task), phase })
    const partial = JSON.stringify({ version: 1, imageIds: [7], imageResults: [{ filename: 'a.png', subfolder: '', type: 'output', status: 'imported', imageId: 7, errorCode: null, errorMessage: null }, { filename: 'b.png', subfolder: '', type: 'output', status: 'pending', imageId: null, errorCode: null, errorMessage: null }] })
    repository.updatePersistedTask(task.id, { ...task, progress: 0.4 })
    const failed = repository.failAndRetryPersistedTask(task.id, { error_code: 'COMFY_QUERY_TRANSIENT', error_message: 'read retry fixture', output_json: partial }, { allowRetry: false, now: at })
    const before = executionRaw(task.id)
    const retried = repository.retryPersistedTask(task.id)
    expect(retried).toMatchObject({ status: 'queued', retry_count: 1, progress: 0.4, output_json: partial, execution: { phase, promptId: real }, next_attempt_at: '2026-11-07T00:00:01.000Z' })
    expect(retried.input_json).toBe(failed.input_json)
    expect(executionRaw(task.id)).toBe(before)
  })

  it('never reopens a corrupt identity through manual retry', () => {
    const task = comfy()
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', ['{broken', task.id])
    const blocked = repository.getPersistedTask(task.id)!
    const failed = repository.failInvalidExecutionTask(task.id)
    expect(failed.error_code).toBe('COMFY_EXECUTION_INVALID')
    expect(blocked.execution_error).toBeTruthy()
    expect(() => repository.retryPersistedTask(task.id)).toThrow(/TASK_REPLAY_BLOCKED/)
  })
})
