import crypto from 'crypto'
import type { TaskCreateInput, TaskEvent, TaskKind, TaskRecord, TaskStatus } from '../../shared/task-types'

const TERMINAL = new Set<TaskStatus>(['succeeded', 'failed', 'cancelled'])
const VALID_KINDS = new Set<TaskKind>(['wd14', 'comfyui', 'ai-vision'])

export interface TaskStateStore {
  insert(task: TaskRecord): void
  update(id: string, patch: Partial<TaskRecord>): TaskRecord
  get(id: string): TaskRecord | null
}

export function createTask(input: TaskCreateInput, now = new Date()): TaskRecord {
  if (!VALID_KINDS.has(input.kind)) throw new Error('不支持的任务类型')
  const maxRetries = input.maxRetries === undefined ? 2 : Math.max(0, Math.min(5, Math.floor(input.maxRetries)))
  const timestamp = now.toISOString()
  return {
    id: input.id || 'task_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20),
    kind: input.kind, status: 'queued', input_json: JSON.stringify(input.input), output_json: null,
    error_code: null, error_message: null, progress: 0, retry_count: 0, max_retries: maxRetries,
    created_at: timestamp, started_at: null, finished_at: null, updated_at: timestamp,
  }
}

export function transitionTask(task: TaskRecord, next: TaskStatus, patch: Partial<TaskRecord> = {}, now = new Date()): TaskRecord {
  if (TERMINAL.has(task.status)) throw new Error('终态任务不能再次变更')
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    queued: ['running', 'cancelled'], running: ['paused', 'cancelling', 'succeeded', 'failed'],
    paused: ['running', 'cancelling', 'cancelled'], cancelling: ['cancelled', 'failed'],
    succeeded: [], failed: [], cancelled: [],
  }
  if (!allowed[task.status].includes(next)) throw new Error('非法任务状态转换')
  const updated: TaskRecord = { ...task, ...patch, status: next, updated_at: now.toISOString() }
  if (next === 'running' && !updated.started_at) updated.started_at = now.toISOString()
  if (TERMINAL.has(next)) updated.finished_at = now.toISOString()
  if (next === 'succeeded') { updated.progress = 1; updated.error_code = null; updated.error_message = null }
  return updated
}

export function retryTask(task: TaskRecord, now = new Date()): TaskRecord {
  if (task.status !== 'failed') throw new Error('只有失败任务可以重试')
  if (task.retry_count >= task.max_retries) throw new Error('任务已达到最大重试次数')
  return {
    ...task,
    status: 'queued',
    retry_count: task.retry_count + 1,
    progress: 0,
    output_json: null,
    error_code: null,
    error_message: null,
    started_at: null,
    finished_at: null,
    updated_at: now.toISOString(),
  }
}

export function taskEvent(task: TaskRecord): TaskEvent {
  return { taskId: task.id, kind: task.kind, status: task.status, progress: task.progress, errorCode: task.error_code || undefined, errorMessage: task.error_message || undefined }
}
