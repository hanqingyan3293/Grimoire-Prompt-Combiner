import { mockComfyHttpFixture } from './test-support/comfy-http-fixture'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyHistoryResult, ComfyResultImage } from '../../shared/types'

let root = ''
const io = vi.hoisted(() => ({ submit: vi.fn(), history: vi.fn(), download: vi.fn(), locate: vi.fn(), client: vi.fn(), cancel: vi.fn(), log: vi.fn(), send: vi.fn(), derivatives: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: io.send } }] } }))
vi.mock('./logger.service', () => ({ logEvent: io.log }))
vi.mock('./wd14-worker', () => ({ wd14Worker: {} }))
vi.mock('./comfy-client', async importOriginal => ({ ...await importOriginal<typeof import('./comfy-client')>(), comfyUIClient: { baseUrl: 'http://127.0.0.1:8188' }, createComfyUIClient: io.client }))
vi.mock('../../integrations/cherry/comfy-source-adapter', async importOriginal => ({ ...await importOriginal<typeof import('../../integrations/cherry/comfy-source-adapter')>(), cancelComfyExecution: io.cancel }))
vi.mock('./media.service', async importOriginal => ({ ...await importOriginal<typeof import('./media.service')>(), createImageDerivatives: io.derivatives }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { taskRunner } from './task-runner'
import { cancelPersistedTask, createPersistedTask, getPersistedTask, prepareComfyExecution, retryPersistedTask, updateComfyExecution } from './task-repository'
import { importComfyWorkflow } from './comfy-workflow.service'
import { ComfyUIClient, ComfyUIError } from './comfy-client'

const realId = '22222222-2222-4222-8222-222222222222'
const endpoint = 'http://127.0.0.1:8188'
const done: ComfyHistoryResult = { status: 'done', images: [] }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const images: ComfyResultImage[] = ['a.png', 'b.png', 'c.png'].map(filename => ({ filename, subfolder: '', type: 'output', url: endpoint + '/view?filename=' + filename }))
let workflowId = ''; let cleanup: Array<() => void> = []
function barrier<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function deferred<T>(fallback: T) { const value = barrier<T>(); cleanup.push(() => value.resolve(fallback)); return value }
function signalRead<T>() {
  const entered = barrier<AbortSignal | undefined>()
  const read = vi.fn((_id: unknown, options?: { signal?: AbortSignal }) => new Promise<T>((_resolve, reject) => {
    const abort = () => reject(new DOMException('execution read fixture aborted', 'AbortError'))
    cleanup.push(abort)
    options?.signal?.addEventListener('abort', abort, { once: true })
    entered.resolve(options?.signal)
  }))
  return { entered: entered.promise, read }
}
function task() { return createPersistedTask({ kind: 'comfyui', input: { workflowId }, maxRetries: 2 }) }
function persisted(id: string) { return getPersistedTask(id)! }
async function status(id: string, value: string) { await vi.waitFor(() => expect(persisted(id).status).toBe(value), { interval: 10, timeout: 2000 }) }
function noFault(id: string) { expect(io.log.mock.calls.some(([level, , , details]) => (level === 'error' || level === 'warn') && details?.taskId === id && ['attempt-error', 'failure-persist'].includes(details?.phase))).toBe(false) }
function notifyCancel(id: string) { cancelPersistedTask(id); taskRunner.notifyCancellation(id) }
async function start() { taskRunner.start(); await vi.advanceTimersByTimeAsync(0) }

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-r6-runner-'))
  await initDatabase()
  workflowId = importComfyWorkflow('R6 fixture', { '1': { class_type: 'FixtureNode', inputs: {} } }).id
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-11-07T00:00:00.000Z'))
  vi.clearAllMocks(); cleanup = []
  io.submit.mockResolvedValue({ prompt_id: realId }); io.history.mockResolvedValue(done); io.download.mockResolvedValue(png)
  io.locate.mockResolvedValue({ known: false, stage: 'none', history: null }); io.derivatives.mockResolvedValue(undefined)
  io.cancel.mockResolvedValue({ outcome: 'remote-confirmed', targetedInterrupt: true, version: '0.3.57', evidence: 'execution_interrupted', writes: [] })
  io.client.mockImplementation((baseUrl: string) => ({ baseUrl, submit: io.submit, history: io.history, downloadImage: io.download, locate: io.locate }))
})
afterEach(async () => {
  taskRunner.stop()
  for (const release of cleanup) release()
  await vi.runOnlyPendingTimersAsync()
  await taskRunner.stopAndWait()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); closeDatabase(); fs.rmSync(root, { recursive: true, force: true })
})

