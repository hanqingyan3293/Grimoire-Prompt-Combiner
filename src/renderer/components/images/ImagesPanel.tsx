// 魔导书 Grimoire v7 — 图片参考面板
import React, { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ImagePlus, Images, Link2, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n/context'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import type { ImageRef } from '@shared/types'
import { ResourceCard, ResourceGroup } from '../ui/ResourceCards'
import { FloatingPreview } from '../ui/FloatingPreview'

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
      const list = await window.api.images.list()
      setImages(list)
      const entries = await Promise.all(list.filter(item => item.available).map(async item => { try { return [item.id, await window.api.images.readData(item.id)] as const } catch { return null } }))
      setUrls(Object.fromEntries(entries.filter((entry): entry is readonly [number, string] => Boolean(entry))))
      setError(null)
    } catch (cause) {
      console.error('Failed to load image library:', cause)
      setError('资源库加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])
  
  useEffect(() => { loadImages() }, [loadImages])
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
    if (urls[image.id]) { setPreviewScale(1); setPreviewOffset({ x: 0, y: 0 }); setPreviewBaseSize({ width: 0, height: 0 }); setPreview(image) }
    else notifyError('图片文件不可用')
  }
  
  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <PanelHeader
        icon={Images}
        title='图片资源库'
        description={`${images.length} 个资源，支持托管副本与外部链接`}
        actions={<IconButton icon={RefreshCw} label='刷新资源库' onClick={() => void loadImages()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant='primary' icon={ImagePlus} onClick={() => void handleAdd('managed')} disabled={busy !== null}>导入副本</Button>
        <Button icon={Link2} onClick={() => void handleAdd('external')} disabled={busy !== null}>链接原文件</Button>
      </div>

      {error && <div className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={15} className='mt-0.5 shrink-0' aria-hidden='true' /><span className='flex-1'>{error}</span><Button size='sm' variant='ghost' onClick={() => void loadImages()}>重试</Button></div>}
      
      {loading && images.length === 0 ? (
        <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载资源库</div>
      ) : images.length === 0 ? (
        <EmptyState icon={Images} title={t.images.noImages} description='导入图片后可用于反推提示词、画布编排和生成参考' />
      ) : (
        <ResourceGroup id="images:library" title="图片资源" count={images.length}>
          {images.map(img => (
            <ResourceCard
              key={img.id}
              className="group p-2"
            >
              <div className="relative">
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
                  </div>
                </div>
              </div>
            </ResourceCard>
          ))}
        </ResourceGroup>
      )}
      
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
        ) : null}
      </FloatingPreview>
    </div>
  )
}
