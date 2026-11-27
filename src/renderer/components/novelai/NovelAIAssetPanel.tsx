import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Library, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import { useOptionalWorkspaceEditorState } from '../workspace/WorkspaceEditorHost'
import { useNovelaiEditLease } from './use-novelai-edit-lease'
import type { NovelaiEditProof } from '../../../shared/novelai-edit-types'

// NovelAI asset library (M6 UI). Presentation only: reference guarding, usage idempotence and the
// delete guard live in novelai-asset.service and are covered by its tests.
type Asset = { id: string; kind: string; name: string; payload: string; examples: string[]; uses: number; updatedAt: string; revision?: number }
type Usage = { imageId: string; via: string; usedAt: string }
type VersionUse = { versionId: string; workId: string; number: number; imageId: string }

const KINDS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'character', label: '角色' },
  { value: 'style', label: '风格' },
  { value: 'scene', label: '场景' },
  { value: 'object', label: '物件' },
  { value: 'other', label: '其它' },
]

type Api = {
  list: (kind?: string) => Promise<Asset[]>
  create: (input: { kind: string; name: string; payload?: string }) => Promise<Asset>
  update: (id: string, patch: Record<string, unknown>, edit?: NovelaiEditProof) => Promise<Asset>
  remove: (id: string, force?: boolean, expectedImageIds?: string[], options?: { edit?: NovelaiEditProof; expectedRevision?: number }) => Promise<boolean>
  use: (input: { assetId: string; imageId: string; via?: string; edit?: NovelaiEditProof }) => Promise<boolean>
  images: (assetId: string) => Promise<Usage[]>
  byImage: (imageId: string) => Promise<Asset[]>
  versions: (assetId: string) => Promise<VersionUse[]>
}

type AssetEditorState = { kind: 'novelai-assets'; version: 1; selectedAssetId: string | null; assets: Record<string, { payload: string; baseRevision: number }> }
function assetEditorState(value: unknown): AssetEditorState {
  const state = value as AssetEditorState | null
  return state?.kind === 'novelai-assets' && state.version === 1 && state.assets && typeof state.assets === 'object' ? state : { kind: 'novelai-assets', version: 1, selectedAssetId: null, assets: {} }
}