describe('Comfy execution-level read ownership (C1 R6)', () => {
  it('public production notify aborts deferred history and cancels the exact real response ID', async () => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); const signal = await query.entered
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(persisted(created.id).execution?.requestedPromptId).not.toBe(realId)
    notifyCancel(created.id)
    expect(signal!.aborted).toBe(true)
    await taskRunner.stopAndWait()
    expect(persisted(created.id)).toMatchObject({ status: 'cancelled', retry_count: 0, error_code: 'TASK_CANCELLED', execution: { endpoint, promptId: realId, cancelOutcome: 'remote-confirmed' } })
    expect(io.cancel).toHaveBeenCalledWith({ endpoint, promptId: realId })
    expect(io.submit).toHaveBeenCalledTimes(1); expect(io.download).not.toHaveBeenCalled(); noFault(created.id)
  })

  it('notifying a different task leaves the active read untouched', async () => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); const signal = await query.entered
    expect(signal).toBeInstanceOf(AbortSignal)
    const other = task(); notifyCancel(other.id)
    expect(signal!.aborted).toBe(false)
    notifyCancel(created.id); await taskRunner.stopAndWait()
    expect(io.cancel).toHaveBeenCalledTimes(1)
    expect(io.cancel).toHaveBeenCalledWith({ endpoint, promptId: realId })
  })

  it('wakes deferred history on stopAndWait and durably queues the same read without a fault', async () => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); const signal = await query.entered
    const before = persisted(created.id)
    const drain = taskRunner.stopAndWait()
    expect(signal?.aborted).toBe(true)
    await drain
    expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: before.retry_count, next_attempt_at: before.next_attempt_at, error_code: null, execution: before.execution })
    expect(io.history).toHaveBeenCalledTimes(1); expect(io.submit).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0); noFault(created.id)
  })

  it('aborts a real pending image body and drains without POST replay or retry/fault increment', async () => {
    io.history.mockResolvedValue({ status: 'done', images: [images[0]] })
    const entered = barrier<AbortSignal>(); let body!: ReadableStreamDefaultController<Uint8Array>
    mockComfyHttpFixture(vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(value) { body = value; cleanup.push(() => body.error(new DOMException('test cleanup', 'AbortError'))) },
      pull() { entered.resolve(init!.signal!) },
    }, { highWaterMark: 0 }))))
    const realClient = new ComfyUIClient(endpoint)
    io.download.mockImplementationOnce(realClient.downloadImage.bind(realClient))
    const created = task(); await start(); const effective = await entered.promise
    const drain = taskRunner.stopAndWait()
    expect(effective.aborted).toBe(true)
    await drain
    expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: 0, error_code: null, execution: { phase: 'importing', promptId: realId, endpoint } })
    expect(io.submit).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); noFault(created.id)
    io.download.mockResolvedValue(png); taskRunner.start(); await status(created.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1); expect(persisted(created.id).retry_count).toBe(0)
  })

  it('stop/start during a delayed POST captures REAL != requested and queues a fresh same-ID read', async () => {
    const submitted = deferred({ prompt_id: realId }); io.submit.mockReturnValueOnce(submitted.promise)
    const created = task(); await start()
    const requested = persisted(created.id).execution!.requestedPromptId
    expect(requested).not.toBe(realId)
    expect(io.submit.mock.calls[0][1].signal).toBeUndefined()
    taskRunner.stop(); taskRunner.start(); submitted.resolve({ prompt_id: realId })
    await vi.advanceTimersByTimeAsync(0)
    expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: 0, execution: { phase: 'waiting', promptId: realId, requestedPromptId: requested } })
    expect(io.history).not.toHaveBeenCalled(); expect(io.submit).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250); await status(created.id, 'succeeded')
    expect(io.history.mock.calls[0][0]).toBe(realId)
    expect(io.history.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(io.history.mock.calls[0][1].signal.aborted).toBe(false)
    expect(io.submit).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1)
  })

  it('stop/start while an old read is pending discards only that controller and resumes with a new one', async () => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); const old = await query.entered
    const drain = taskRunner.stopAndWait(); taskRunner.start()
    expect(old?.aborted).toBe(true); await drain
    await vi.advanceTimersByTimeAsync(250); await status(created.id, 'succeeded')
    const fresh = io.history.mock.calls[1][1].signal
    expect(fresh).toBeInstanceOf(AbortSignal); expect(fresh).not.toBe(old); expect(fresh.aborted).toBe(false)
    expect(io.history.mock.calls.map(([id]) => id)).toEqual([realId, realId]); expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it.each(['submitting', 'submit-uncertain'] as const)('stops an unconfirmed %s reconciliation and resumes requested-ID GET only', async phase => {
    const created = task()
    const prepared = prepareComfyExecution(created.id, endpoint, { frozenWorkflow: { '1': { class_type: 'FixtureNode', inputs: {} } } })
    const raw = getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [created.id])[0].values[0][0] as string
    updateComfyExecution(created.id, raw, { ...prepared.execution!, phase })
    const locate = signalRead<{ known: boolean }>(); io.locate.mockImplementationOnce(locate.read)
    await start(); const signal = await locate.entered
    const drain = taskRunner.stopAndWait(); expect(signal?.aborted).toBe(true); await drain
    expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: 0, execution: { phase: 'submit-uncertain', promptId: null, requestedPromptId: prepared.execution!.requestedPromptId } })
    taskRunner.start(); await status(created.id, 'failed')
    expect(io.locate.mock.calls.map(([id]) => id)).toEqual([prepared.execution!.requestedPromptId, prepared.execution!.requestedPromptId])
    expect(io.locate.mock.calls[1][1].signal).not.toBe(signal)
    expect(io.submit).not.toHaveBeenCalled(); expect(io.history).not.toHaveBeenCalled()
    expect(() => retryPersistedTask(created.id)).toThrow('TASK_REPLAY_BLOCKED')
  })

  it('does not reconcile with an aborted read after an in-flight POST becomes uncertain on stop', async () => {
    const submitted = deferred({ prompt_id: realId }); io.submit.mockReturnValueOnce(submitted.promise)
    const created = task(); await start(); const requested = persisted(created.id).execution!.requestedPromptId
    const drain = taskRunner.stopAndWait()
    submitted.reject(new ComfyUIError('COMFY_TIMEOUT', 'uncertain delayed POST', true))
    await drain
    expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: 0, execution: { phase: 'submit-uncertain', promptId: null, requestedPromptId: requested } })
    expect(io.locate).not.toHaveBeenCalled(); expect(io.submit).toHaveBeenCalledTimes(1); noFault(created.id)
    taskRunner.start(); await status(created.id, 'failed')
    expect(io.locate.mock.calls[0][0]).toBe(requested); expect(io.submit).toHaveBeenCalledTimes(1)
    expect(() => retryPersistedTask(created.id)).toThrow('TASK_REPLAY_BLOCKED')
  })

  it('public cancellation never aborts the delayed POST and cancels the real ACK after it returns', async () => {
    const submitted = deferred({ prompt_id: realId }); io.submit.mockReturnValueOnce(submitted.promise)
    const created = task(); await start(); notifyCancel(created.id)
    expect(io.submit.mock.calls[0][1].signal).toBeUndefined()
    submitted.resolve({ prompt_id: realId }); await taskRunner.stopAndWait()
    expect(persisted(created.id)).toMatchObject({ status: 'cancelled', retry_count: 0, execution: { promptId: realId, phase: 'waiting', cancelOutcome: 'remote-confirmed' } })
    expect(io.cancel).toHaveBeenCalledWith({ endpoint, promptId: realId }); expect(io.history).not.toHaveBeenCalled(); expect(io.submit).toHaveBeenCalledTimes(1)
  })
})

