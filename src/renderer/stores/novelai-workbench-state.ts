import { migrateLegacyNovelaiDraft, type LegacyNovelaiDraft } from '@shared/novelai-document'
import { encodeWorkspaceEditorState } from '@shared/workspace-editor-state'
import { createNovelaiDraftState, validateNovelaiDraftState, type NovelaiDraftState } from './novelai-draft.store'

export interface NovelaiWorkDraft { journal: NovelaiDraftState; selectedVersionId: string | null; selectedBranchId: string | null }
export interface NovelaiWorkbenchState { kind: 'novelai-workbench'; version: 2; activeWorkId: string | null; works: Record<string, NovelaiWorkDraft> }
export type NovelaiWorkbenchRead = { ok: true; state: NovelaiWorkbenchState } | { ok: false; code: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const selection = (value: unknown): value is string | null => value === null || typeof value === 'string'
export function createNovelaiWorkbenchState(): NovelaiWorkbenchState { return { kind: 'novelai-workbench', version: 2, activeWorkId: null, works: {} } }

/** The only persistence container is the existing workspace editor state. Legacy conversion
 * is explicit; future/corrupt documents are refused so a load cannot silently erase a draft. */
export function readNovelaiWorkbenchState(value: unknown): NovelaiWorkbenchRead {
  if (value === undefined || value === null) return { ok: true, state: createNovelaiWorkbenchState() }
  try {
    const raw: unknown = JSON.parse(encodeWorkspaceEditorState(value))
    if (!object(raw) || raw.kind !== 'novelai-workbench' || !object(raw.works) || !selection(raw.activeWorkId)) return { ok: false, code: 'INVALID_WORKBENCH_STATE' }
    if (raw.version !== 1 && raw.version !== 2) return { ok: false, code: 'UNSUPPORTED_WORKBENCH_VERSION' }
    const slots: Array<[string, NovelaiWorkDraft]> = []
    for (const [workId, slot] of Object.entries(raw.works)) {
      if (!object(slot) || !selection(slot.selectedVersionId ?? null)) return { ok: false, code: 'INVALID_WORK_DRAFT' }
      let journal: NovelaiDraftState
      if (raw.version === 1) {
        if (slot.draft !== undefined && typeof slot.draft !== 'string' || slot.metadata !== undefined && !object(slot.metadata)) return { ok: false, code: 'INVALID_LEGACY_DRAFT' }
        journal = createNovelaiDraftState(migrateLegacyNovelaiDraft(slot as LegacyNovelaiDraft))
      } else {
        const checked = validateNovelaiDraftState(slot.journal)
        if (!checked.ok) return { ok: false, code: checked.code }
        journal = checked.state
      }
      if (!selection(slot.selectedBranchId ?? null)) return { ok: false, code: 'INVALID_WORK_DRAFT' }
      slots.push([workId, { journal, selectedVersionId: (slot.selectedVersionId as string | null) ?? null, selectedBranchId: (slot.selectedBranchId as string | null) ?? null }])
    }
    const state: NovelaiWorkbenchState = { kind: 'novelai-workbench', version: 2, activeWorkId: raw.activeWorkId, works: Object.fromEntries(slots) }
    encodeWorkspaceEditorState(state)
    return { ok: true, state }
  } catch (error) { return { ok: false, code: error instanceof Error ? error.message : String(error) } }
}
