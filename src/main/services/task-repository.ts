import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import type { TaskCreateInput, TaskRecord, TaskStatus } from '../../shared/task-types'
import { createTask, retryTask, transitionTask } from './task-state'
import { parseComfyExecution, requireComfyExecutionEndpoint, serializeComfyExecution, type ComfyExecutionPhase, type ComfyExecutionState } from '../../shared/comfy-execution'
import { requireComfyAddress } from './input-validation'
import { getTaskRetryMode } from '../../shared/task-policy'

const TASK_COLUMNS = 'id, kind, status, input_json, output_json, error_code, error_message, progress, retry_count, max_retries, created_at, started_at, finished_at, updated_at, next_attempt_at, execution_json'
const TERMINAL = new Set<TaskStatus>(['succeeded', 'failed', 'cancelled'])
const PHASE_TRANSITIONS: Record<ComfyExecutionPhase, ComfyExecutionPhase[]> = {
  prepared: ['prepared', 'submitting', 'submit-uncertain'],
  submitting: ['submitting', 'waiting', 'submit-uncertain'],
  waiting: ['waiting', 'importing'],
  importing: ['importing'],
  'submit-uncertain': ['submit-uncertain', 'waiting'],
}

export class TaskRepositoryError extends Error {
  constructor(readonly code: 'TASK_NOT_FOUND'|'TASK_ID_MISMATCH'|'TASK_STATE_CONFLICT'|'TASK_REPLAY_BLOCKED'|'TASK_EXECUTION_INVALID', message: string) {
    super(code + ': ' + message)
    this.name = 'TaskRepositoryError'
  }
}

function rollbackTaskWrite(): void {
  try { getDatabase().exec('ROLLBACK') } catch (error) { console.debug('[tasks] rollback already settled', error instanceof Error ? error.message : String(error)) }
}

function rowToTask(row: unknown[]): TaskRecord {
  const task: TaskRecord = {
    id: String(row[0]),
    kind: row[1] as TaskRecord['kind'],
    status: row[2] as TaskStatus,
    input_json: String(row[3]),
    output_json: row[4] == null ? null : String(row[4]),
    error_code: row[5] == null ? null : String(row[5]),
    error_message: row[6] == null ? null : String(row[6]),
    progress: Number(row[7]),
    retry_count: Number(row[8]),
    max_retries: Number(row[9]),
    created_at: String(row[10]),
    started_at: row[11] == null ? null : String(row[11]),
    finished_at: row[12] == null ? null : String(row[12]),
    updated_at: String(row[13]),
    next_attempt_at: row[14] == null ? null : String(row[14]),
    execution: null,
  }
  const raw = row[15] == null ? null : String(row[15])
  if (raw === null) {
    task.execution = null
  } else {
    try {
      task.execution = parseComfyExecution(raw)
    } catch (error) {
      // One corrupt identity must not make listPersistedTasks()/getPersistedTask()
      // throw and hide the whole queue. The DTO names the row as blocked; the
      // raw JSON is intentionally not exposed to the renderer.
      task.execution = null
      task.execution_error = 'COMFY_EXECUTION_INVALID: ' + (error instanceof Error ? error.message : String(error))
    }
  }
  return task
}

export interface ComfyExecutionSnapshot {
  raw: string
  state: ComfyExecutionState
}

interface PersistedTaskRead {
  task: TaskRecord
  executionRaw: string | null
  executionError: string | null
}

function readPersistedTask(id: string): PersistedTaskRead | null {
  const result = getDatabase().exec('SELECT ' + TASK_COLUMNS + ' FROM task_jobs WHERE id=?', [id])
  const row = result[0]?.values?.[0]
  if (!row) return null
  const task = rowToTask(row)
  return { task, executionRaw: row[15] == null ? null : String(row[15]), executionError: task.execution_error || null }
}