describe('Comfy durable read park / partial settlement (C1 R6)', () => {
  it.each(['write', 'commit'] as const)('retains a settlement-only owner across read requeue %s failure and recovers without business replay', async boundary => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); const signal = await query.entered
    const db = getDatabase(); const write = db.run.bind(db); const execute = db.exec.bind(db)
    const deadline = new Date(Date.now() + 2000).toISOString()
    db.run('UPDATE task_jobs SET progress=?, next_attempt_at=? WHERE id=?', [0.42, deadline, created.id])
    let blocked = true; let parking = false
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (/UPDATE task_jobs SET status='queued'/.test(sql)) {
        if (blocked && boundary === 'write') throw new Error('read requeue write fixture')
        parking = true
      }
      return write(sql, parameters)
    })
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => {
      if (sql === 'COMMIT' && parking) { parking = false; if (blocked && boundary === 'commit') throw new Error('read requeue COMMIT fixture') }
      if (sql === 'ROLLBACK') parking = false
      return execute(sql, parameters)
    })
    try {
      const drain = taskRunner.stopAndWait(); expect(signal?.aborted).toBe(true)
      await expect(drain).rejects.toThrow('TASK_READ_RESUME_PERSIST_PENDING')
      expect(getDatabase()).toBe(db)
      expect(persisted(created.id)).toMatchObject({ status: 'running', retry_count: 0, progress: 0.42, next_attempt_at: deadline, execution: { promptId: realId, phase: 'waiting' } })
      blocked = false; await taskRunner.stopAndWait()
      expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: 0, progress: 0.42, next_attempt_at: deadline })
      expect(io.history).toHaveBeenCalledTimes(1); expect(io.submit).toHaveBeenCalledTimes(1)
      taskRunner.start(); await vi.advanceTimersByTimeAsync(Date.parse(deadline) - Date.now() - 1)
      expect(io.history).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(251); await status(created.id, 'succeeded')
      expect(io.submit).toHaveBeenCalledTimes(1); expect(persisted(created.id).retry_count).toBe(0)
    } finally { blocked = false }
  })

  it('keeps a stopped read owner across DB lookup errors rather than treating the identity as absent', async () => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); await query.entered
    const db = getDatabase(); const execute = db.exec.bind(db); let blocked = true
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => {
      if (blocked && /SELECT .* FROM task_jobs WHERE id/.test(sql)) throw new Error('read park lookup fixture')
      return execute(sql, parameters)
    })
    try {
      await expect(taskRunner.stopAndWait()).rejects.toThrow('TASK_READ_RESUME_PERSIST_PENDING')
      blocked = false; await taskRunner.stopAndWait()
      expect(persisted(created.id)).toMatchObject({ status: 'queued', retry_count: 0, execution: { promptId: realId, phase: 'waiting' } })
      expect(io.submit).toHaveBeenCalledTimes(1); expect(io.history).toHaveBeenCalledTimes(1)
    } finally { blocked = false }
  })

  it('cancellation arriving after a failed drain wins over the retained read park owner', async () => {
    const query = signalRead<ComfyHistoryResult>(); io.history.mockImplementationOnce(query.read)
    const created = task(); await start(); await query.entered
    getDatabase().exec("CREATE TRIGGER block_read_park BEFORE UPDATE ON task_jobs WHEN NEW.status='queued' BEGIN SELECT RAISE(ABORT,'read park fixture'); END")
    try {
      await expect(taskRunner.stopAndWait()).rejects.toThrow('TASK_READ_RESUME_PERSIST_PENDING')
      notifyCancel(created.id)
      await taskRunner.stopAndWait()
      expect(persisted(created.id)).toMatchObject({ status: 'cancelled', retry_count: 0, execution: { promptId: realId, cancelOutcome: 'remote-confirmed' } })
      expect(io.cancel).toHaveBeenCalledWith({ endpoint, promptId: realId })
      expect(io.submit).toHaveBeenCalledTimes(1); expect(io.history).toHaveBeenCalledTimes(1)
    } finally { getDatabase().exec('DROP TRIGGER block_read_park') }
  })

  it('retains the cancelled attempt partial result across a terminal write failure without another remote/business attempt', async () => {
    io.history.mockResolvedValue({ status: 'done', images: images.slice(0, 2) })
    const second = signalRead<Buffer>()
    io.download.mockImplementation((image: ComfyResultImage, options?: { signal?: AbortSignal }) => image.filename === 'b.png' ? second.read(image, options) : Promise.resolve(png))
    const created = task(); await start(); await second.entered
    getDatabase().exec("CREATE TRIGGER block_cancel_partial BEFORE UPDATE ON task_jobs WHEN NEW.status='cancelled' BEGIN SELECT RAISE(ABORT,'cancel partial write fixture'); END")
    try {
      notifyCancel(created.id)
      await expect(taskRunner.stopAndWait()).rejects.toThrow('TASK_READ_RESUME_PERSIST_PENDING')
      expect(persisted(created.id).status).toBe('cancelling')
      getDatabase().exec('DROP TRIGGER block_cancel_partial')
      await taskRunner.stopAndWait()
      const saved = persisted(created.id); const output = JSON.parse(saved.output_json!)
      expect(saved).toMatchObject({ status: 'cancelled', retry_count: 0, execution: { cancelOutcome: 'remote-confirmed' } })
      expect(output.imageIds).toHaveLength(1)
      expect(output.imageResults).toEqual([expect.objectContaining({ filename: 'a.png', status: 'imported' }), expect.objectContaining({ filename: 'b.png', status: 'pending' })])
      expect(io.cancel).toHaveBeenCalledTimes(1); expect(io.download).toHaveBeenCalledTimes(2); expect(io.submit).toHaveBeenCalledTimes(1)
    } finally { getDatabase().exec('DROP TRIGGER IF EXISTS block_cancel_partial') }
  })

  it('retains the cancelled partial owner when a single terminal write fails and the ordinary scheduler keeps running', async () => {
    io.history.mockResolvedValue({ status: 'done', images })
    const second = signalRead<Buffer>()
    io.download.mockImplementation((image: ComfyResultImage, options?: { signal?: AbortSignal }) => image.filename === 'b.png' ? second.read(image, options) : Promise.resolve(png))
    const created = task(); await start(); await second.entered
    const db = getDatabase(); const write = db.run.bind(db); let rejectTerminal = true
    vi.spyOn(db, 'run').mockImplementation((sql, parameters) => {
      if (rejectTerminal && sql.startsWith('UPDATE task_jobs SET status=') && parameters?.[0] === 'cancelled') { rejectTerminal = false; throw new Error('one cancelled partial write fixture') }
      return write(sql, parameters)
    })
    notifyCancel(created.id)
    await vi.waitFor(() => expect(rejectTerminal).toBe(false), { interval: 10, timeout: 2000 })
    expect(persisted(created.id).status).toBe('cancelling')
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(5250)
    await status(created.id, 'cancelled')
    expect(JSON.parse(persisted(created.id).output_json || 'null')).toMatchObject({
      imageIds: [expect.any(Number)],
      imageResults: [expect.objectContaining({ filename: 'a.png', status: 'imported', imageId: expect.any(Number) }), expect.objectContaining({ filename: 'b.png', status: 'pending' }), expect.objectContaining({ filename: 'c.png', status: 'pending' })],
    })
    expect(io.cancel).toHaveBeenCalledTimes(1)
    expect(io.download).toHaveBeenCalledTimes(2)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('carries the retained business failure partial into cancellation after its queued write failed', async () => {
    io.history.mockResolvedValue({ status: 'done', images: images.slice(0, 2) })
    io.download.mockImplementation(async (image: ComfyResultImage) => {
      if (image.filename === 'b.png') throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'pending image fixture', true)
      return png
    })
    const created = task(); const db = getDatabase(); const write = db.run.bind(db); let rejectQueued = true
    vi.spyOn(db, 'run').mockImplementation((sql, parameters) => {
      if (rejectQueued && sql.startsWith('UPDATE task_jobs SET status=') && parameters?.[0] === 'queued') { rejectQueued = false; throw new Error('partial failure queued write fixture') }
      return write(sql, parameters)
    })
    await start()
    await vi.waitFor(() => expect(io.log.mock.calls.some(([, , , details]) => details?.taskId === created.id && details.phase === 'failure-persist')).toBe(true), { interval: 10, timeout: 2000 })
    expect(persisted(created.id)).toMatchObject({ status: 'running', retry_count: 0, execution: { phase: 'importing', promptId: realId } })
    notifyCancel(created.id)
    await vi.advanceTimersByTimeAsync(250)
    await status(created.id, 'cancelled')
    expect(JSON.parse(persisted(created.id).output_json || 'null')).toMatchObject({ imageIds: [expect.any(Number)], imageResults: [expect.objectContaining({ filename: 'a.png', status: 'imported' }), expect.objectContaining({ filename: 'b.png', status: 'pending' })] })
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.download).toHaveBeenCalledTimes(2)
    expect(io.cancel).toHaveBeenCalledTimes(1)
  })

  it('reports an undrained retained business failure before closing and writes only its original result after DB recovery', async () => {
    io.history.mockRejectedValue(new ComfyUIError('COMFY_HTTP_400', 'permanent history fixture', false, 400))
    const created = task()
    getDatabase().exec("CREATE TRIGGER block_failure_drain BEFORE UPDATE ON task_jobs WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'failure drain fixture'); END")
    try {
      await start()
      await vi.waitFor(() => expect(io.log.mock.calls.some(([, , , details]) => details?.taskId === created.id && details.phase === 'failure-persist')).toBe(true), { interval: 10, timeout: 2000 })
      await expect(taskRunner.stopAndWait()).rejects.toThrow('TASK_RESULT_PERSIST_PENDING')
      expect(persisted(created.id).status).toBe('running')
      getDatabase().exec('DROP TRIGGER block_failure_drain')
      await taskRunner.stopAndWait()
      const saved = persisted(created.id)
      expect(saved).toMatchObject({ status: 'failed', retry_count: 0, error_code: 'COMFY_POST_SUBMIT_FAILURE', execution: { promptId: realId, phase: 'waiting' } })
      expect(saved.error_message).toContain('permanent history fixture')
      expect(saved.error_message).toContain(realId)
      expect(io.submit).toHaveBeenCalledTimes(1)
      expect(io.history).toHaveBeenCalledTimes(1)
    } finally { getDatabase().exec('DROP TRIGGER IF EXISTS block_failure_drain') }
  })

  it.each([false, true])('drains retained business partial before exit with cancellation=%s without another operation', async cancel => {
    io.history.mockResolvedValue({ status: 'done', images: images.slice(0, 2) })
    io.download.mockImplementation(async (image: ComfyResultImage) => {
      if (image.filename === 'b.png') throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'retained download fixture', true)
      return png
    })
    const created = task(); const db = getDatabase(); const write = db.run.bind(db); let rejectQueued = true
    vi.spyOn(db, 'run').mockImplementation((sql, parameters) => {
      if (rejectQueued && sql.startsWith('UPDATE task_jobs SET status=') && parameters?.[0] === 'queued') { rejectQueued = false; throw new Error('retained partial queue fixture') }
      return write(sql, parameters)
    })
    await start()
    await vi.waitFor(() => expect(io.log.mock.calls.some(([, , , details]) => details?.taskId === created.id && details.phase === 'failure-persist')).toBe(true), { interval: 10, timeout: 2000 })
    if (cancel) notifyCancel(created.id)
    await taskRunner.stopAndWait()
    const saved = persisted(created.id)
    expect(saved).toMatchObject({ status: cancel ? 'cancelled' : 'failed', retry_count: 0, execution: { promptId: realId, phase: 'importing' } })
    expect(JSON.parse(saved.output_json || 'null')).toMatchObject({ imageIds: [expect.any(Number)], imageResults: [expect.objectContaining({ filename: 'a.png', status: 'imported' }), expect.objectContaining({ filename: 'b.png', status: 'pending' })] })
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.download).toHaveBeenCalledTimes(2)
    expect(io.cancel).toHaveBeenCalledTimes(cancel ? 1 : 0)
  })

  it('keeps already committed image facts when a resumed import is stopped during temporary directory creation', async () => {
    io.history.mockResolvedValue({ status: 'done', images })
    const second = signalRead<Buffer>()
    io.download.mockImplementation((image: ComfyResultImage, options?: { signal?: AbortSignal }) => image.filename === 'b.png' ? second.read(image, options) : Promise.resolve(png))
    const created = task(); await start(); await second.entered
    await taskRunner.stopAndWait()
    const previous = JSON.parse(persisted(created.id).output_json!)
    expect(previous.imageIds).toHaveLength(1)
    io.download.mockResolvedValue(png)
    const entered = barrier<void>(); const release = barrier<void>(); const mkdtemp = fs.promises.mkdtemp.bind(fs.promises)
    cleanup.push(() => release.resolve())
    vi.spyOn(fs.promises, 'mkdtemp').mockImplementation(async prefix => {
      const directory = await mkdtemp(prefix)
      entered.resolve()
      await release.promise
      return directory
    })
    try {
      await start(); await entered.promise
      const draining = taskRunner.stopAndWait()
      release.resolve(); await draining
      const saved = persisted(created.id)
      expect(saved).toMatchObject({ status: 'queued', retry_count: 0, execution: { promptId: realId, phase: 'importing' } })
      expect(JSON.parse(saved.output_json!)).toMatchObject({ imageIds: previous.imageIds, imageResults: previous.imageResults })
      expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
      expect(io.download).toHaveBeenCalledTimes(2)
      expect(io.submit).toHaveBeenCalledTimes(1)
    } finally { release.resolve() }
  })

  it.each(['write', 'commit'] as const)('keeps a proven unsent prepared identity retryable after the first submitting %s fails', async mode => {
    const created = task()
    const prepared = prepareComfyExecution(created.id, endpoint, { workflowId, frozenWorkflow: { '1': { class_type: 'FixtureNode', inputs: {} } } })
    const db = getDatabase(); const write = db.run.bind(db); const execute = db.exec.bind(db)
    let rejectSubmitting = true; let submittingCommit = false
    vi.spyOn(db, 'run').mockImplementation((sql, parameters) => {
      const submitting = sql.startsWith('UPDATE task_jobs SET execution_json=') && String(parameters?.[0]).includes('"phase":"submitting"')
      if (rejectSubmitting && submitting) {
        if (mode === 'write') { rejectSubmitting = false; throw new Error('unsent submitting write fixture') }
        submittingCommit = true
      }
      return write(sql, parameters)
    })
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => {
      if (sql === 'COMMIT' && submittingCommit) { submittingCommit = false; rejectSubmitting = false; throw new Error('unsent submitting commit fixture') }
      if (sql === 'ROLLBACK') submittingCommit = false
      return execute(sql, parameters)
    })
    try {
      await start(); await status(created.id, 'failed')
      const failed = persisted(created.id)
      expect(io.submit).not.toHaveBeenCalled()
      expect(failed).toMatchObject({ error_code: 'COMFY_PREPARE_FAILED', execution: { phase: 'prepared', requestedPromptId: prepared.execution!.requestedPromptId, promptId: null } })
      expect(failed.input_json).toBe(prepared.input_json)
      const retried = retryPersistedTask(created.id)
      await vi.advanceTimersByTimeAsync(Math.max(0, Date.parse(retried.next_attempt_at!) - Date.now()) + 250)
      await status(created.id, 'succeeded')
      expect(io.submit).toHaveBeenCalledTimes(1)
      expect(io.submit.mock.calls[0][1]).toEqual({ requestedPromptId: prepared.execution!.requestedPromptId })
      expect(persisted(created.id).input_json).toBe(prepared.input_json)
    } finally { rejectSubmitting = false; submittingCommit = false }
  })

  it.each(['cancel', 'stop'] as const)('persists image A partial output and leaves B/C pending on %s during download', async mode => {
    io.history.mockResolvedValue({ status: 'done', images })
    const second = signalRead<Buffer>()
    io.download.mockImplementation((image: ComfyResultImage, options?: { signal?: AbortSignal }) => image.filename === 'b.png' ? second.read(image, options) : Promise.resolve(png))
    const created = task(); await start(); const signal = await second.entered
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
    if (mode === 'cancel') notifyCancel(created.id)
    const drain = taskRunner.stopAndWait(); expect(signal!.aborted).toBe(true); await drain
    expect(persisted(created.id)).toMatchObject({ status: mode === 'cancel' ? 'cancelled' : 'queued', retry_count: 0, execution: { phase: 'importing', promptId: realId } })
    const output = JSON.parse(persisted(created.id).output_json!)
    expect(output.imageIds).toHaveLength(1)
    expect(output.imageResults).toEqual([expect.objectContaining({ filename: 'a.png', status: 'imported' }), expect.objectContaining({ filename: 'b.png', status: 'pending' }), expect.objectContaining({ filename: 'c.png', status: 'pending' })])
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
    expect(getDatabase().exec("SELECT count(*) FROM media_relations WHERE target_key=?", [created.id])[0].values[0][0]).toBe(1)
    expect(io.download).toHaveBeenCalledTimes(2); noFault(created.id)
    if (mode === 'stop') { io.download.mockResolvedValue(png); taskRunner.start(); await status(created.id, 'succeeded'); expect(io.download).toHaveBeenCalledTimes(4) }
    expect(io.submit).toHaveBeenCalledTimes(1)
  })
})
