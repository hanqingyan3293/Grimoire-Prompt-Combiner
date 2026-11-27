import type { TaskRecord } from './task-types'

export type TaskRetryMode = 'none' | 'retry' | 'read'

/** One retry-admission contract for the main repository and its task UI. */
export function getTaskRetryMode(task: TaskRecord): TaskRetryMode {
  if (task.status !== 'failed' || task.retry_count >= task.max_retries) return 'none'
  if (task.kind !== 'comfyui') return 'retry'
  if (task.execution_error) return 'none'
  if (task.error_code === 'COMFY_PREPARE_FAILED') {
    return task.execution == null || task.execution.phase === 'prepared' ? 'retry' : 'none'
  }
  return task.execution?.promptId != null && (task.execution.phase === 'waiting' || task.execution.phase === 'importing') ? 'read' : 'none'
}
