export type TaskKind = 'wd14' | 'comfyui' | 'ai-vision'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'

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
}
