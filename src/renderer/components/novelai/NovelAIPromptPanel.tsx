import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileUp, GitBranch, History, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { parsePromptDocument } from '../../../shared/prompt-blocks'
import { createNovelaiDocument, type NovelaiJsonObject } from '../../../shared/novelai-document'
import { encodeWorkspaceEditorState } from '../../../shared/workspace-editor-state'
import { diffPromptVersions } from '../../../shared/prompt-diff'
import { applyOrganizeSuggestions, organizePromptText, OrganizePlanError, type OrganizeSuggestion } from '../../../shared/novelai-organize'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'
import { useOptionalWorkspaceEditorState } from '../workspace/WorkspaceEditorHost'
import { useNovelaiEditLease } from './use-novelai-edit-lease'
import { commitNovelaiDraft, createNovelaiDraftState, redoNovelaiDraft, undoNovelaiAgent, undoNovelaiDraft, type NovelaiDraftCommit } from '../../stores/novelai-draft.store'
import { createNovelaiWorkbenchState, readNovelaiWorkbenchState, type NovelaiWorkbenchState, type NovelaiWorkDraft } from '../../stores/novelai-workbench-state'
import { NovelaiDocumentEditor } from './NovelaiDocumentEditor'

// NovelAI prompt workbench (M6 UI). The data rules (branching, revisions, recycle bin) live in
// the main-process service and are covered by tests; this component only presents them, and it
// parses the draft with the same pure parser so the block list can never disagree with the text.
type Work = { id: string; name: string; lastVersionId: string | null; revision: number; updatedAt?: string; lastUsedAt: string }
type Version = { id: string; workId: string; parentId: string | null; number: number; branchId: string; branchNumber: number; snapshot: string; source: 'user' | 'agent'; operation: string; createdAt: string; deletedAt: string | null }
type Branch = { id: string; name: string | null; branchNumber: number; number: number; tipVersionId: string; tipNumber: number; size: number }
type Bundle = { work: Work; line: Version[]; branchName: string | null; deleted: Version[]; branches: Branch[] }
type OrganizeRequest = { workId: string; versionId: string; expectedRevision: number; draft: string }
type OrganizeResponse = { ok: true; changes: OrganizeSuggestion[]; workRevision: number; versionId: string } | { ok: false; code: string; message: string }
type LocalOrganizeKind = 'dedupe' | 'sort' | 'cleanup'

const LOCAL_ORGANIZE_LABEL: Record<LocalOrganizeKind, string> = { dedupe: '去重', sort: '排序', cleanup: '清理' }

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseLoras(value: string): string[] | undefined {
  const list = value.split(',').map(item => item.trim()).filter(Boolean)
  return list.length ? list : undefined
}

function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

