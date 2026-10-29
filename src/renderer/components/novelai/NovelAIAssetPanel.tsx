import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Library, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'

// NovelAI asset library (M6 UI). Presentation only: reference guarding, usage idempotence and the
// delete guard live in novelai-asset.service and are covered by its tests.
type Asset = { id: string; kind: string; name: string; payload: string; examples: string[]; uses: number; updatedAt: string }
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
  update: (id: string, patch: Record<string, unknown>) => Promise<Asset>
  remove: (id: string, force?: boolean) => Promise<boolean>
  use: (input: { assetId: string; imageId: string; via?: string }) => Promise<boolean>
  images: (assetId: string) => Promise<Usage[]>
  byImage: (imageId: string) => Promise<Asset[]>
  versions: (assetId: string) => Promise<VersionUse[]>
}

export function NovelAIAssetPanel() {
  const [kind, setKind] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [usages, setUsages] = useState<Usage[]>([])
  const [versionUses, setVersionUses] = useState<VersionUse[]>([])
  const [newName, setNewName] = useState('')
  const [imageId, setImageId] = useState('')
  const [lookupImage, setLookupImage] = useState('')
  const [lookupResult, setLookupResult] = useState<Asset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const api = (typeof window !== 'undefined' ? (window as unknown as { api?: { novelai?: { assets?: Api } } }).api?.novelai?.assets : undefined)
  const selected = useMemo(() => assets.find(asset => asset.id === selectedId) ?? null, [assets, selectedId])

  const refresh = useCallback(async () => {
    if (!api) return
    const list = await api.list(kind || undefined)
    setAssets(list)
    if (list.length && !list.some(asset => asset.id === selectedId)) setSelectedId(list[0].id)
  }, [api, kind, selectedId])

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
    try { await api.use({ assetId: selected.id, imageId: imageId.trim() }); setImageId(''); await refresh(); setUsages(await api.images(selected.id)) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!api || !selected) return
    setBusy(true); setError(null)
    try { await api.remove(selected.id, true); setSelectedId(null); await refresh() } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const lookup = async () => {
    if (!api || !lookupImage.trim()) return
    setBusy(true); setError(null)
    try { setLookupResult(await api.byImage(lookupImage.trim())) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
              <button key={asset.id} type="button" onClick={() => setSelectedId(asset.id)}
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
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove()} disabled={busy}>删除素材</Button>
              </div>
              <textarea defaultValue={selected.payload} aria-label="素材内容" spellCheck={false}
                onBlur={event => { if (api && event.target.value !== selected.payload) void api.update(selected.id, { payload: event.target.value }).then(() => refresh()).catch(cause => setError(String(cause))) }}
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
                <Button size="sm" variant="secondary" onClick={() => void recordUse()} disabled={busy || !imageId.trim()}>记一次引用</Button>
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
    </div>
  )
}