export function NovelAIAssetPanel() {
  const editor = useOptionalWorkspaceEditorState<AssetEditorState>()
  const editorRef = useRef(editor); editorRef.current = editor
  const [kind, setKind] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [usages, setUsages] = useState<Usage[]>([])
  const [versionUses, setVersionUses] = useState<VersionUse[]>([])
  const [newName, setNewName] = useState('')
  const [imageId, setImageId] = useState('')
  const [lookupImage, setLookupImage] = useState('')
  const [lookupResult, setLookupResult] = useState<Asset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletePreview, setDeletePreview] = useState<{ asset: Asset; images: Usage[]; versions: VersionUse[] } | null>(null)
  const deletePreviewSequence = useRef(0)
  const selectAsset = useCallback((id: string | null) => {
    deletePreviewSequence.current += 1
    setDeletePreview(null)
    setSelectedId(id)
    const host = editorRef.current
    if (host && host.status !== 'loading') host.updateState(current => ({ ...assetEditorState(current), selectedAssetId: id }))
  }, [])

  const api = (typeof window !== 'undefined' ? (window as unknown as { api?: { novelai?: { assets?: Api } } }).api?.novelai?.assets : undefined)
  const selected = useMemo(() => assets.find(asset => asset.id === selectedId) ?? null, [assets, selectedId])
  const lease = useNovelaiEditLease(selected ? { kind: 'asset', id: selected.id } : null)
  const readOnly = Boolean(editor?.frozen || selected && lease.supported && lease.status !== 'ready')
  useEffect(() => {
    if (!editor?.registerTransferAdapter) return
    return editor.registerTransferAdapter({ ready: () => assetsLoaded && (assets.length === 0 || selected !== null) })
  }, [editor?.registerTransferAdapter, selected?.id, assets.length, assetsLoaded])
  const slot = selected ? assetEditorState(editor?.state).assets[selected.id] : undefined
  const payload = slot?.payload ?? selected?.payload ?? ''
  const setPayload = (value: string) => {
    if (!selected || readOnly) return
    const host = editorRef.current
    if (host) host.updateState(current => {
      const state = assetEditorState(current)
      return { ...state, selectedAssetId: selected.id, assets: { ...state.assets, [selected.id]: { payload: value, baseRevision: state.assets[selected.id]?.baseRevision ?? selected.revision ?? 1 } } }
    })
    else setAssets(current => current.map(asset => asset.id === selected.id ? { ...asset, draftPayload: value } : asset))
  }
  const persistPayload = async (value: string) => {
    if (!api || !selected || readOnly || value === selected.payload) return
    const target = selected.id
    const revision = slot?.baseRevision ?? selected.revision ?? 1
    try {
      const edit = await lease.proof()
      const saved = await api.update(target, { payload: value, expectedRevision: revision }, ...(edit ? [edit] : []))
      setAssets(current => current.map(asset => asset.id === target ? saved : asset))
      editorRef.current?.updateState(current => {
        const state = assetEditorState(current)
        const slot = state.assets[target]
        return { ...state, assets: { ...state.assets, [target]: { payload: slot?.payload ?? value, baseRevision: saved.revision ?? revision + 1 } } }
      })
    } catch (cause) { setError(String(cause)) }
  }

  const refresh = useCallback(async () => {
    if (!api || editorRef.current?.status === 'loading') return
    const list = await api.list(kind || undefined)
    setAssets(list)
    setAssetsLoaded(true)
    if (list.length && !list.some(asset => asset.id === selectedId)) { const stored = assetEditorState(editorRef.current?.state).selectedAssetId; selectAsset(list.some(asset => asset.id === stored) ? stored : list[0].id) }
  }, [api, kind, selectedId, selectAsset, editor?.status])

  useEffect(() => { void refresh().catch(cause => setError(String(cause))) }, [refresh])

  useEffect(() => {
    if (!api || !selectedId) { setUsages([]); return }
    let alive = true
    void api.images(selectedId).then(list => { if (alive) setUsages(list) }).catch(cause => { if (alive) setError(String(cause)) })
    void api.versions(selectedId).then(list => { if (alive) setVersionUses(list ?? []) }).catch(() => { if (alive) setVersionUses([]) })
    return () => { alive = false }
  }, [api, selectedId])

  const create = async () => {
    if (!api || !newName.trim()) return
    setBusy(true); setError(null)
    try { await api.create({ kind: kind || 'other', name: newName.trim() }); setNewName(''); await refresh() } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const recordUse = async () => {
    if (!api || !selected || !imageId.trim()) return
    setBusy(true); setError(null)
    try { const edit = await lease.proof(); await api.use({ assetId: selected.id, imageId: imageId.trim(), ...(edit ? { edit } : {}) }); setImageId(''); await refresh(); setUsages(await api.images(selected.id)) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!api || !selected || busy) return
    const sequence = ++deletePreviewSequence.current
    setBusy(true); setError(null)
    try {
      const [images, versions] = await Promise.all([api.images(selected.id), api.versions(selected.id)])
      if (sequence === deletePreviewSequence.current) setDeletePreview({ asset: selected, images, versions })
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const confirmRemove = async () => {
    if (!api || !deletePreview || busy || selectedId !== deletePreview.asset.id) return
    const target = deletePreview.asset
    setBusy(true); setError(null)
    try {
      const edit = await lease.proof()
      await api.remove(target.id, true, deletePreview.images.map(item => item.imageId), ...(edit ? [{ edit, expectedRevision: target.revision ?? 1 }] : []))
      selectAsset(null)
      await refresh()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const lookup = async () => {
    if (!api || !lookupImage.trim()) return
    setBusy(true); setError(null)
    try { setLookupResult(await api.byImage(lookupImage.trim())) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {lease.error && <div role="alert" className="ui-inline-note ui-inline-note-warning m-2 shrink-0 flex-wrap text-xs"><span>编辑权不可用：{lease.error.message}。当前草稿已保留。</span><Button size="sm" onClick={lease.retry}>重新取得编辑权</Button></div>}
      {editor && <div className="flex shrink-0 items-center gap-2 px-3 py-1 text-xs"><Button size="sm" disabled={readOnly || editor.status === 'loading'} onClick={() => { void editor.flush('asset-draft-save').then(result => { if (result.status === 'error') setError(result.message) }) }}>保存素材草稿</Button><span>{editor.dirty ? '草稿有未保存修改' : '草稿已同步'}</span></div>}
      <PanelHeader title="素材库" description="角色 / 风格 / 场景 · 「这块用在哪些图」（M6）" icon={Library} />
      {/* Same narrow-panel rule as the workbench: wrap instead of squeezing. */}
      <div className="flex min-h-0 flex-1 flex-wrap">
        <aside className="flex w-52 min-w-[10rem] shrink-0 flex-col gap-2 border-r border-[var(--color-border)] p-2">
          <div className="flex flex-wrap gap-1">
            {KINDS.map(item => (
              <button key={item.value} type="button" onClick={() => setKind(item.value)}
                className={'rounded border px-2 py-0.5 text-[11px] ' + (kind === item.value ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <input value={newName} onChange={event => setNewName(event.target.value)} placeholder="新素材名" className="ui-field min-w-[8rem] flex-1 px-2 py-1 text-xs" aria-label="新素材名" />
            <Button size="sm" variant="secondary" onClick={() => void create()} disabled={busy || !newName.trim()} aria-label="新建素材"><Plus size={14} /></Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {assets.length === 0 && <p className="p-2 text-xs text-[var(--color-text-secondary)]">还没有素材</p>}
            {assets.map(asset => (
              <button key={asset.id} type="button" onClick={() => selectAsset(asset.id)}
                className={'flex w-full items-center gap-1 overflow-hidden px-2 py-1 text-left text-xs ' + (selectedId === asset.id ? 'bg-[var(--color-hover)] text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)]')}>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{asset.name}</span>
                <span className="shrink-0 text-[10px]">{asset.uses}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="flex min-h-0 min-w-[18rem] flex-1 flex-col gap-2 p-3">
          {!selected ? (
            <EmptyState icon={Library} title="选择或新建一个素材" description="素材可以被多张图引用；删除前会检查引用。" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{selected.name}</span>
                <Badge tone="accent">{selected.kind}</Badge>
                <Badge tone="neutral">引用 {selected.uses}</Badge>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove()} disabled={busy || readOnly}>删除素材</Button>
              </div>
              <textarea key={selected.id} value={editor ? payload : (selected as Asset & {draftPayload?:string}).draftPayload ?? selected.payload} aria-label="素材内容" spellCheck={false} readOnly={readOnly}
                onChange={event => setPayload(event.target.value)} onBlur={event => { void persistPayload(event.target.value) }}
                className="ui-field h-24 resize-none px-2 py-2 font-mono text-xs" />
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                <ImageIcon size={12} /> 用在哪些图：
                {usages.length === 0 ? <span>暂无引用</span> : usages.map(usage => (
                  <span key={usage.imageId} className="rounded border border-[var(--color-border)] px-1.5 py-0.5">{usage.imageId} · {usage.via || 'manual'}</span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                <span>用在哪些版本：</span>
                {versionUses.length === 0 ? <span>暂无</span> : versionUses.map(use => (
                  <span key={use.versionId + use.imageId} className="rounded border border-[var(--color-border)] px-1.5 py-0.5">v{use.number} · {use.imageId}</span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <input value={imageId} onChange={event => setImageId(event.target.value)} placeholder="图片 ID" className="ui-field w-40 px-2 py-1 text-xs" aria-label="图片 ID" />
                <Button size="sm" variant="secondary" onClick={() => void recordUse()} disabled={busy || readOnly || !imageId.trim()}>记一次引用</Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-[var(--color-border)] pt-2">
                <Search size={12} className="text-[var(--color-text-secondary)]" />
                <input value={lookupImage} onChange={event => setLookupImage(event.target.value)} placeholder="反查：这张图用了哪些素材" className="ui-field w-60 px-2 py-1 text-xs" aria-label="反查图片 ID" />
                <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void lookup()} disabled={busy || !lookupImage.trim()}>反查</Button>
                {lookupResult && <span className="text-[11px] text-[var(--color-text-secondary)]">{lookupResult.length ? lookupResult.map(asset => asset.name).join('、') : '这张图还没有素材'}</span>}
              </div>
            </>
          )}
          {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
        </main>
      </div>
      <Modal title="确认删除素材" open={deletePreview !== null} onClose={() => { if (!busy) { deletePreviewSequence.current += 1; setDeletePreview(null) } }}>
        {deletePreview && <div className="space-y-3 text-sm">
          <p>将删除「{deletePreview.asset.name}」以及它的素材引用记录；图片文件和作品版本保留。</p>
          <p>已关联 {deletePreview.images.length} 张图，当前可见 {deletePreview.versions.length} 个版本关系。回收站版本可能仍引用这些图片。</p>
          <div className="max-h-32 overflow-auto break-all text-xs">{deletePreview.images.map(usage => <div key={usage.imageId}>{usage.imageId}</div>)}</div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDeletePreview(null)} disabled={busy}>取消删除</Button>
            <Button variant="danger" onClick={() => void confirmRemove()} disabled={busy}>确认删除</Button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}