export function NovelAIPromptPanel() {
  const [works, setWorks] = useState<Work[]>([])
  const [worksLoaded, setWorksLoaded] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const editor = useOptionalWorkspaceEditorState()
  const editorRef = useRef(editor); editorRef.current = editor
  const [localState, setLocalState] = useState(createNovelaiWorkbenchState)
  const decodedState = useMemo(() => readNovelaiWorkbenchState(editor ? editor.state : localState), [editor?.state, localState, Boolean(editor)])
  const state = decodedState.ok ? decodedState.state : localState
  const stateRef = useRef(state); stateRef.current = state
  const emptyJournal = useMemo(() => createNovelaiDraftState(createNovelaiDocument()), [])
  const slot = bundle ? state.works[bundle.work.id] : undefined
  const journal = slot?.journal ?? emptyJournal
  const document = journal.document
  const draft = document.primary
  const metadata = { ...document.generation, negativePrompt: document.negative, unknown: document.metadataUnknown }
  const selectedVersionId = slot?.selectedVersionId ?? null
  const lease = useNovelaiEditLease(bundle ? { kind: 'work', id: bundle.work.id } : null)
  const readOnly = Boolean(!decodedState.ok || editor?.frozen || editor?.status === 'loading' || editor?.status === 'error' || bundle && lease.supported && lease.status !== 'ready')
  const draftSequence = useRef(0)
  const updateWorkbench = (update: (previous: NovelaiWorkbenchState) => NovelaiWorkbenchState): boolean => {
    const host = editorRef.current
    if (host && (host.frozen || host.status === 'loading' || host.status === 'error')) return false
    let applied = false
    const change = (current: unknown): unknown => {
      const previous = readNovelaiWorkbenchState(current)
      if (!previous.ok) { setError('草稿无法读取 [' + previous.code + ']，原数据已保留'); return current }
      try {
        const next = update(previous.state)
        encodeWorkspaceEditorState(next)
        stateRef.current = next; applied = true
        return next
      } catch (cause) { setError('草稿修改未应用：' + String(cause)); return current }
    }
    if (host) host.updateState(change)
    else setLocalState(change(stateRef.current) as NovelaiWorkbenchState)
    return applied
  }
  const commitDraft = (input: NovelaiDraftCommit): boolean => {
    if (readOnly || !bundle) return false
    let accepted = false
    updateWorkbench(previous => {
      const saved = previous.works[bundle.work.id]
      if (!saved) return previous
      const result = commitNovelaiDraft(saved.journal, input)
      if (!result.ok) { setError('修改未应用 [' + result.code + ']，当前草稿已保留'); return previous }
      accepted = true
      if (result.changed) draftSequence.current++
      if (result.historyTruncated) setNotice('撤销历史已达到容量限制，最早的记录已移出历史')
      return { ...previous, works: { ...previous.works, [bundle.work.id]: { ...saved, journal: result.state } } }
    })
    return accepted
  }
  const editText = (text: string, operation: string) => commitDraft({ expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation, mode: 'guarded', nextDocument: { ...document, primary: text } })
  const loadSequence = useRef(0)
  const [newWorkName, setNewWorkName] = useState('')
  const [branchName, setBranchName] = useState('')
  // Saving from an older version is how a branch is started: the service forks when the parent
  // already has a child, so the UI only has to remember which version to branch from.
  const [branchFrom, setBranchFrom] = useState<Version | null>(null)
  // Assets are recorded against images and a version links to images, so this list is derived
  // server-side instead of being stored twice.
  const [versionAssets, setVersionAssets] = useState<Array<{ imageId: string; asset: { id: string; name: string } }>>([])
  // Diff against an older version: computed locally from the two snapshots, so no extra round trip and
  // no server-side state to keep in sync.
  const [compareBase, setCompareBase] = useState<Version | null>(null)
  // Recycle-bin multi-select: batch restore/delete is one user action and one revision bump.
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // AI proposals are reviewable one block at a time; local operations show a preview before
  // touching the draft. Both are guarded against results that arrive after a work/version switch.
  const [organizeConfirm, setOrganizeConfirm] = useState(false)
  const [organizeBusy, setOrganizeBusy] = useState(false)
  const [proposals, setProposals] = useState<OrganizeSuggestion[]>([])
  const proposalBase = useRef<{ workId: string; versionId: string; revision: number; groupId: string } | null>(null)
  const [localPreview, setLocalPreview] = useState<{ kind: LocalOrganizeKind; text: string; applied: number; sourceDraft: string } | null>(null)
  const organizeSeq = useRef(0)
  const draftRef = useRef(draft)
  const bundleRef = useRef(bundle)
  const selectedVersionRef = useRef(selectedVersionId)
  draftRef.current = draft
  bundleRef.current = bundle
  selectedVersionRef.current = selectedVersionId
  useEffect(() => {
    if (!editor?.registerTransferAdapter) return
    return editor.registerTransferAdapter({ ready: () => decodedState.ok && worksLoaded && (works.length === 0 || Boolean(bundleRef.current?.work.id && selectedVersionRef.current)) })
  }, [editor?.registerTransferAdapter, bundle?.work.id, selectedVersionId, worksLoaded, works.length, decodedState.ok])

  const api = (typeof window !== 'undefined' ? (window as unknown as { api?: { novelai?: Record<string, (...args: unknown[]) => Promise<unknown>> } }).api?.novelai : undefined)
  const metadataApi = typeof window !== 'undefined' ? window.api?.novelai?.metadata : undefined

  const loadBundle = useCallback(async (workId: string, branchId?: string, useTip = false) => {
    if (!api || editorRef.current?.status === 'loading') return
    const read = readNovelaiWorkbenchState(editorRef.current ? editorRef.current.state : stateRef.current)
    if (!read.ok) { setError('草稿无法读取 [' + read.code + ']，原数据已保留'); return }
    const rememberedBranch = !branchId && !useTip ? read.state.works[workId]?.selectedBranchId : null
    const requestedBranch = branchId || rememberedBranch
    const sequence = ++loadSequence.current
    const draftAtStart = draftSequence.current
    organizeSeq.current += 1
    setOrganizeBusy(false); setOrganizeConfirm(false); setProposals([]); setLocalPreview(null)
    const next = await api.bundle(requestedBranch ? { workId, branchId: requestedBranch } : { workId }) as Bundle | null
    if (sequence !== loadSequence.current) return
    setBundle(next)
    if (next) {
      const tip = next.line[next.line.length - 1]
      updateWorkbench(latest => {
        const stored = latest.works[workId]
        const advanceSelection = useTip && draftAtStart === draftSequence.current
        const selected = !advanceSelection && !branchId && stored && next.line.some(version => version.id === stored.selectedVersionId) ? stored.selectedVersionId : tip?.id || null
        let nextJournal = stored?.journal ?? createNovelaiDraftState(createNovelaiDocument({ primary: next.line.find(version => version.id === selected)?.snapshot ?? '' }))
        if (branchId && stored && draftAtStart === draftSequence.current) {
          const result = commitNovelaiDraft(stored.journal, { expectedRevision: stored.journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation: '切换分支', mode: 'typing', nextDocument: createNovelaiDocument({ primary: tip?.snapshot ?? '' }) })
          if (!result.ok) { setError('分支草稿未切换 [' + result.code + ']'); return latest }
          nextJournal = result.state
        }
        const value: NovelaiWorkDraft = { journal: nextJournal, selectedVersionId: selected, selectedBranchId: next.line.find(version => version.id === selected)?.branchId ?? null }
        return { ...latest, activeWorkId: workId, works: { ...latest.works, [workId]: value } }
      })
      setBranchName(next.branchName ?? '')
    }
  }, [api])

  const refreshWorks = useCallback(async () => {
    if (!api || editorRef.current?.status === 'loading') return
    const list = await api.listWorks() as Work[]
    setWorks(list ?? [])
    setWorksLoaded(true)
    if (!bundle && list?.length) { const selected = stateRef.current.activeWorkId; await loadBundle(list.some(work => work.id === selected) ? selected! : list[0].id) }
  }, [api, bundle, loadBundle, editor?.status])

  useEffect(() => { void refreshWorks().catch(cause => setError(String(cause))) }, [refreshWorks])

  const blocks = useMemo(() => parsePromptDocument(draft).blocks, [draft])
  const current = bundle?.line.find(version => version.id === selectedVersionId) ?? null
  const dirty = !!current && draft !== current.snapshot
  const canSave = !!current && dirty && draft.trim().length > 0

  const createWork = async () => {
    if (readOnly || !api || !newWorkName.trim()) return
    setBusy(true); setError(null)
    try {
      const created = await api.createWork({ name: newWorkName.trim(), snapshot: draft }) as { work: Work }
      setNewWorkName('')
      await refreshWorks()
      await loadBundle(created.work.id)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const saveVersion = async () => {
    if (readOnly || !api || !bundle || !current) return
    if (!dirty) { setNotice('草稿没有变化，未创建版本'); return }
    if (!draft.trim()) { setError('提示词不能为空，未创建版本'); return }
    const workId = bundle.work.id
    const capturedDraftSequence = draftSequence.current
    const parameters = { workId, parentVersionId: (branchFrom ?? current).id, snapshot: draft, expectedRevision: bundle.work.revision, operation: branchFrom ? '开分支' : '编辑' }
    setBusy(true); setError(null)
    try {
      const edit = await lease.proof()
      await api.createVersion({ ...parameters, ...(edit ? { edit } : {}) })
      if (bundleRef.current?.work.id !== workId) { setNotice('版本已保存到原作品'); return }
      setBranchFrom(null)
      await loadBundle(workId, undefined, capturedDraftSequence === draftSequence.current)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const deleteVersion = async (mode: 'single' | 'branch') => {
    if (readOnly || !api || !bundle || !current) return
    setBusy(true); setError(null)
    try {
      const edit = await lease.proof()
      await api.deleteVersion({ workId: bundle.work.id, versionId: current.id, mode, expectedRevision: bundle.work.revision, ...(edit ? { edit } : {}) })
      await loadBundle(bundle.work.id)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const restore = async (versionId: string) => {
    if (readOnly || !api || !bundle) return
    setBusy(true); setError(null)
    try { const edit = await lease.proof(); await api.restoreVersion(versionId, ...(edit ? [edit] : [])); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  // Known fields override preserved unknown keys when their names collide; unknown keys the UI
  // cannot display still travel back with the draft so a round trip does not drop them.
  const buildMetadataPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...metadata.unknown, prompt: draft }
    const negativePrompt = optionalText(metadata.negativePrompt)
    if (negativePrompt !== undefined) payload.negativePrompt = negativePrompt
    const numbers: Array<[string, string]> = [
      ['steps', metadata.steps], ['cfg', metadata.cfg], ['seed', metadata.seed],
      ['width', metadata.width], ['height', metadata.height],
    ]
    for (const [key, value] of numbers) {
      const parsed = optionalNumber(value)
      if (parsed !== undefined) payload[key] = parsed
    }
    for (const [key, value] of [['sampler', metadata.sampler], ['scheduler', metadata.scheduler], ['model', metadata.model], ['checkpoint', metadata.checkpoint]] as const) {
      const parsed = optionalText(value)
      if (parsed !== undefined) payload[key] = parsed
    }
    const loras = parseLoras(metadata.loras)
    if (loras !== undefined) payload.loras = loras
    return payload
  }

  const exportMetadata = async () => {
    if (!metadataApi) return
    setBusy(true); setError(null)
    try {
      const result = await metadataApi.exportTo(buildMetadataPayload())
      if (result?.error) setError('导出失败：' + result.error)
      else if (!result?.canceled) setNotice('已写入 ' + (result?.writtenPath ?? ''))
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const importMetadata = async () => {
    if (readOnly || !metadataApi) return
    const workAtStart = bundle?.work.id
    const draftAtStart = draftSequence.current
    const loadAtStart = loadSequence.current
    setBusy(true); setError(null)
    try {
      const result = await metadataApi.readFrom()
      if (result?.canceled) return
      if (!result?.decoded) { setError('这张图没有生成参数'); return }
      if (bundleRef.current?.work.id !== workAtStart || draftSequence.current !== draftAtStart || loadSequence.current !== loadAtStart) { setNotice('草稿或作品已切换，已丢弃本次 PNG 参数'); return }
      const decoded = result.decoded
      const imported = createNovelaiDocument({
        primary: decoded.params.prompt, negative: decoded.params.negativePrompt ?? '',
        generation: {
        steps: numberText(decoded.params.steps),
        cfg: numberText(decoded.params.cfg),
        seed: numberText(decoded.params.seed),
        sampler: decoded.params.sampler ?? '',
        scheduler: decoded.params.scheduler ?? '',
        width: numberText(decoded.params.width),
        height: numberText(decoded.params.height),
        model: decoded.params.model ?? '',
        checkpoint: decoded.params.checkpoint ?? '',
        loras: (decoded.params.loras ?? []).join(', '),
        }, metadataUnknown: { ...decoded.unknown } as NovelaiJsonObject,
      })
      if (!commitDraft({ expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation: '从 PNG 读取参数', mode: 'typing', nextDocument: imported })) return
      setNotice('已从 PNG 读取参数')
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  // The active branch is the one the visible line ends on; the list comes from the same bundle call.
  // `branches` is optional: an older main process (or stale built bundle) returns a payload without
  // it, and a crash here took the whole panel down instead of just hiding the branch row.
  const branches = bundle?.branches ?? []
  const activeBranch = current ? branches.find(branch => branch.id === current.branchId) ?? null : null

  useEffect(() => {
    if (!api || !current) { setVersionAssets([]); return }
    let alive = true
    void (api.byVersion as ((id: string) => Promise<Array<{ imageId: string; asset: { id: string; name: string } }>>) | undefined)?.(current.id)
      .then(list => { if (alive) setVersionAssets(list ?? []) })
      .catch(() => { if (alive) setVersionAssets([]) })
    return () => { alive = false }
  }, [api, current?.id])

  const comparison = compareBase && current ? diffPromptVersions(compareBase.snapshot, current.snapshot) : null

  const togglePick = (id: string) => setPicked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])

  const restorePicked = async () => {
    if (readOnly || !api || !bundle || !picked.length) return
    setBusy(true); setError(null)
    try { const edit = await lease.proof(); await api.restoreVersions(picked, ...(edit ? [edit] : [])); setPicked([]); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  // The label says 永久删除, so it must actually purge. The previous handler called the SOFT delete and
  // left the rows in the recycle bin — the button promised something it did not do.
  const purgePicked = async () => {
    if (readOnly || !api || !bundle || !picked.length) return
    setBusy(true); setError(null)
    try { const edit = await lease.proof(); await api.purgeVersions(picked, ...(edit ? [edit] : [])); setPicked([]); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const renameBranch = async () => {
    if (readOnly || !api || !bundle || !current || !branchName.trim()) return
    setBusy(true); setError(null)
    try { const edit = await lease.proof(); await api.renameBranch({ workId: bundle.work.id, branchId: current.branchId, name: branchName.trim(), ...(edit ? { edit } : {}) }); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const invalidateOrganize = () => {
    organizeSeq.current += 1
    setOrganizeBusy(false)
    setOrganizeConfirm(false)
    setProposals([])
    proposalBase.current = null
    setLocalPreview(null)
  }

  const selectVersion = (version: Version) => {
    if (readOnly || !bundle) return
    invalidateOrganize()
    updateWorkbench(previous => {
      const saved = previous.works[bundle.work.id]
      if (!saved) return previous
      const result = commitNovelaiDraft(saved.journal, { expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation: '切换到 v' + version.number, mode: 'typing', nextDocument: createNovelaiDocument({ primary: version.snapshot }) })
      if (!result.ok) { setError('版本未切换 [' + result.code + ']'); return previous }
      draftSequence.current++
      return { ...previous, works: { ...previous.works, [bundle.work.id]: { ...saved, journal: result.state, selectedVersionId: version.id, selectedBranchId: version.branchId } } }
    })
  }

  const previewLocal = (kind: LocalOrganizeKind) => {
    setError(null); setNotice(null)
    try {
      const result = organizePromptText(draft, { kind })
      if (!result.changed) { setLocalPreview(null); setNotice('没有可整理的变化'); return }
      setLocalPreview({ kind, text: result.text, applied: result.applied, sourceDraft: draft })
    } catch (cause) {
      setLocalPreview(null)
      setError('本地整理失败：' + String(cause))
    }
  }

  const applyLocalPreview = () => {
    if (!localPreview) return
    if (localPreview.sourceDraft !== draft) {
      setLocalPreview(null)
      setError('草稿已改变，本地整理预览已失效，请重新预览')
      return
    }
    if (!editText(localPreview.text, '本地整理：' + LOCAL_ORGANIZE_LABEL[localPreview.kind])) return
    invalidateOrganize()
    setNotice('已应用本地整理：' + LOCAL_ORGANIZE_LABEL[localPreview.kind])
  }

  const requestOrganize = async () => {
    if (!api || !bundle || !current) return
    const propose = (api as { proposeOrganize?: (input: OrganizeRequest) => Promise<OrganizeResponse> }).proposeOrganize
    if (!propose) { setError('当前版本不支持 AI 整理'); return }
    const seq = ++organizeSeq.current
    const request: OrganizeRequest = { workId: bundle.work.id, versionId: current.id, expectedRevision: bundle.work.revision, draft }
    const capturedRevision = journal.revision
    setOrganizeBusy(true); setOrganizeConfirm(false); setLocalPreview(null); setProposals([]); setError(null); setNotice(null)
    try {
      const result = await propose(request)
      // The reply is only valid for the draft/work/version that produced it. A switch while
      // the model is running must discard the reply instead of applying it to another draft.
      const stale = seq !== organizeSeq.current
        || draftRef.current !== request.draft
        || bundleRef.current?.work.id !== request.workId
        || selectedVersionRef.current !== request.versionId
        || stateRef.current.works[request.workId]?.journal.revision !== capturedRevision
      if (stale) { setNotice('草稿或版本已切换，已丢弃本次 AI 整理建议'); return }
      if (!result || result.ok !== true) {
        const code = result && result.ok === false ? result.code : 'INVALID_PLAN'
        const message = result && result.ok === false ? result.message : '供应商返回了无法识别的结果'
        setError('AI 整理失败 [' + code + ']：' + message)
        return
      }
      setProposals(result.changes)
      proposalBase.current = { workId: request.workId, versionId: request.versionId, revision: capturedRevision, groupId: crypto.randomUUID() }
      setNotice(result.changes.length ? 'AI 返回 ' + result.changes.length + ' 条逐块建议，请逐条接受或拒绝。' : 'AI 没有发现需要修改的块。')
    } catch (cause) {
      if (seq === organizeSeq.current) setError('AI 整理失败：' + String(cause))
    } finally {
      if (seq === organizeSeq.current) setOrganizeBusy(false)
    }
  }

  const acceptProposal = (suggestion: OrganizeSuggestion) => {
    if (readOnly || !bundle) return
    try {
      const base = proposalBase.current
      if (!base || base.workId !== bundle.work.id || base.versionId !== selectedVersionId || base.revision !== journal.revision) throw new OrganizePlanError('STALE_SUGGESTION', '草稿已改变，建议已失效，请重新预览')
      const result = applyOrganizeSuggestions(parsePromptDocument(draft), [suggestion])
      const block = parsePromptDocument(draft).blocks[suggestion.block]
      if (!commitDraft({ expectedRevision: base.revision, transactionId: crypto.randomUUID(), source: 'agent', operation: 'AI 整理', groupId: base.groupId, changes: [{ kind: 'text', target: 'primary', range: block.range, expectedText: suggestion.before, text: suggestion.after }] })) return
      proposalBase.current = { ...base, revision: stateRef.current.works[base.workId].journal.revision }
      setProposals(list => list.filter(item => item.block !== suggestion.block))
      setError(null)
      setNotice(result.changed ? '已接受：' + suggestion.title : '该建议没有改变草稿')
    } catch (error) {
      const detail = error instanceof OrganizePlanError ? error.code + ': ' + error.message : String(error)
      setError('无法应用这条建议 [' + detail + ']')
    }
  }

  const rejectProposal = (suggestion: OrganizeSuggestion) => {
    setProposals(list => list.filter(item => item.block !== suggestion.block))
    setNotice('已拒绝：' + suggestion.title)
  }

  const changeHistory = (action: 'undo' | 'redo' | 'agent') => {
    if (readOnly || !bundle) return
    updateWorkbench(previous => {
      const saved = previous.works[bundle.work.id]
      if (!saved) return previous
      const result = action === 'undo' ? undoNovelaiDraft(saved.journal, journal.revision) : action === 'redo' ? redoNovelaiDraft(saved.journal, journal.revision) : undoNovelaiAgent(saved.journal, journal.revision)
      if (!result.ok) { setError('撤销或重做未应用 [' + result.code + ']，后续用户输入已保留'); return previous }
      if (result.changed) draftSequence.current++
      setError(null)
      return { ...previous, works: { ...previous.works, [bundle.work.id]: { ...saved, journal: result.state } } }
    })
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {!decodedState.ok && <p role="alert" className="ui-inline-note ui-inline-note-danger m-2 shrink-0 text-xs">草稿格式无法读取 [{decodedState.code}]，原数据已保留。请从备份恢复可读取的草稿。</p>}
      {lease.error && <div role="alert" className="ui-inline-note ui-inline-note-warning m-2 shrink-0 flex-wrap text-xs"><span>编辑权不可用：{lease.error.message}。当前输入已保留。</span><Button size="sm" onClick={lease.retry}>重新取得编辑权</Button></div>}
      {editor && <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1 text-xs"><Button size="sm" onClick={() => { void editor.flush('user-save').then(result => { if (result.status === 'saved') setNotice('草稿已保存'); else if (result.status === 'error') setError(result.message) }) }} disabled={readOnly || editor.status === 'loading'}>保存草稿</Button><span className="text-[var(--color-text-secondary)]">{editor.dirty ? '草稿有未保存修改' : '草稿已同步'}</span></div>}
      <PanelHeader title="提示词工作台" description="原文 · 多角色 · 版本记录" icon={GitBranch} />
      {error && <p role="alert" className="ui-inline-note ui-inline-note-danger mx-2 mb-2 shrink-0 break-words text-xs">{error}</p>}
      {notice && <p role="status" className="mx-3 mb-2 shrink-0 break-words text-xs text-[var(--color-text-secondary)]">{notice}</p>}
      {/* Wrap instead of squeezing: a narrow panel used to shrink the middle column to a sliver
          and render every label vertically. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <aside className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-2">
          <div className="flex min-w-[min(100%,10rem)] flex-wrap gap-1">
            <input value={newWorkName} onChange={event => setNewWorkName(event.target.value)} placeholder="新作品名" readOnly={readOnly} className="ui-field min-w-[min(100%,8rem)] flex-1 px-2 py-1 text-xs" />
            <Button size="sm" variant="secondary" onClick={() => void createWork()} disabled={readOnly || busy || !newWorkName.trim()} aria-label="新建作品"><Plus size={14} /></Button>
          </div>
          <div className="flex max-h-24 min-w-[min(100%,8rem)] flex-1 flex-wrap gap-1 overflow-auto">
            {works.length === 0 && <p className="p-2 text-xs text-[var(--color-text-secondary)]">还没有作品</p>}
            {works.map(work => (
              <button key={work.id} type="button" onClick={() => void loadBundle(work.id)}
                className={'ui-nav-tab max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1.5 text-left text-xs ' + (bundle?.work.id === work.id ? 'ui-nav-tab-active' : '')}>
                {work.name}
              </button>
            ))}
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {!bundle ? (
            <EmptyState icon={GitBranch} title="选择或新建一个作品" description="每个作品有自己的版本线；回到旧版再改会自动拉分支。" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <span className="text-sm font-medium">{bundle.work.name}</span>
                <Badge tone="neutral">r{bundle.work.revision}</Badge>
                <input value={branchName} onChange={event => setBranchName(event.target.value)} placeholder="分支名" className="ui-field w-24 min-w-[5rem] shrink px-2 py-1 text-xs" />
                <Button size="sm" variant="ghost" onClick={() => void renameBranch()} disabled={readOnly || busy || !branchName.trim()}>命名分支</Button>
                {bundle && branches.length > 1 && (
                  <span className="flex flex-wrap items-center gap-1" aria-label="分支列表">
                    <span className="text-[11px] text-[var(--color-text-secondary)]">分支：</span>
                    {branches.map(branch => (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => void loadBundle(bundle.work.id, branch.id)}
                        title={'分支 ' + branch.branchNumber + ' · ' + branch.size + ' 个版本（起于 v' + branch.number + '）'}
                        className={'rounded border px-1.5 py-0.5 text-[11px] ' + (activeBranch && activeBranch.id === branch.id ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}
                      >
                        {branch.name || '分支 ' + branch.branchNumber}
                        <span className="ml-1 opacity-60">b{branch.branchNumber} · {branch.size} 版</span>
                      </button>
                    ))}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" variant="primary" icon={Save} onClick={() => void saveVersion()} disabled={busy || !canSave || readOnly}>保存为新版本</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void deleteVersion('single')} disabled={readOnly || busy}>删此版本</Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteVersion('branch')} disabled={readOnly || busy}>删整条分支</Button>
                  {branchFrom && (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent-text)]">
                      将从 v{branchFrom.number} 开新分支
                      <button type="button" className="underline" onClick={() => setBranchFrom(null)}>取消</button>
                    </span>
                  )}
                  <Button size="sm" variant="ghost" icon={FileDown} onClick={() => void exportMetadata()} disabled={busy}>参数写入 PNG</Button>
                  <Button size="sm" variant="ghost" icon={FileUp} onClick={() => void importMetadata()} disabled={readOnly || busy}>从 PNG 读取</Button>
                  <Button size="sm" variant="ghost" onClick={() => previewLocal('dedupe')} disabled={busy || organizeBusy || !draft.trim()} title="本地去重">去重</Button>
                  <Button size="sm" variant="ghost" onClick={() => previewLocal('sort')} disabled={busy || organizeBusy || !draft.trim()} title="本地排序">排序</Button>
                  <Button size="sm" variant="ghost" onClick={() => previewLocal('cleanup')} disabled={busy || organizeBusy || !draft.trim()} title="本地清理">清理</Button>
                  <Button size="sm" variant="secondary" onClick={() => setOrganizeConfirm(true)} disabled={busy || organizeBusy || !draft.trim()}>AI 整理</Button>
                </span>
              </div>
              {organizeConfirm && (
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[11px]" aria-label="AI 整理确认">
                  <span>将把当前草稿的 {blocks.length} 个块发送给设置中启用的 AI 供应商（使用其默认模型），只返回逐块修改建议，不会自动保存。</span>
                  <Button size="sm" variant="primary" onClick={() => void requestOrganize()}>确认发送</Button>
                  <Button size="sm" variant="ghost" onClick={() => setOrganizeConfirm(false)}>取消发送</Button>
                </div>
              )}
              {organizeBusy && <p className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">正在请求已配置的 AI 供应商…</p>}
              {localPreview && (
                <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px]" aria-label="本地整理预览">
                  <div className="text-[var(--color-text-secondary)]">预览（{LOCAL_ORGANIZE_LABEL[localPreview.kind]}，{localPreview.applied} 个块）：</div>
                  <div className="mt-1 break-words font-mono">{localPreview.text}</div>
                  <div className="mt-1 flex gap-1">
                    <Button size="sm" variant="primary" onClick={applyLocalPreview} disabled={readOnly}>应用预览</Button>
                    <Button size="sm" variant="ghost" onClick={() => setLocalPreview(null)}>取消预览</Button>
                  </div>
                </div>
              )}
              {proposals.length > 0 && (
                <div className="max-h-56 overflow-auto border-b border-[var(--color-border)] px-3 py-2" aria-label="AI 整理建议列表">
                  <div className="mb-1 text-[11px] text-[var(--color-text-secondary)]">AI 逐块建议（接受后只改当前草稿，仍需保存版本）</div>
                  {proposals.map((proposal, index) => (
                    <div key={proposal.block + ':' + proposal.before} className="mb-2 rounded border border-[var(--color-border)] p-2 text-[11px]" aria-label={'整理建议 ' + (index + 1)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{proposal.title}</span>
                        <span className="text-[var(--color-text-secondary)]">块 {proposal.block + 1}</span>
                      </div>
                      <div className="mt-1 break-words">原：<span className="font-mono text-[var(--color-text-secondary)] line-through">{proposal.before}</span></div>
                      <div className="break-words">新：<span className="font-mono">{proposal.after}</span></div>
                      <div className="mt-1 text-[var(--color-text-secondary)]">{proposal.reason}</div>
                      <div className="mt-1 flex gap-1">
                        <Button size="sm" variant="primary" onClick={() => acceptProposal(proposal)} disabled={readOnly}>接受</Button>
                        <Button size="sm" variant="ghost" onClick={() => rejectProposal(proposal)}>拒绝</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <NovelaiDocumentEditor journal={journal} readOnly={readOnly} onCommit={commitDraft} onHistory={changeHistory} onError={setError} />
              <div className="border-t border-[var(--color-border)] px-3 py-2">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]"><History size={12} /> 当前这条线（{bundle.line.length} 版）</div>
                {current && (
                  <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                    <span>这版用到的素材：</span>
                    {versionAssets.length === 0 ? <span>暂无</span> : versionAssets.map(item => (
                      <span key={item.asset.id + item.imageId} className="rounded border border-[var(--color-border)] px-1.5 py-0.5">{item.asset.name} · {item.imageId}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {bundle.line.map(version => (
                    <span key={version.id} className="inline-flex items-center gap-0.5">
                      <button type="button" onClick={() => selectVersion(version)}
                        className={'rounded border px-2 py-0.5 text-[11px] ' + (version.id === selectedVersionId ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>
                        v{version.number} · {version.operation || '编辑'} · b{version.branchNumber}
                      </button>
                      <button type="button" title={'以 v' + version.number + ' 为基准对比'} aria-label={'对比 v' + version.number}
                        onClick={() => setCompareBase(compareBase?.id === version.id ? null : version)}
                        className={'rounded border px-1 py-0.5 text-[10px] ' + (compareBase?.id === version.id ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)]')}>
                        对比
                      </button>
                      <button type="button" title={'从 v' + version.number + ' 开新分支'} aria-label={'从 v' + version.number + ' 开新分支'}
                        onClick={() => { setBranchFrom(version); selectVersion(version) }}
                        className={'rounded border px-1 py-0.5 text-[10px] ' + (branchFrom?.id === version.id ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)]')}>
                        开分支
                      </button>
                    </span>
                  ))}
                </div>
                {comparison && compareBase && current && (
                  <div className="mt-2 rounded border border-[var(--color-border)] p-2 text-[11px]" aria-label="版本对比">
                    <div className="text-[var(--color-text-secondary)]">v{compareBase.number} → v{current.number}：{comparison.summary}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {comparison.added.map(item => <span key={'a' + item.text} className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[var(--color-success)]">+ {item.text}</span>)}
                      {comparison.removed.map(item => <span key={'r' + item.text} className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[var(--color-danger)]">- {item.text}</span>)}
                      {comparison.reweighted.map(item => <span key={'w' + item.text} className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">~ {item.text} {item.before}→{item.after}</span>)}
                    </div>
                  </div>
                )}
                {bundle.deleted.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                    回收站：
                    {bundle.deleted.map(version => (
                      <span key={version.id} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5">
                        <input type="checkbox" className="ui-checkbox" aria-label={'选择 v' + version.number} checked={picked.includes(version.id)} onChange={() => togglePick(version.id)} />
                        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void restore(version.id)} disabled={readOnly || busy}>v{version.number}</Button>
                      </span>
                    ))}
                    {bundle.deleted.length > 1 && (
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setPicked(bundle.deleted.map(version => version.id))} disabled={busy}>全选</Button>
                        <Button size="sm" variant="ghost" onClick={() => void restorePicked()} disabled={readOnly || busy || !picked.length}>恢复选中（{picked.length}）</Button>
                        <Button size="sm" variant="ghost" onClick={() => void purgePicked()} disabled={readOnly || busy || !picked.length}>永久删除选中</Button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
