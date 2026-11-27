import { parseCanvasEditorResponse, type CanvasEditorOperation, type CanvasEditorRequest, type CanvasEditorView } from '../../../shared/canvas-editor-transfer'

type Pending = { frame: Window; operation: CanvasEditorOperation; resolve: (value: CanvasEditorView | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class CanvasEditorFrameClient {
  private pending = new Map<string, Pending>()
  private disposed = false
  constructor(private editorKey: string, private getFrame: () => Window | null, private host: Window) { host.addEventListener('message', this.receive) }
  private receive = (event: MessageEvent) => {
    if (event.source !== this.getFrame()) return
    const response = parseCanvasEditorResponse(event.data)
    if (!response || response.editorKey !== this.editorKey) return
    const pending = this.pending.get(response.requestId)
    if (!pending || pending.frame !== event.source || pending.operation !== response.operation) return
    clearTimeout(pending.timer); this.pending.delete(response.requestId)
    if (response.ok) pending.resolve(response.state)
    else pending.reject(new Error(response.code + ': ' + response.message))
  }
  request(operation: CanvasEditorOperation, state?: CanvasEditorView): Promise<CanvasEditorView | undefined> {
    const frame = this.getFrame()
    if (this.disposed || !frame) return Promise.reject(new Error('CANVAS_FRAME_CLOSED: 画布窗口已关闭'))
    if (this.pending.size >= 16) return Promise.reject(new Error('CANVAS_TRANSFER_BUSY: 画布移交请求过多'))
    const requestId = crypto.randomUUID()
    const request: CanvasEditorRequest = { type: 'grimoire:canvas-editor-request', requestId, editorKey: this.editorKey, operation, ...(state ? { state } : {}) }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('CANVAS_TRANSFER_TIMEOUT: 画布未在 10 秒内确认移交')) }, 10_000)
      this.pending.set(requestId, { frame, operation, resolve, reject, timer })
      try { frame.postMessage(request, this.host.location.protocol === 'file:' ? '*' : this.host.location.origin) }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error) }
    })
  }
  dispose() {
    this.disposed = true; this.host.removeEventListener('message', this.receive)
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CANVAS_FRAME_CLOSED: 画布窗口已关闭')) }
    this.pending.clear()
  }
}