export function createPersistedTask(input: TaskCreateInput): TaskRecord {
  const db = getDatabase()
  const task = createTask(input)
  db.run(`INSERT INTO task_jobs (id, kind, status, input_json, output_json, error_code, error_message, progress, retry_count, max_retries, created_at, started_at, finished_at, updated_at, next_attempt_at, execution_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    task.id, task.kind, task.status, task.input_json, task.output_json, task.error_code, task.error_message, task.progress, task.retry_count, task.max_retries, task.created_at, task.started_at, task.finished_at, task.updated_at, task.next_attempt_at, task.execution ?? null,
  ])
  saveDatabase()
  return task
}

export function listPersistedTasks(status?: TaskStatus): TaskRecord[] {
  const db = getDatabase()
  const result = status
    ? db.exec('SELECT ' + TASK_COLUMNS + ' FROM task_jobs WHERE status=? ORDER BY created_at ASC, rowid ASC', [status])
    : db.exec('SELECT ' + TASK_COLUMNS + ' FROM task_jobs ORDER BY created_at DESC, rowid DESC')
  return (result[0]?.values || []).map(rowToTask)
}

export function getPersistedTask(id: string): TaskRecord | null {
  return readPersistedTask(id)?.task ?? null
}

/**
 * Exact persisted execution identity for CAS writers. Callers must pass
 * raw back unchanged; re-serializing a formatted legacy value would make
 * every legitimate update look stale.
 */
export function getComfyExecutionSnapshot(id: string): ComfyExecutionSnapshot | null {
  const read = readPersistedTask(id)
  if (!read) return null
  if (read.executionError) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', read.executionError)
  if (read.executionRaw === null) return null
  const state = read.task.execution
  if (!state) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', 'Comfy execution 状态不可读')
  return { raw: read.executionRaw, state }
}

function persistTask(next: TaskRecord, expected: TaskRecord): TaskRecord {
  if (next.id !== expected.id) throw new TaskRepositoryError('TASK_ID_MISMATCH', '任务身份不一致')
  // execution_json is intentionally absent from lifecycle writes: a caller that passes an
  // older TaskRecord shape must never erase the frozen Comfy identity. Only prepare/update CAS
  // write that column.
  const result = getDatabase().run(`UPDATE task_jobs SET status=?, output_json=?, error_code=?, error_message=?, progress=?, retry_count=?, max_retries=?, started_at=?, finished_at=?, updated_at=?, next_attempt_at=? WHERE id=? AND status=? AND retry_count=?`, [
    next.status, next.output_json, next.error_code, next.error_message, next.progress, next.retry_count, next.max_retries, next.started_at, next.finished_at, next.updated_at, next.next_attempt_at, expected.id, expected.status, expected.retry_count,
  ])
  if (Number(result.changes) !== 1) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务状态已经变化')
  return getPersistedTask(expected.id)!
}

export function updatePersistedTask(id: string, next: TaskRecord): TaskRecord {
  if (next.id !== id) throw new TaskRepositoryError('TASK_ID_MISMATCH', '任务身份不一致')
  const current = getPersistedTask(id)
  if (!current) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
  if (TERMINAL.has(current.status) || current.retry_count !== next.retry_count) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '终态或新尝试保留，旧结果已失效')
  if (current.status !== next.status) {
    try { transitionTask(current, next.status) } catch { throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务状态转换已经失效') }
  }
  const written = persistTask(next, current)
  saveDatabase()
  return written
}

export function cancelPersistedTask(id: string): TaskRecord {
  const task = getPersistedTask(id)
  if (!task) throw new Error('任务不存在')
  if (task.status === 'queued') {
    const ownsRemote = task.kind === 'comfyui' && task.execution != null && (
      task.execution.promptId != null
      || task.execution.phase === 'submitting'
      || task.execution.phase === 'submit-uncertain'
      || task.execution.phase === 'waiting'
      || task.execution.phase === 'importing'
    )
    return updatePersistedTask(id, transitionTask(task, ownsRemote ? 'cancelling' : 'cancelled'))
  }
  if (task.status === 'running') return updatePersistedTask(id, transitionTask(task, 'cancelling'))
  if (task.status === 'paused') return updatePersistedTask(id, transitionTask(task, 'cancelling'))
  throw new Error('当前任务状态不可取消')
}

export function retryPersistedTask(id: string): TaskRecord {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const task = getPersistedTask(id)
    if (!task) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
    const next = retryTask(task)
    const mode = getTaskRetryMode(task)
    if (task.kind === 'comfyui' && mode === 'none') throw new TaskRepositoryError('TASK_REPLAY_BLOCKED', '原任务没有可核实的未提交阶段；重新生成请创建新任务')
    if (mode === 'read') { next.output_json = task.output_json; next.progress = task.progress }
    const written = persistTask(next, task)
    db.exec('COMMIT')
    saveDatabase()
    return written
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

/** Failure and optional backoff are one durable write, never a persisted failed half-step. */
export function failAndRetryPersistedTask(id: string, failure: { error_code: string; error_message: string; output_json?: string }, options: { allowRetry?: boolean; now?: Date } = {}): TaskRecord {
  const db = getDatabase()
  const now = options.now || new Date()
  db.exec('BEGIN IMMEDIATE')
  try {
    const task = getPersistedTask(id)
    if (!task) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
    if (TERMINAL.has(task.status)) { db.exec('COMMIT'); return task }
    let next: TaskRecord
    if (task.status === 'cancelling') next = transitionTask(task, 'cancelled', { error_code: 'TASK_CANCELLED', error_message: '任务已取消', next_attempt_at: null }, now)
    else {
      if (task.status !== 'running') throw new TaskRepositoryError('TASK_STATE_CONFLICT', '失败结果不属于当前运行尝试')
      const failed = transitionTask(task, 'failed', { ...failure, next_attempt_at: null }, now)
      const replayable = task.kind !== 'comfyui' || canAutoReplayComfyFailure(task, failure.error_code)
      next = options.allowRetry === true && replayable && task.retry_count < task.max_retries
        ? { ...retryTask(failed, now), ...failure }
        : failed
    }
    const written = persistTask(next, task)
    db.exec('COMMIT')
    saveDatabase()
    return written
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

function canAutoReplayComfyFailure(task: TaskRecord, code: string): boolean {
  if (task.execution_error) return false
  if (code === 'COMFY_PREPARE_FAILED') return task.execution == null || task.execution.phase === 'prepared'
  // Only a transient read of an already-admitted prompt may back off and
  // resume. An unknown POST result is never converted into an automatic POST.
  return code === 'COMFY_QUERY_TRANSIENT'
    && task.execution != null
    && task.execution.promptId != null
    && (task.execution.phase === 'waiting' || task.execution.phase === 'importing')
}

/** Park an owned read after stop/drain. Unconfirmed IDs require an explicit
 * reconciliation-only path; no phase is reset to prepared and manual replay stays gated. */
export function requeueComfyReadTask(id: string, options: { reconcileUnconfirmed?: boolean; outputJson?: string; expected?: { retryCount: number; state: ComfyExecutionState } } = {}): TaskRecord {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const read = readPersistedTask(id)
    if (!read) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
    const task = read.task
    if (read.executionError) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', read.executionError)
    const state = task.execution
    const confirmedRead = state?.promptId != null && ['waiting', 'importing'].includes(state.phase)
    const reconciliation = options.reconcileUnconfirmed === true && state?.requestedPromptId != null
      && state.promptId === null && ['submitting', 'submit-uncertain'].includes(state.phase)
    if (task.kind !== 'comfyui' || !state || (!confirmedRead && !reconciliation)) {
      throw new TaskRepositoryError('TASK_STATE_CONFLICT', '只有已确认读取或显式只读核验的 ComfyUI 任务可以恢复')
    }
    const expected = options.expected
    if (expected && (task.retry_count !== expected.retryCount || state.endpoint !== expected.state.endpoint
      || state.requestedPromptId !== expected.state.requestedPromptId || state.promptId !== expected.state.promptId || state.phase !== expected.state.phase)) {
      throw new TaskRepositoryError('TASK_STATE_CONFLICT', '恢复读取不属于当前执行身份或尝试')
    }
    if (task.status === 'queued') { db.exec('COMMIT'); return task }
    if (task.status !== 'running') throw new TaskRepositoryError('TASK_STATE_CONFLICT', '取消或终态任务保留原状态')
    const result = db.run("UPDATE task_jobs SET status='queued', started_at=NULL, finished_at=NULL, updated_at=?, output_json=? WHERE id=? AND status='running' AND retry_count=? AND execution_json IS ?", [
      new Date().toISOString(), options.outputJson ?? task.output_json, id, task.retry_count, read.executionRaw,
    ])
    if (Number(result.changes) !== 1) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '恢复读取的任务已经变化')
    db.exec('COMMIT')
    saveDatabase()
    return getPersistedTask(id)!
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

export function markInterruptedTasks(): number {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  let changes = 0
  try {
    const now = new Date().toISOString()
    const result = db.exec('SELECT ' + TASK_COLUMNS + " FROM task_jobs WHERE status IN ('running','cancelling')")
    for (const row of result[0]?.values || []) {
      const task = rowToTask(row)
      const raw = row[15] == null ? null : String(row[15])
      if (task.kind !== 'comfyui') {
        const failed = db.run("UPDATE task_jobs SET status='failed', error_code='APP_RESTARTED', error_message='应用重启时任务未完成', finished_at=?, updated_at=? WHERE id=? AND status IN ('running','cancelling')", [now, now, task.id])
        changes += Number(failed.changes)
        continue
      }
      if (task.execution_error) {
        const failed = db.run("UPDATE task_jobs SET status='failed', error_code='COMFY_EXECUTION_INVALID', error_message=?, finished_at=?, updated_at=? WHERE id=? AND status IN ('running','cancelling')", [task.execution_error.slice(0, 1000), now, now, task.id])
        changes += Number(failed.changes)
        continue
      }
      const state = task.execution
      if (!state) {
        const failed = db.run("UPDATE task_jobs SET status='failed', error_code='APP_RESTARTED', error_message='应用重启时任务未完成，且没有可恢复的 ComfyUI 身份', finished_at=?, updated_at=? WHERE id=? AND status IN ('running','cancelling')", [now, now, task.id])
        changes += Number(failed.changes)
        continue
      }
      if (task.status === 'cancelling') {
        // Keep the cancellation intent. The runner owns the remote attempt; a
        // restart cannot pretend the remote cancel happened.
        continue
      }
      if (state.phase === 'waiting' || state.phase === 'importing' || state.phase === 'prepared') {
        const resumed = db.run("UPDATE task_jobs SET status='queued', error_code=NULL, error_message=NULL, started_at=NULL, finished_at=NULL, next_attempt_at=?, updated_at=? WHERE id=? AND status='running' AND retry_count=? AND execution_json IS ?", [task.next_attempt_at || now, now, task.id, task.retry_count, raw])
        changes += Number(resumed.changes)
        continue
      }
      // submitting/submit-uncertain: the response was never proven. Persist
      // the explicit uncertainty and let the runner verify queue/history
      // without a second POST.
      const uncertain: ComfyExecutionState = { ...state, phase: 'submit-uncertain' }
      const resumed = db.run("UPDATE task_jobs SET status='queued', error_code=NULL, error_message=NULL, started_at=NULL, finished_at=NULL, next_attempt_at=?, updated_at=?, execution_json=? WHERE id=? AND status='running' AND retry_count=? AND execution_json IS ?", [task.next_attempt_at || now, now, serializeComfyExecution(uncertain), task.id, task.retry_count, raw])
      changes += Number(resumed.changes)
    }
    db.exec('COMMIT')
    saveDatabase()
    return changes
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

/** Explicitly settle a row whose persisted identity is corrupt. No POST is sent. */
export function failInvalidExecutionTask(id: string): TaskRecord {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const read = readPersistedTask(id)
    if (!read) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
    if (!read.executionError) {
      db.exec('COMMIT')
      return read.task
    }
    if (TERMINAL.has(read.task.status)) {
      db.exec('COMMIT')
      return read.task
    }
    const now = new Date().toISOString()
    db.run("UPDATE task_jobs SET status='failed', error_code='COMFY_EXECUTION_INVALID', error_message=?, finished_at=?, updated_at=? WHERE id=? AND status=? AND retry_count=?", [read.executionError.slice(0, 1000), now, now, id, read.task.status, read.task.retry_count])
    db.exec('COMMIT')
    saveDatabase()
    return getPersistedTask(id)!
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

export function createTaskId(): string {
  return 'task_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
}

/** Freeze the endpoint and executable input in the same durable transaction as the requested ID. */
export function prepareComfyExecution(id: string, endpoint: string, frozenInput: unknown): TaskRecord {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const task = getPersistedTask(id)
    if (!task) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
    if (task.kind !== 'comfyui') throw new TaskRepositoryError('TASK_EXECUTION_INVALID', '只有 ComfyUI 任务可以冻结执行状态')
    if (task.execution_error) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', task.execution_error)
    if (task.status !== 'queued' && task.status !== 'running') throw new TaskRepositoryError('TASK_STATE_CONFLICT', '只有排队或运行中的 ComfyUI 任务可以冻结执行状态')
    if (task.execution != null) {
      db.exec('COMMIT')
      return task
    }
    const frozenEndpoint = requireComfyExecutionEndpoint(requireComfyAddress(endpoint, 'ComfyUI 地址'))
    const inputJson = JSON.stringify(frozenInput)
    if (inputJson === undefined) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', '冻结输入无法序列化')
    const execution: ComfyExecutionState = {
      version: 1,
      endpoint: frozenEndpoint,
      phase: 'prepared',
      requestedPromptId: crypto.randomUUID(),
      promptId: null,
      cancelOutcome: 'none',
    }
    const result = db.run('UPDATE task_jobs SET input_json=?, execution_json=?, updated_at=? WHERE id=? AND status=? AND retry_count=? AND execution_json IS NULL', [
      inputJson, serializeComfyExecution(execution), new Date().toISOString(), id, task.status, task.retry_count,
    ])
    if (Number(result.changes) !== 1) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务状态已经变化')
    db.exec('COMMIT')
    saveDatabase()
    return getPersistedTask(id)!
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

/** Exact raw-value CAS; a stale read writes nothing, and task lifecycle fields stay untouched. */
export function updateComfyExecution(id: string, expectedRaw: string | null, next: ComfyExecutionState): TaskRecord {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = readPersistedTask(id)
    if (!current) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
    if (current.executionError) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', current.executionError)
    if (current.executionRaw !== expectedRaw) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '执行状态已经变化')
    const state = current.task.execution
    if (!state) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务没有可更新的执行状态')
    if (current.task.status === 'succeeded' || current.task.status === 'failed') throw new TaskRepositoryError('TASK_STATE_CONFLICT', '终态任务不能更新执行状态')
    if (current.task.status === 'cancelling' || current.task.status === 'cancelled') {
      assertCancellationExecutionWrite(state, next)
    } else {
      assertExecutionIdentity(state, next)
      if (!PHASE_TRANSITIONS[state.phase].includes(next.phase)) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '非法 execution phase 转换')
    }
    const result = db.run('UPDATE task_jobs SET execution_json=?, updated_at=? WHERE id=? AND status=? AND retry_count=? AND execution_json IS ?', [
      serializeComfyExecution(next), new Date().toISOString(), id, current.task.status, current.task.retry_count, expectedRaw,
    ])
    if (Number(result.changes) !== 1) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务状态已经变化')
    db.exec('COMMIT')
    saveDatabase()
    return getPersistedTask(id)!
  } catch (error) {
    rollbackTaskWrite()
    throw error
  }
}

function assertExecutionIdentity(current: ComfyExecutionState, next: ComfyExecutionState): void {
  if (next.endpoint !== current.endpoint) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '执行 endpoint 不可变')
  if (next.requestedPromptId !== current.requestedPromptId) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '执行 requestedPromptId 不可变')
  if (current.promptId !== null && next.promptId !== current.promptId) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '真实 promptId 不能更换或清空')
  if (current.cancelOutcome === 'remote-confirmed' && next.cancelOutcome !== 'remote-confirmed') throw new TaskRepositoryError('TASK_STATE_CONFLICT', 'cancelOutcome remote-confirmed 不能回退')
}

/** Cancellation keeps the task result local; only a real ack or the cancel outcome may advance. */
function assertCancellationExecutionWrite(current: ComfyExecutionState, next: ComfyExecutionState): void {
  assertExecutionIdentity(current, next)
  if (current.cancelOutcome !== 'none' && next.cancelOutcome === 'none') throw new TaskRepositoryError('TASK_STATE_CONFLICT', '不能重置取消意图')
  if (next.phase !== current.phase) {
    const acknowledged = next.promptId !== null && next.phase === 'waiting'
      && (current.phase === 'prepared' || current.phase === 'submitting' || current.phase === 'submit-uncertain')
    if (!acknowledged) throw new TaskRepositoryError('TASK_STATE_CONFLICT', '取消中的任务只接受真实提交确认或取消结果')
  }
}
