export interface StoredWorkspaceEditorState { editorKey: string; revision: number; state: unknown }
export type SaveWorkspaceEditorStateResult = { saved: true; value: StoredWorkspaceEditorState } | { saved: false; conflict: true; current: StoredWorkspaceEditorState | null } | { saved: false; error: { code: string; message: string } }
export type WorkspaceEditorFlushResult = { status: 'saved'; revision: number } | { status: 'conflict'; local: unknown; remote: StoredWorkspaceEditorState | null } | { status: 'error'; code: string; message: string }
export interface WorkspaceEditorBridge {
  loadEditorState(key: string): Promise<StoredWorkspaceEditorState | null>
  saveEditorState(key: string, expectedRevision: number, state: unknown): Promise<SaveWorkspaceEditorStateResult>
  onEditorStateChanged(callback: (value: StoredWorkspaceEditorState) => void): () => void
}
export interface WorkspaceEditorSnapshot {
  status: 'loading' | 'ready' | 'conflict' | 'error'
  state: unknown
  revision: number
  baseRevision: number
  localSequence: number
  dirty: boolean
  remote: StoredWorkspaceEditorState | null
  error: { code: string; message: string } | null
}

export const WORKSPACE_EDITOR_MAX_BYTES = 5 * 1024 * 1024
export function encodeWorkspaceEditorState(value: unknown): string {
  let text: string | undefined
  try { text = JSON.stringify(value) } catch { throw new Error('EDITOR_STATE_INVALID: 草稿包含无法序列化的值') }
  if (text === undefined) throw new Error('EDITOR_STATE_INVALID: 草稿状态缺失')
  if (new TextEncoder().encode(text).byteLength > WORKSPACE_EDITOR_MAX_BYTES) throw new Error('EDITOR_STATE_TOO_LARGE: 草稿超过5MiB限制')
  const stack: unknown[] = [value]
  while (stack.length) {
    const item = stack.pop()
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue
    if (typeof item === 'number' && Number.isFinite(item)) continue
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw new Error('EDITOR_STATE_INVALID: 草稿只能包含JSON值')
    for (const child of Object.values(item)) stack.push(child)
  }
  return text
}
