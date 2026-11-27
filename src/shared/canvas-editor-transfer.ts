/** Workspace persists view handles only; Canvas documents remain in their existing repository. */
export interface CanvasEditorView {
  version: 1
  projectId: string | null
  projectRevision: number
  viewport: { x: number; y: number; k: number }
  selectedNodeIds: string[]
  selectedConnectionId: string | null
}
export type CanvasEditorOperation = 'freeze' | 'flush' | 'hydrate' | 'restore' | 'thaw'
export interface CanvasEditorRequest { type: 'grimoire:canvas-editor-request'; requestId: string; editorKey: string; operation: CanvasEditorOperation; state?: CanvasEditorView }
export type CanvasEditorResponse = { type: 'grimoire:canvas-editor-response'; requestId: string; editorKey: string; operation: CanvasEditorOperation } & ({ ok: true; state?: CanvasEditorView } | { ok: false; code: string; message: string })
export interface CanvasEditorViewEvent { type: 'grimoire:canvas-editor-view'; editorKey: string; generationId: string; sequence: number; state: CanvasEditorView }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const id = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value)
const operation = (value: unknown): value is CanvasEditorOperation => ['freeze', 'flush', 'hydrate', 'restore', 'thaw'].includes(String(value))

export function parseCanvasEditorView(value: unknown): CanvasEditorView | null {
  if (!record(value) || !keys(value, ['version', 'projectId', 'projectRevision', 'viewport', 'selectedNodeIds', 'selectedConnectionId']) || value.version !== 1 || !(value.projectId === null || id(value.projectId, 256)) || !Number.isSafeInteger(value.projectRevision) || Number(value.projectRevision) < 0) return null
  const viewport = value.viewport
  if (!record(viewport) || !keys(viewport, ['x', 'y', 'k']) || ![viewport.x, viewport.y, viewport.k].every(number => typeof number === 'number' && Number.isFinite(number)) || Number(viewport.k) < 0.05 || Number(viewport.k) > 5) return null
  if (!Array.isArray(value.selectedNodeIds) || value.selectedNodeIds.length > 5000 || !value.selectedNodeIds.every(node => id(node, 256)) || new Set(value.selectedNodeIds).size !== value.selectedNodeIds.length || !(value.selectedConnectionId === null || id(value.selectedConnectionId, 256))) return null
  if (value.projectId === null && (value.projectRevision !== 0 || value.selectedNodeIds.length || value.selectedConnectionId !== null)) return null
  return { version: 1, projectId: value.projectId, projectRevision: Number(value.projectRevision), viewport: { x: Number(viewport.x), y: Number(viewport.y), k: Number(viewport.k) }, selectedNodeIds: [...value.selectedNodeIds], selectedConnectionId: value.selectedConnectionId }
}

export function parseCanvasEditorRequest(value: unknown): CanvasEditorRequest | null {
  if (!record(value) || !keys(value, ['type', 'requestId', 'editorKey', 'operation', 'state']) || value.type !== 'grimoire:canvas-editor-request' || !id(value.requestId) || !id(value.editorKey) || !operation(value.operation)) return null
  const readsView = value.operation === 'hydrate' || value.operation === 'restore'
  const state = readsView ? parseCanvasEditorView(value.state) : undefined
  if (readsView ? !state : value.state !== undefined) return null
  return { type: value.type, requestId: value.requestId, editorKey: value.editorKey, operation: value.operation, ...(state ? { state } : {}) }
}

export function parseCanvasEditorResponse(value: unknown): CanvasEditorResponse | null {
  if (!record(value) || value.type !== 'grimoire:canvas-editor-response' || !id(value.requestId) || !id(value.editorKey) || !operation(value.operation)) return null
  const base = { type: value.type as 'grimoire:canvas-editor-response', requestId: value.requestId, editorKey: value.editorKey, operation: value.operation }
  if (value.ok === false) {
    if (!keys(value, ['type', 'requestId', 'editorKey', 'operation', 'ok', 'code', 'message']) || !id(value.code, 128) || typeof value.message !== 'string' || value.message.length > 4096) return null
    return { ...base, ok: false, code: value.code, message: value.message }
  }
  if (value.ok !== true || !keys(value, ['type', 'requestId', 'editorKey', 'operation', 'ok', 'state'])) return null
  const state = value.state === undefined ? undefined : parseCanvasEditorView(value.state)
  if (state === null || (['flush', 'hydrate', 'restore'].includes(value.operation) && !state)) return null
  return { ...base, ok: true, ...(state ? { state } : {}) }
}

export function parseCanvasEditorViewEvent(value: unknown): CanvasEditorViewEvent | null {
  if (!record(value) || !keys(value, ['type', 'editorKey', 'generationId', 'sequence', 'state']) || value.type !== 'grimoire:canvas-editor-view' || !id(value.editorKey) || !id(value.generationId) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) return null
  const state = parseCanvasEditorView(value.state)
  return state ? { type: value.type, editorKey: value.editorKey, generationId: value.generationId, sequence: Number(value.sequence), state } : null
}
