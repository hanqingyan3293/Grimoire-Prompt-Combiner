export class ComfyUIError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean, readonly status?: number) {
    super(message)
    this.name = 'ComfyUIError'
  }
}

export function readComfyAbortError(): ComfyUIError {
  const error = new ComfyUIError('COMFY_READ_ABORTED', 'ComfyUI 读取已中止', false)
  error.name = 'AbortError'
  return error
}
