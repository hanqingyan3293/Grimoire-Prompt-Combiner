import { parseCanvasEditorRequest, parseCanvasEditorView, type CanvasEditorRequest, type CanvasEditorResponse, type CanvasEditorView } from '../../shared/canvas-editor-transfer'

export interface CanvasProjectTransferAdapter {
  projectId: string
  ready(): boolean
  assertCanTransfer(): void
  flush(): Promise<void>
  view(): CanvasEditorView
  restore(view: CanvasEditorView, strict?: boolean): Promise<void>
}
interface CanvasTransferDependencies {
  ready(): boolean
  projectId(): string | null
  flush(): Promise<void>
  readProject(id: string): Promise<{ revision: number } | null>
  hydrateProject(id: string, revision: number): Promise<unknown>
  navigate(path: string): Promise<unknown>
}
let adapter: CanvasProjectTransferAdapter | null = null
let frozen = false
const generationId = crypto.randomUUID()
let viewSequence = 0
export const getCanvasEditorGenerationId = () => generationId
export function publishCanvasEditorView(view: CanvasEditorView): void {
  if (frozen || typeof window === 'undefined') return
  const editorKey = new URLSearchParams(window.location.search).get('editorKey')
  const state = parseCanvasEditorView(view)
  if (!editorKey || !state) return
  window.parent.postMessage({ type: 'grimoire:canvas-editor-view', editorKey, generationId, sequence: ++viewSequence, state }, window.location.protocol === 'file:' ? '*' : window.location.origin)
}
const listeners = new Set<() => void>()
export const getCanvasTransferFrozen = () => frozen
export const subscribeCanvasTransferFrozen = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function registerCanvasProjectTransferAdapter(value: CanvasProjectTransferAdapter) { adapter = value; return () => { if (adapter === value) adapter = null } }
const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const emptyView = (): CanvasEditorView => ({ version: 1, projectId: null, projectRevision: 0, viewport: { x: 0, y: 0, k: 1 }, selectedNodeIds: [], selectedConnectionId: null })

