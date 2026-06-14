// 魔导书 Grimoire v7 — 图片参考面板
import React, { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n/context'
import { Modal } from '../ui/Modal'
import type { ImageRef } from '@shared/types'

export function ImagesPanel() {
  const { t } = useI18n()
  const [images, setImages] = useState<ImageRef[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  
  const loadImages = useCallback(async () => {
    try {
      const list = await window.api.images.list()
      setImages(list)
    } catch { /* ignore */ }
  }, [])
  
  useEffect(() => { loadImages() }, [loadImages])
  useEffect(() => {
    const cleanup = window.api.db.onReload(() => loadImages())
    return cleanup
  }, [loadImages])
  
  const handleAdd = async () => {
    const result = await window.api.images.add()
    if (result) await loadImages()
  }
  
  const handleDelete = async (id: number) => {
    await window.api.images.delete(id)
    await loadImages()
    setDeleteConfirm(null)
  }
  
  const getFileName = (filePath: string) => {
    return filePath.split(/[\\/]/).pop() || filePath
  }
  
  return (
    <div className="p-3 space-y-3">
      <button
        onClick={handleAdd}
        className="w-full py-2 text-sm bg-[var(--color-accent)] text-white rounded hover:bg-[var(--color-accent-hover)] transition-colors"
      >
        🖼 {t.images.addImage}
      </button>
      
      {images.length === 0 ? (
        <div className="text-center text-[var(--color-text-secondary)] py-8 text-sm">
          {t.images.noImages}
        </div>
      ) : (
        <div className="space-y-2">
          {images.map(img => (
            <div
              key={img.id}
              className="p-2 rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] group"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <img
                    src={`file://${img.file_path}`}
                    alt=""
                    className="w-full h-32 object-cover rounded mb-2 bg-[var(--color-bg-tertiary)]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="text-xs text-[var(--color-text-secondary)] truncate" title={img.file_path}>
                    {getFileName(img.file_path)}
                  </div>
                </div>
                <button
                  onClick={() => setDeleteConfirm(img.id)}
                  className="ml-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
      <Modal title={t.app.delete} open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)}>
        <div className="space-y-3">
          <p className="text-sm">{t.images.deleteConfirm}</p>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 text-sm bg-[var(--color-bg-tertiary)] rounded">
              {t.app.cancel}
            </button>
            <button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="flex-1 py-2 text-sm bg-[var(--color-danger)] text-white rounded">
              {t.app.delete}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
