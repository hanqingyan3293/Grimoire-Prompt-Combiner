import type { ComfyExecutionState } from './comfy-execution'

export type TaskKind = 'wd14' | 'comfyui' | 'ai-vision'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'

export interface ComfyTaskImageResult {
  filename: string
  subfolder: string
  type: string
  status: 'imported' | 'pending' | 'failed'
  imageId: number | null
  errorCode: string | null
  errorMessage: string | null
}

export interface TaskRecord {
  id: string
  kind: TaskKind
  status: TaskStatus
  input_json: string
  output_json: string | null
  error_code: string | null
  error_message: string | null
  progress: number
  retry_count: number
  max_retries: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
  next_attempt_at?: string | null
  execution?: ComfyExecutionState | null
  /**
   * Present only when the persisted execution_json cannot be parsed. The task
   * is shown as blocked/failed instead of being treated as a fresh NULL row.
   * Never carries the raw execution JSON or credentials.
   */
  execution_error?: string | null
}

export interface TaskCreateInput {
  id?: string
  kind: TaskKind
  input: unknown
  maxRetries?: number
}

export interface TaskEvent {
  taskId: string
  kind: TaskKind
  status: TaskStatus
  progress: number
  errorCode?: string
  errorMessage?: string
  execution?: ComfyExecutionState | null
  executionError?: string
}