/** Only the exact parent and editor key may ask the mounted iframe to move. */
export function installCanvasEditorTransfer(frame: Window, editorKey: string, dependencies: CanvasTransferDependencies): () => void {
  let composition = 0
  let epoch = 0
  let disposed = false
  const requests = new Map<string, { fingerprint: string; result: Promise<CanvasEditorResponse>; complete: boolean }>()
  const setFrozen = (value: boolean) => {
    frozen = value
    const root = frame.document.getElementById('root')
    if (root) root.inert = value
    frame.document.documentElement.dataset.canvasTransferFrozen = String(value)
    listeners.forEach(listener => listener())
  }
  setFrozen(new URLSearchParams(frame.location.search).get('editorFrozen') === '1')
  const assertCurrent = (token: number) => { if (disposed || epoch !== token) throw new Error('CANVAS_TRANSFER_CANCELLED: 画布移交已撤销') }
  const freeze = async () => {
    if (composition) throw new Error('EDITOR_COMPOSITION_ACTIVE: 请先完成画布中的输入法组合输入，再移交')
    if (!dependencies.ready()) throw new Error('CANVAS_NOT_READY: 请等待画布读取完成后重试')
    const projectId = dependencies.projectId()
    if (projectId && (!adapter || adapter.projectId !== projectId || !adapter.ready())) throw new Error('CANVAS_NOT_READY: 当前画布项目尚未读取完成')
    adapter?.assertCanTransfer()
    if (frame.document.activeElement instanceof HTMLElement) frame.document.activeElement.blur()
    setFrozen(true)
    await nextTask()
    adapter?.assertCanTransfer()
  }
  const waitForProject = async (projectId: string, token: number, previous?: CanvasProjectTransferAdapter | null) => {
    const deadline = Date.now() + 10_000
    while (!adapter || adapter.projectId !== projectId || !adapter.ready() || previous && adapter === previous) {
      assertCurrent(token)
      if (Date.now() >= deadline) throw new Error('CANVAS_REVISION_NOT_READY: 目标画布项目未在 10 秒内完成读取')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return adapter
  }
  const run = async (request: CanvasEditorRequest): Promise<CanvasEditorResponse> => {
    const base = { type: 'grimoire:canvas-editor-response' as const, operation: request.operation, requestId: request.requestId, editorKey }
    const token = request.operation === 'hydrate' || request.operation === 'restore' ? ++epoch : epoch
    try {
      if (request.operation === 'thaw') { epoch++; setFrozen(false); return { ...base, ok: true } }
      if (request.operation === 'freeze') { await freeze(); assertCurrent(token); return { ...base, ok: true } }
      if (request.operation === 'flush') {
        if (!frozen) throw new Error('CANVAS_NOT_FROZEN: 请先冻结画布编辑再保存移交')
        const projectId = dependencies.projectId()
        const current = projectId ? await waitForProject(projectId, token) : null
        current?.assertCanTransfer()
        await current?.flush()
        await dependencies.flush()
        assertCurrent(token)
        if (!projectId || !current) return { ...base, ok: true, state: emptyView() }
        const persisted = await dependencies.readProject(projectId)
        assertCurrent(token)
        if (!persisted || !Number.isSafeInteger(persisted.revision) || persisted.revision < 0) throw new Error('CANVAS_REVISION_NOT_READY: 无法确认画布持久版本')
        return { ...base, ok: true, state: { ...current.view(), projectRevision: persisted.revision } }
      }
      const state = request.state!
      const previous = adapter
      setFrozen(true)
      if (state.projectId && request.operation === 'hydrate') await dependencies.hydrateProject(state.projectId, state.projectRevision)
      assertCurrent(token)
      if (!state.projectId) { await dependencies.navigate('/canvas'); await nextTask(); assertCurrent(token); return { ...base, ok: true, state: emptyView() } }
      if (request.operation === 'hydrate') await dependencies.navigate('/canvas/' + encodeURIComponent(state.projectId) + '?__editorHydration=' + encodeURIComponent(request.requestId))
      else if (!adapter || adapter.projectId !== state.projectId || !adapter.ready()) await dependencies.navigate('/canvas/' + encodeURIComponent(state.projectId))
      const current = await waitForProject(state.projectId, token, request.operation === 'hydrate' ? previous : undefined)
      assertCurrent(token)
      if (request.operation === 'restore') await current.restore(state, false)
      else await current.restore(state)
      await nextTask()
      assertCurrent(token)
      const restored = current.view()
      if (restored.projectRevision < state.projectRevision) throw new Error('CANVAS_REVISION_NOT_READY: 目标画布仍是旧版本')
      return { ...base, ok: true, state: restored }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] || 'CANVAS_TRANSFER_FAILED'
      return { ...base, ok: false, code, message: message.replace(/^[A-Z][A-Z0-9_]+:\s*/, '').slice(0, 4096) }
    }
  }
  const send = (response: CanvasEditorResponse) => { if (!disposed) frame.parent.postMessage(response, frame.location.protocol === 'file:' ? '*' : frame.location.origin) }
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.parent) return
    const request = parseCanvasEditorRequest(event.data)
    if (!request || request.editorKey !== editorKey) return
    const fingerprint = JSON.stringify(request)
    const old = requests.get(request.requestId)
    if (old) {
      if (old.fingerprint !== fingerprint) send({ type: 'grimoire:canvas-editor-response', operation: request.operation, requestId: request.requestId, editorKey, ok: false, code: 'CANVAS_REQUEST_REUSED', message: '画布请求编号已用于不同操作' })
      else void old.result.then(send)
      return
    }
    for (const [id, entry] of requests) { if (requests.size < 64) break; if (entry.complete) requests.delete(id) }
    if (requests.size >= 64) { send({ type: 'grimoire:canvas-editor-response', operation: request.operation, requestId: request.requestId, editorKey, ok: false, code: 'CANVAS_TRANSFER_BUSY', message: '画布移交请求过多' }); return }
    const entry = { fingerprint, result: run(request), complete: false }
    requests.set(request.requestId, entry)
    void entry.result.then(response => { entry.complete = true; send(response) })
  }
  const beginComposition = () => { composition++ }
  const endComposition = () => { composition = Math.max(0, composition - 1) }
  const blockEditing = (event: Event) => { if (frozen) { event.preventDefault(); event.stopImmediatePropagation() } }
  const editingEvents = ['keydown', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'touchmove', 'touchend', 'beforeinput', 'input', 'change', 'paste', 'drop']
  frame.addEventListener('message', receive)
  frame.addEventListener('compositionstart', beginComposition, true)
  frame.addEventListener('compositionend', endComposition, true)
  editingEvents.forEach(type => frame.addEventListener(type, blockEditing, { capture: true, passive: false }))
  return () => {
    disposed = true; epoch++; setFrozen(false)
    frame.removeEventListener('message', receive)
    frame.removeEventListener('compositionstart', beginComposition, true)
    frame.removeEventListener('compositionend', endComposition, true)
    editingEvents.forEach(type => frame.removeEventListener(type, blockEditing, true))
  }
}
