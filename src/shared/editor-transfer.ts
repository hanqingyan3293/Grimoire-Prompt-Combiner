export type EditorTransferDirection = 'popout' | 'return'
export type EditorTransferPhase = 'waiting' | 'ready' | 'transferred' | 'committed' | 'aborted'
export interface EditorTransferInput {
  direction: EditorTransferDirection
  workspaceId: string
  panelId: string
  editorId: string
  editorKey: string
  panelType: string
  title: string
  committedRevision: number
  bounds?: { x?: number; y?: number; width?: number; height?: number }
}
export interface EditorTransferRecord extends EditorTransferInput {
  transferId: string
  sequence: number
  recovery?: 'persisted-after-crash'
  phase: EditorTransferPhase
  expiresAt: number
  error?: { code: string; message: string }
}
export type EditorTransferResult = { ok: true; transfer: EditorTransferRecord } | { ok: false; code: string; message: string }
export interface EditorTransferEvent { role: 'source' | 'target'; transfer: EditorTransferRecord }
export interface WorkspaceEditorAccess { writable: boolean; reason: 'owned' | 'held' | 'foreign' }
export const editorOwnershipKey = (key: string) => key.endsWith(':prompt-workbench') ? 'legacy-prompts' : key
export const EDITOR_TRANSFER_TYPES: ReadonlySet<string> = new Set(['novelai-workbench', 'novelai-assets', 'prompt-workbench', 'settings', 'canvas'])
