// 魔导书 Grimoire v7 — 图片参考面板
import React, { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, FolderSearch, Heart, ImagePlus, Images, Link2, LoaderCircle, RefreshCw, ScanSearch, Search, Star, Trash2 } from 'lucide-react'

const PAGE_SIZE = 60
import { useI18n } from '../../i18n/context'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import type { ImageRef } from '@shared/types'
import { useTagsStore } from '../../stores/tags.store'
import { ResourceCard, ResourceGroup } from '../ui/ResourceCards'
import { FloatingPreview } from '../ui/FloatingPreview'
import { TagAutocomplete } from '../tags/TagAutocomplete'

export function ImagesPanel() {
  const { t } = useI18n()
  const [images, setImages] = useState<ImageRef[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'managed' | 'external' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urls, setUrls] = useState<Record<number, string>>({})
  const [preview, setPreview] = useState<ImageRef | null>(null)
  const [previewScale, setPreviewScale] = useState(1)
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 })
  const [previewDragging, setPreviewDragging] = useState(false)
  const previewViewportRef = React.useRef<HTMLDivElement>(null)
  const previewImageRef = React.useRef<HTMLImageElement>(null)
  const [previewBaseSize, setPreviewBaseSize] = useState({ width: 0, height: 0 })
  const [imageTags, setImageTags] = useState<Record<number, string[]>>({})
  const [mediaInfo, setMediaInfo] = useState<Record<number, { mediaId: string; source: string; favorite: boolean; rating: number; metadata: Record<string, unknown> }>>({})
  const [generationInfo, setGenerationInfo] = useState<Record<string, any>>({})
  const [previewRelations, setPreviewRelations] = useState<Array<{ relation_type: string; target_type: string; target_key: string; source_type: string; source_key: string }>>([])
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkTag, setBulkTag] = useState<{ id: string; label: string } | null>(null)
  const [tagFilterId, setTagFilterId] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [scanResult, setScanResult] = useState<{ directory: string; entries: Array<{ filePath: string; fileName: string; size: number; alreadyImported: boolean }>; total: number } | null>(null)
  const [scanSelected, setScanSelected] = useState<Set<string>>(new Set())
  const [folderTags, setFolderTags] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const tags = useTagsStore(state => state.tags)
  const fitPreviewImage = React.useCallback(() => {
    const viewport = previewViewportRef.current
    const image = previewImageRef.current
    if (!viewport || !image?.naturalWidth || !image.naturalHeight) return
    const fit = Math.min(Math.max(80, viewport.clientWidth - 24) / image.naturalWidth, Math.max(80, viewport.clientHeight - 24) / image.naturalHeight)
    setPreviewBaseSize({ width: Math.max(1, image.naturalWidth * fit), height: Math.max(1, image.naturalHeight * fit) })
  }, [])

  const notifyError = (message: string) => window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type: 'error' } }))
  
  const loadImages = useCallback(async () => {
    setLoading(true)
    try {
      // 分页加载（大库不全量进内存）；总数来自后端，页脚显示。
      const page = await window.api.images.listPaged({ limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE })
      const list = page.items
      setImages(list)
      setTotalCount(page.total)
      const media = await window.api.media.list({ limit: 500 }) as Array<{ id: string; image_ref_id: number; source_kind: string; favorite: boolean; rating: number; metadata: Record<string, unknown> }>
      setMediaInfo(Object.fromEntries(media.map(item => [item.image_ref_id, { mediaId: item.id, source: item.source_kind, favorite: item.favorite, rating: item.rating, metadata: item.metadata }])))
      // Batch thumbnail reads (wave D N+1 elimination): one IPC call for the
      // whole grid instead of a readData round trip per image. The preview
      // dialog lazily reads the full-size file on open (zoom needs the detail).
      const thumbMap = await window.api.media.thumbs({ ids: list.filter(item => item.available).map(item => item.id), kind: 'thumbnail' })
      const entries = list.filter(item => item.available).map(item => [item.id, thumbMap[item.id]] as const)
      setUrls(Object.fromEntries(entries.filter((entry): entry is readonly [number, string] => Boolean(entry))))
      const linkEntries = await window.api.tags.assetLinks.listBatch({ assetType: 'image', assetKeys: list.map(item => 'image:' + item.id) })
      setImageTags(Object.fromEntries(linkEntries.map(entry => [Number(entry.assetKey.replace('image:', '')), entry.tagIds])))
      setError(null)
    } catch (cause) {
      console.error('Failed to load image library:', cause)
      setError('资源库加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [pageIndex])
  
  useEffect(() => { loadImages() }, [loadImages])
  useEffect(() => window.api.media.onScanProgress(value => setScanProgress(value)), [])
  useEffect(() => {
    const cleanup = window.api.db.onReload(() => loadImages())
    const cleanupTasks = window.api.tasks.onUpdated(event => {
      if (event.kind === 'comfyui' && event.status === 'succeeded') void loadImages()
    })
    return () => { cleanup(); cleanupTasks() }
  }, [loadImages])
  
  const handleAdd = async (mode: 'managed' | 'external') => {
    setBusy(mode)
    try {
      const result = await window.api.images.add(mode)
      if (result) await loadImages()
    } catch (cause) {
      console.error('Failed to add image:', cause)
      notifyError(mode === 'managed' ? '导入图片副本失败' : '链接原文件失败')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (id: number) => {
    setBusy('delete')
    try {
      await window.api.images.delete(id)
      setDeleteConfirm(null)
      await loadImages()
    } catch (cause) {
      console.error('Failed to delete image:', cause)
      notifyError('删除图片记录失败')
    } finally {
      setBusy(null)
    }
  }
  
  const getFileName = (filePath: string) => {
    return filePath.split(/[\\/]/).pop() || filePath
  }

  const openPreview = (image: ImageRef) => {
    if (urls[image.id]) {
      setPreviewScale(1); setPreviewOffset({ x: 0, y: 0 }); setPreviewBaseSize({ width: 0, height: 0 }); setPreview(image); setPreviewRelations([])
      // Full-size read is per-open (zoom needs the detail the grid thumb lacks).
      void window.api.images.readData(image.id).then(full => { if (full) setUrls(current => ({ ...current, [image.id]: full })) }).catch(() => {})
      const mediaId = mediaInfo[image.id]?.mediaId
      if (mediaId) {
        void window.api.media.metadata.get(mediaId).then(value => setGenerationInfo(current => ({ ...current, [mediaId]: value }))).catch(() => {})
        void window.api.media.relations.list({ type: 'image', key: 'image:' + image.id }).then(value => setPreviewRelations(value as typeof previewRelations)).catch(() => {})
      }
    }
    else notifyError('图片文件不可用')
  }
  const toggleFavorite = async (image: ImageRef) => { const info = mediaInfo[image.id]; if (!info) return; const updated = await window.api.media.update({ id: info.mediaId, favorite: !info.favorite }) as { favorite?: boolean }; setMediaInfo(current => ({ ...current, [image.id]: { ...current[image.id], favorite: Boolean(updated.favorite) } })) }
  const setRating = async (image: ImageRef, rating: number) => { const info = mediaInfo[image.id]; if (!info) return; await window.api.media.update({ id: info.mediaId, rating }); setMediaInfo(current => ({ ...current, [image.id]: { ...current[image.id], rating } })) }
  const visibleImages = images.filter(image => {
    const info = mediaInfo[image.id]
    const text = (image.original_name || image.file_path).toLowerCase()
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false
    if (sourceFilter !== 'all' && info?.source !== sourceFilter) return false
    // Tag badge click narrows the grid (wave D: badge click filters); ids are
    // matched against the same assetLinks map the badges render from.
    if (tagFilterId && !(imageTags[image.id] || []).includes(tagFilterId)) return false
    return true
  })
  const toggleSelected = (id: number) => setSelectedIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const bulkAssignTag = async () => { if (!bulkTag || !selectedIds.size) return; await window.api.tags.assetLinks.batchAssign({ assetType: 'image', assetKeys: [...selectedIds].map(id => 'image:' + id), tagIds: [bulkTag.id], source: 'manual' }); setBulkTag(null); await loadImages() }
  const bulkDelete = async () => { if (!selectedIds.size || !window.confirm('确定删除选中的图片记录吗？')) return; await Promise.all([...selectedIds].map(id => window.api.images.delete(id))); setSelectedIds(new Set()); await loadImages() }
  // 存量图片补齐：扫描未解析的嵌入式生成元数据（A1111/NAI/ComfyUI），进度经推送通道显示。
  const scanMetadata = async () => {
    if (busy !== null) return
    setBusy('managed'); setScanProgress({ done: 0, total: 0 })
    try {
      const result = await window.api.media.metadata.scan({ batchSize: 16 }) as { scanned: number; parsed: number; skipped: number }
      window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message: `元数据扫描完成：解析 ${result.parsed} / 跳过 ${result.skipped}`, type: 'success' } }))
      await loadImages()
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : '元数据扫描失败')
    } finally {
      setBusy(null); setScanProgress(null)
    }
  }

  // 文件夹扫描导入：先扫描预览（不导入），用户勾选后按托管/外链两种模式导入。
  const scanFolder = async () => {
    if (busy !== null) return
    try {
      const picked = await window.api.dialog.openDirectory()
      if (!picked) return
      setBusy('managed')
      const result = await window.api.media.folderScan({ directory: picked, recursive: true })
      setScanResult(result)
      setScanSelected(new Set(result.entries.filter(entry => !entry.alreadyImported).map(entry => entry.filePath)))
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : '文件夹扫描失败')
    } finally {
      setBusy(null)
    }
  }
  const importScanned = async (mode: 'managed' | 'external') => {
    if (!scanSelected.size) return
    setBusy('managed')
    try {
      const result = await window.api.media.folderImport({ filePaths: [...scanSelected], mode })
      const suffix = folderTags ? '，并按目录名写入标签' : ''
      // 目录名 → 标签（TagStudio folders→tags 语义）：用相对扫描根的子目录路径
      // 作为标签名，先查同名标签复用，缺失时在首个子分类下创建。
      if (folderTags && scanResult && result.imageIds.length > 0) {
        try {
          const root = scanResult.directory.replace(/\\/g, '/').replace(/\/$/, '')
          const byTag = new Map<string, number[]>()
          for (const [index, filePath] of [...scanSelected].entries()) {
            const imageId = result.imageIds[index]
            if (!Number.isInteger(imageId)) continue
            const normalized = filePath.replace(/\\/g, '/')
            const relative = normalized.startsWith(root + '/') ? normalized.slice(root.length + 1) : normalized
            const segments = relative.split('/').slice(0, -1).filter(segment => segment && segment !== '.' && segment !== '..')
            for (const segment of segments) {
              const list = byTag.get(segment) || []
              list.push(imageId)
              byTag.set(segment, list)
            }
          }
          if (byTag.size > 0) {
            const all = await window.api.tags.getAll()
            const existing = new Map(all.tags.map(tag => [(tag.en || tag.zh || '').toLowerCase(), tag.id] as const))
            const subcategory = all.subcategories[0]
            for (const [name, ids] of byTag) {
              let tagId = existing.get(name.toLowerCase())
              if (!tagId) {
                if (!subcategory) break
                const created = await window.api.tags.create({ subcategory_id: subcategory.id, en: name, zh: name })
                tagId = created.id
                existing.set(name.toLowerCase(), tagId)
              }
              await window.api.tags.assetLinks.batchAssign({ assetType: 'image', assetKeys: ids.map(id => 'image:' + id), tagIds: [tagId], source: 'manual' })
            }
          }
        } catch { /* 目录标签失败不阻塞导入结果 */ }
      }
      window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message: `导入完成：${result.imported} 个（跳过 ${result.skipped}，失败 ${result.failed}）${suffix}`, type: result.failed ? 'error' : 'success' } }))
      setScanResult(null); setScanSelected(new Set())
      await loadImages()
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : '文件夹导入失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <PanelHeader
        icon={Images}
        title='图片资源库'
        description={`${images.length} 个资源，支持托管副本与外部链接`}
        actions={<><IconButton icon={RefreshCw} label='刷新资源库' onClick={() => void loadImages()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} /><IconButton icon={ScanSearch} label='扫描生成元数据' onClick={() => void scanMetadata()} disabled={busy !== null} /></>}
      />
      {scanProgress ? <div className='text-xs text-[var(--color-text-secondary)]' role='status'>正在扫描元数据 {scanProgress.done}/{scanProgress.total || '…'}</div> : null}
      <div className="grid grid-cols-3 gap-2">
        <Button variant='primary' icon={ImagePlus} onClick={() => void handleAdd('managed')} disabled={busy !== null}>导入副本</Button>
        <Button icon={Link2} onClick={() => void handleAdd('external')} disabled={busy !== null}>链接原文件</Button>
        <Button icon={FolderSearch} onClick={() => void scanFolder()} disabled={busy !== null}>扫描文件夹</Button>
      </div>
      {scanResult ? (
        <section className='ui-list-card space-y-2 p-3 text-xs'>
          <div className='flex items-center justify-between'>
            <span className='font-medium'>扫描结果：{scanResult.total} 个图片文件（{scanResult.entries.filter(entry => !entry.alreadyImported).length} 个未导入）</span>
            <button type='button' aria-label='关闭扫描结果' className='text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]' onClick={() => setScanResult(null)}>×</button>
          </div>
          <div className='max-h-48 space-y-1 overflow-auto'>{scanResult.entries.map(entry => (
            <label key={entry.filePath} className='flex items-center gap-2'>
              <input type='checkbox' checked={scanSelected.has(entry.filePath)} disabled={entry.alreadyImported} onChange={() => setScanSelected(current => { const next = new Set(current); if (next.has(entry.filePath)) next.delete(entry.filePath); else next.add(entry.filePath); return next })} />
              <span className='min-w-0 flex-1 truncate' title={entry.filePath}>{entry.fileName}</span>
              <span className='shrink-0 text-[var(--color-text-secondary)]'>{entry.alreadyImported ? '已导入' : Math.round(entry.size / 1024) + ' KB'}</span>
            </label>
          ))}</div>
          <div className='flex flex-wrap items-center gap-2'>
            <Button size='sm' variant='primary' onClick={() => void importScanned('managed')} disabled={busy !== null || !scanSelected.size}>导入副本（{scanSelected.size}）</Button>
            <Button size='sm' onClick={() => void importScanned('external')} disabled={busy !== null || !scanSelected.size}>链接原文件</Button>
            <label className='inline-flex items-center gap-1.5'><input type='checkbox' checked={folderTags} onChange={event => setFolderTags(event.target.checked)} />按目录名写入标签</label>
          </div>
        </section>
      ) : null}
      <div className='grid gap-2 grid-cols-[minmax(0,1fr)_180px]'><div className='relative'><Search size={14} className='pointer-events-none absolute left-2.5 top-2.5 text-[var(--color-text-secondary)]' /><input className='ui-field w-full pl-8' value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索文件名' /></div><select className='ui-field' value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value='all'>全部来源</option><option value='imported-reference'>导入参考</option><option value='generated-comfy'>ComfyUI 生成</option><option value='generated-api'>API 生成</option><option value='project-package'>项目包导入</option></select></div>
      {selectedIds.size > 0 && <div className='flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-2'><span className='text-xs'>已选 {selectedIds.size} 张</span><div className='w-52'><TagAutocomplete allTags={tags} placeholder='搜索标签批量添加…' onSelect={item => setBulkTag({ id: item.id, label: item.zh || item.en })} /></div>{bulkTag && <Badge tone='accent'>{bulkTag.label}</Badge>}<Button size='sm' onClick={() => void bulkAssignTag()} disabled={!bulkTag}>批量标注</Button><Button size='sm' variant='danger' onClick={() => void bulkDelete()}>批量删除</Button></div>}

      {error && <div className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={15} className='mt-0.5 shrink-0' aria-hidden='true' /><span className='flex-1'>{error}</span><Button size='sm' variant='ghost' onClick={() => void loadImages()}>重试</Button></div>}
      
      {loading && images.length === 0 ? (
        <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载资源库</div>
      ) : images.length === 0 ? (
        <EmptyState icon={Images} title={t.images.noImages} description='导入图片后可用于反推提示词、画布编排和生成参考' />
      ) : (
        <ResourceGroup id="images:library" title="图片资源" count={visibleImages.length}>
          {visibleImages.map(img => (
            <ResourceCard
              key={img.id}
              className="group p-2"
            >
              <div className="relative">
                <input type='checkbox' checked={selectedIds.has(img.id)} onChange={() => toggleSelected(img.id)} className='absolute left-2 top-2 z-10 size-4 accent-[var(--color-accent)]' aria-label={'选择 ' + getFileName(img.original_name || img.file_path)} />
                <IconButton
                  icon={Trash2}
                  label={`删除 ${getFileName(img.original_name || img.file_path)}`}
                  onClick={() => setDeleteConfirm(img.id)}
                  className='ui-icon-button-danger absolute right-1 top-1 z-10 bg-[var(--color-surface)]/90 shadow-sm'
                />
                <div className="flex-1 min-w-0">
                  <button type='button' onClick={() => openPreview(img)} className='block w-full cursor-zoom-in overflow-hidden rounded-xl border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-primary)]' title='点击查看大图'>
                    {urls[img.id] ? <img src={urls[img.id]} alt={img.original_name || '参考图片'} className='ui-image-preview mb-2' /> : <span className='flex aspect-[4/3] items-center justify-center text-xs text-[var(--color-text-secondary)]'>图片不可用</span>}
                  </button>
                  <div className='truncate text-xs font-medium text-[var(--color-text-primary)]' title={img.file_path}>{getFileName(img.original_name || img.file_path)}</div>
                  <div className='mt-2 flex flex-wrap gap-1.5'>
                    <Badge>{img.storage_mode === 'managed' ? '托管副本' : '外部链接'}</Badge>
                    <StatusBadge tone={img.available ? 'success' : 'danger'}>{img.available ? '可用' : '文件不可用'}</StatusBadge>
                    {mediaInfo[img.id] && <Badge tone='accent'>{mediaInfo[img.id].source}</Badge>}
                    {(imageTags[img.id] || []).slice(0, 5).map(tagId => <button key={tagId} type='button' onClick={() => setTagFilterId(current => current === tagId ? null : tagId)} aria-label={`按标签「${tags.find(tag => tag.id === tagId)?.zh || tagId}」筛选`} className='cursor-pointer'><Badge tone={tagFilterId === tagId ? 'accent' : 'neutral'}>{tags.find(tag => tag.id === tagId)?.zh || tagId}</Badge></button>)}
                    {tagFilterId ? <button type='button' onClick={() => setTagFilterId(null)} className='text-[10px] text-[var(--color-text-secondary)] underline'>清除标签筛选</button> : null}
                  </div>
                  {mediaInfo[img.id] && <div className='mt-2 flex items-center gap-1'><IconButton icon={Heart} label='收藏图片' onClick={() => void toggleFavorite(img)} className={mediaInfo[img.id].favorite ? 'text-[var(--color-danger)]' : ''} /><span className='text-[10px] text-[var(--color-text-secondary)]'>评分</span>{[1,2,3,4,5].map(value => <button key={value} type='button' onClick={() => void setRating(img, value)} className={value <= mediaInfo[img.id].rating ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]'} aria-label={'评分 ' + value}><Star size={12} fill='currentColor' /></button>)}</div>}
                </div>
              </div>
            </ResourceCard>
          ))}
        </ResourceGroup>
      )}

      {/* 分页页脚：总数来自后端（不受筛选影响的是库总量，筛选后显示可见数） */}
      {totalCount > PAGE_SIZE ? (
        <footer className='flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-2 text-xs'>
          <span className='text-[var(--color-text-secondary)]'>共 {totalCount} 张 · 第 {pageIndex + 1}/{Math.max(1, Math.ceil(totalCount / PAGE_SIZE))} 页{visibleImages.length !== images.length ? `（本页筛选后 ${visibleImages.length} 张）` : ''}</span>
          <Button size='sm' onClick={() => setPageIndex(index => Math.max(0, index - 1))} disabled={pageIndex === 0 || loading}>上一页</Button>
          <Button size='sm' onClick={() => setPageIndex(index => index + 1)} disabled={(pageIndex + 1) * PAGE_SIZE >= totalCount || loading}>下一页</Button>
          <span className='text-[10px] text-[var(--color-text-secondary)]'>搜索与标签筛选只作用于当前页；跨页精确筛选请使用「图库搜索」面板</span>
        </footer>
      ) : null}

      <Modal title={t.app.delete} open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)}>
        <div className="space-y-3">
          <p className="text-sm">{t.images.deleteConfirm}</p>
          <div className="flex gap-2">
            <Button onClick={() => setDeleteConfirm(null)} className='flex-1' disabled={busy === 'delete'}>{t.app.cancel}</Button>
            <Button variant='danger' icon={Trash2} onClick={() => deleteConfirm !== null && void handleDelete(deleteConfirm)} className='flex-1' disabled={busy === 'delete'}>{busy === 'delete' ? '删除中' : t.app.delete}</Button>
          </div>
        </div>
      </Modal>
      <FloatingPreview open={preview !== null} title={preview?.original_name || '图片预览'} onClose={() => { setPreview(null); setPreviewScale(1); setPreviewOffset({ x: 0, y: 0 }); setPreviewDragging(false) }}>
        {preview && urls[preview.id] ? (
          <>
          <div
            ref={previewViewportRef}
            className={`relative flex h-full min-h-[220px] min-w-0 items-start justify-start overflow-hidden rounded-lg bg-[var(--color-bg-secondary)] p-3 ${previewDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
            onPointerDown={event => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              setPreviewDragging(true)
              ;(event.currentTarget as HTMLDivElement).dataset.dragX = String(event.clientX)
              ;(event.currentTarget as HTMLDivElement).dataset.dragY = String(event.clientY)
            }}
            onPointerMove={event => {
              if (!previewDragging) return
              const target = event.currentTarget as HTMLDivElement
              const lastX = Number(target.dataset.dragX || event.clientX)
              const lastY = Number(target.dataset.dragY || event.clientY)
              setPreviewOffset(current => ({ x: current.x + event.clientX - lastX, y: current.y + event.clientY - lastY }))
              target.dataset.dragX = String(event.clientX)
              target.dataset.dragY = String(event.clientY)
            }}
            onPointerUp={event => { event.currentTarget.releasePointerCapture?.(event.pointerId); setPreviewDragging(false) }}
            onPointerCancel={event => { event.currentTarget.releasePointerCapture?.(event.pointerId); setPreviewDragging(false) }}
            onWheel={event => {
              event.preventDefault()
              const image = previewImageRef.current
              const viewport = previewViewportRef.current
              if (image && viewport && previewBaseSize.width) {
                const imageRect = image.getBoundingClientRect()
                const nextScale = Math.min(10, Math.max(0.1, previewScale * (event.deltaY < 0 ? 1.1 : 0.9)))
                const baseLeft = imageRect.left - previewOffset.x
                const baseTop = imageRect.top - previewOffset.y
                const localX = (event.clientX - imageRect.left) / Math.max(0.0001, previewScale)
                const localY = (event.clientY - imageRect.top) / Math.max(0.0001, previewScale)
                setPreviewOffset({
                  x: event.clientX - baseLeft - localX * nextScale,
                  y: event.clientY - baseTop - localY * nextScale,
                })
                setPreviewScale(nextScale)
              }
            }}
            aria-label={`图片缩放 ${Math.round(previewScale * 100)}%`}
          >
            <div className='pointer-events-none absolute inset-3'>
              <img
                ref={previewImageRef}
                src={urls[preview.id]}
                alt={preview.original_name || '参考图片'}
                onLoad={fitPreviewImage}
                className='absolute block max-w-none rounded-lg object-contain'
                style={{ width: previewBaseSize.width || undefined, height: previewBaseSize.height || undefined, left: Math.max(0, ((previewViewportRef.current?.clientWidth || 0) - 24 - previewBaseSize.width) / 2), top: Math.max(0, ((previewViewportRef.current?.clientHeight || 0) - 24 - previewBaseSize.height) / 2), transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewScale})`, transformOrigin: 'top left', willChange: 'transform' }}
              />
            </div>
            <span className='pointer-events-none absolute bottom-2 right-2 rounded bg-black/55 px-2 py-1 text-[11px] text-white'>
              {Math.round(previewScale * 100)}%
            </span>
          </div>
          {preview && mediaInfo[preview.id] && <div className='mt-3 space-y-2 text-xs text-[var(--color-text-secondary)]'><div className='grid gap-2 grid-cols-2'><span>来源：{mediaInfo[preview.id].source}</span><span>评分：{mediaInfo[preview.id].rating || 0}/5</span>{generationInfo[mediaInfo[preview.id].mediaId] && <><span className='col-span-2'>Prompt：{generationInfo[mediaInfo[preview.id].mediaId].prompt || '无'}</span><span className='col-span-2'>Negative：{generationInfo[mediaInfo[preview.id].mediaId].negative_prompt || '无'}</span><span>模型：{generationInfo[mediaInfo[preview.id].mediaId].model || '无'}</span><span>Seed：{generationInfo[mediaInfo[preview.id].mediaId].seed ?? '无'}</span><span>尺寸：{generationInfo[mediaInfo[preview.id].mediaId].width || '?'} × {generationInfo[mediaInfo[preview.id].mediaId].height || '?'}</span></>}</div>{previewRelations.length > 0 && <div className='rounded-lg border border-[var(--color-border)] p-2'><div className='mb-1 font-medium text-[var(--color-text-primary)]'>关联</div>{previewRelations.map(item => <div key={item.relation_type + item.target_key} className='truncate'>{item.relation_type} → {item.target_type}:{item.target_key}</div>)}</div>}</div>}
          </>
        ) : null}
      </FloatingPreview>
    </div>
  )
}
