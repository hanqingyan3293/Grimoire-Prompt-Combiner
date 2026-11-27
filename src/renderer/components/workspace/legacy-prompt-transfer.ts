import type { PanelTag, UndoRedoEntry } from '../../../shared/types'
import { encodeWorkspaceEditorState } from '../../../shared/workspace-editor-state'
export interface LegacyPromptTransferState { kind: 'legacy-prompts'; version: 1; positive: PanelTag[]; negative: PanelTag[]; undoStack: UndoRedoEntry[]; redoStack: UndoRedoEntry[]; impliedExcluded: string[] }
export function captureLegacyPromptEditor(state: Pick<LegacyPromptTransferState, 'positive' | 'negative' | 'undoStack' | 'redoStack'> & { impliedExcluded?: string[] }): LegacyPromptTransferState {
  return validateLegacyPromptEditor({ kind: 'legacy-prompts', version: 1, positive: state.positive, negative: state.negative, undoStack: state.undoStack, redoStack: state.redoStack, impliedExcluded: state.impliedExcluded || [] })
}
export function validateLegacyPromptEditor(raw: unknown): LegacyPromptTransferState {
  const value = raw as LegacyPromptTransferState | null
  if (!value || value.kind !== 'legacy-prompts' || value.version !== 1 || !Array.isArray(value.positive) || !Array.isArray(value.negative) || !Array.isArray(value.undoStack) || !Array.isArray(value.redoStack)) throw new Error('EDITOR_STATE_INVALID: 提示词移交草稿无效')
  encodeWorkspaceEditorState(value)
  if (value.impliedExcluded !== undefined && (!Array.isArray(value.impliedExcluded) || value.impliedExcluded.some(id => typeof id !== 'string'))) throw new Error('EDITOR_STATE_INVALID: 隐含标签排除记录无效')
  for (const list of [value.positive, value.negative, ...value.undoStack.flatMap(entry => [entry.positive, entry.negative]), ...value.redoStack.flatMap(entry => [entry.positive, entry.negative])]) {
    if (!Array.isArray(list) || list.some(item => !item || !item.tag || typeof item.tag.id !== 'string' || typeof item.tag.en !== 'string' || typeof item.weight !== 'number' || !Number.isFinite(item.weight))) throw new Error('EDITOR_STATE_INVALID: 提示词标签或撤销记录无效')
  }
  return { ...structuredClone(value), impliedExcluded: [...(value.impliedExcluded || [])] }
}
