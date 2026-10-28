// 魔导书 Grimoire v7 — 图库搜索面板（宿主）
// Composes the filter rail, toolbar, virtual grid, card, inspector and footer
// batch actions over the gallery store. Thumbnails are loaded per visible
// window through media.thumbs (no per-asset full dataURL reads).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { TagAutocomplete } from '../tags/TagAutocomplete'
import { useTagsStore } from '../../stores/tags.store'
import { useGalleryStore, type GalleryItem } from '../../stores/gallery.store'
import { FilterRail } from './FilterRail'
import { GalleryToolbar } from './GalleryToolbar'
import { SyntaxQueryBar } from './SyntaxQueryBar'
import { SavedSearches } from './SavedSearches'
import { VirtualGrid } from './VirtualGrid'
import { GalleryCard } from './GalleryCard'
import { InspectorPanel } from './InspectorPanel'

export function GallerySearchPanel() {
  const query = useGalleryStore(state => state.query)
  const items = useGalleryStore(state => state.items)
  const total = useGalleryStore(state => state.total)
  const page = useGalleryStore(state => state.page)
  const pageSize = useGalleryStore(state => state.pageSize)
  const loading = useGalleryStore(state => state.loading)
  const error = useGalleryStore(state => state.error)
  const selection = useGalleryStore(state => state.selection)
  const selectionMode = useGalleryStore(state => state.selectionMode)
  const allTags = useTagsStore(state => state.tags)

  const [thumbs, setThumbs] = useState<Record<number, string | null>>({})
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [activeId, setActiveId] = useState<number | null>(null)
  const [batchTag, setBatchTag] = useState<{ id: string; label: string } | null>(null)
  const [message, setMessage] = useState('')
  const reloadTimer = useRef(0)
  const firstLoad = useRef(true)

  useEffect(() => {
    void useGalleryStore.getState().loadSavedSearches()
    void useGalleryStore.getState().load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const queryKey = JSON.stringify(query)
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false
      return
    }
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => { void useGalleryStore.getState().load() }, 180)
    return () => window.clearTimeout(reloadTimer.current)
  }, [queryKey, page])

  useEffect(() => {
    const visible = items.slice(range.start, range.end).map(item => item.imageRefId)
    const missing = visible.filter(id => !(id in thumbs))
    if (!missing.length) return
    let disposed = false
    void window.api.media.thumbs({ ids: missing, kind: 'thumbnail' }).then(map => {
      if (!disposed) setThumbs(current => ({ ...current, ...map }))
    }).catch(() => { /* missing thumbnails fall back to the placeholder card */ })
    return () => { disposed = true }
  }, [items, range, thumbs])

  const visibleIds = useMemo(() => items.slice(range.start, range.end).map(item => item.imageRefId), [items, range])
  const activeItem = items.find(item => item.imageRefId === activeId) || null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const isSelected = (id: number) => selectionMode === 'allFiltered' || selection.has(id)

  const applyBadge = async (item: GalleryItem, kind: 'favorite' | 'rating', value?: number) => {
    try {
      if (kind === 'favorite') await window.api.media.update({ id: item.mediaId, favorite: !item.favorite })
      else await window.api.media.update({ id: item.mediaId, rating: value ?? 0 })
      void useGalleryStore.getState().load()
    } catch { /* badge updates are best-effort */ }
  }

  const applyBatchTag = async () => {
    if (!batchTag) return
    if (selectionMode === 'allFiltered') {
      setMessage('“全部筛选”选择请使用标签批量工具面板执行写入')
      return
    }
    const ids = [...useGalleryStore.getState().selection]
    if (!ids.length) {
      setMessage('请先选择资产')
      return
    }
    try {
      const count = await window.api.tags.assetLinks.batchAssign({ assetType: 'image', assetKeys: ids.map(id => 'image:' + id), tagIds: [batchTag.id], source: 'manual' })
      setMessage(`已为 ${count} 个资产添加「${batchTag.label}」`)
      setBatchTag(null)
      useGalleryStore.getState().clearSelection()
      void useGalleryStore.getState().load()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '批量标注失败')
    }
  }

  return (
    // Narrow panels used to squeeze the media column to a sliver and render the right-hand controls
    // vertically; wrapping keeps each column readable instead of shrinking both.
    <div className="flex h-full min-h-0 flex-wrap">
      <div className="flex w-60 min-w-[13rem] shrink-0 flex-col overflow-auto border-r border-[var(--color-border)]">
        <FilterRail />
        <SavedSearches className="border-t border-[var(--color-border)]" />
      </div>

      <div className="flex min-w-[12rem] flex-1 flex-col">
        <GalleryToolbar className="border-b border-[var(--color-border)]" />
        <SyntaxQueryBar className="border-b border-[var(--color-border)]" />

        {error ? (
          <div role="alert" className="ui-inline-alert m-2 text-xs">
            <span className="flex-1">{error}</span>
            <Button size="sm" variant="ghost" onClick={() => void useGalleryStore.getState().load()}>重试</Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <VirtualGrid
            items={items}
            getKey={item => item.imageRefId}
            renderItem={(item, index) => (
              <GalleryCard
                item={item}
                thumbnailUrl={thumbs[item.imageRefId] ?? null}
                selected={isSelected(item.imageRefId)}
                onToggleSelect={event => useGalleryStore.getState().toggleSelect(item.imageRefId, index, visibleIds, event.shiftKey)}
                onOpen={() => setActiveId(item.imageRefId)}
                onBadgeClick={(kind, value) => void applyBadge(item, kind, value)}
              />
            )}
            onVisibleRangeChange={setRange}
            emptyFallback={
              <div className="grid h-full place-items-center text-xs text-[var(--color-text-secondary)]" role="status">
                {loading ? '正在加载图库…' : '没有匹配的资产'}
              </div>
            }
          />
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] p-2 text-[11px]">
          <span className="text-[var(--color-text-secondary)]">共 {total} 个 · 第 {page + 1}/{pages} 页</span>
          <Button size="sm" disabled={page === 0 || loading} onClick={() => useGalleryStore.getState().setPage(page - 1)}>上一页</Button>
          <Button size="sm" disabled={page + 1 >= pages || loading} onClick={() => useGalleryStore.getState().setPage(page + 1)}>下一页</Button>
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <span>{selectionMode === 'allFiltered' ? '已选择：全部筛选结果' : `已选 ${selection.size}`}</span>
          <div className="w-44"><TagAutocomplete allTags={allTags} placeholder="批量添加标签…" onSelect={entry => setBatchTag({ id: entry.id, label: entry.zh || entry.en })} /></div>
          {batchTag ? <Badge tone="accent">{batchTag.label}</Badge> : null}
          <Button size="sm" onClick={() => void applyBatchTag()} disabled={!batchTag || selectionMode === 'allFiltered'}>批量标注</Button>
          {message ? <span className="text-[var(--color-text-secondary)]">{message}</span> : null}
        </footer>
      </div>

      <InspectorPanel item={activeItem} className="w-80 shrink-0 overflow-auto border-l border-[var(--color-border)]" onOpenSimilar={imageRefId => setActiveId(imageRefId)} />
    </div>
  )
}