import React, { useEffect, useState, useCallback } from 'react'
import { useImagesStore } from '../../stores/images.store'

interface ImagePanelProps {
  showToast: (msg: string, type?: string) => void
}

const ImagePanel: React.FC<ImagePanelProps> = ({ showToast }) => {
  const { refs, activeRef, loadRefs, parseImage, setActiveRef, deleteRef } = useImagesStore()
  const [collapsed, setCollapsed] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    loadRefs()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const result = await parseImage(file.path)
          if (result.ok) {
            showToast('图片已解析', 'success')
          } else {
            showToast('解析失败: ' + (result.error || '未知错误'), 'error')
          }
        } catch {
          showToast('解析失败', 'error')
        }
      }
    }
  }, [parseImage, showToast])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  if (collapsed) {
    return (
      <div
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <button
          onClick={() => setCollapsed(false)}
          className="p-3 rounded-l-xl shadow-lg text-sm font-medium"
          style={{
            backgroundColor: dragOver ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
            color: dragOver ? 'white' : 'var(--color-text-secondary)',
            border: `1px solid ${dragOver ? 'var(--color-accent)' : 'var(--color-border)'}`,
            writingMode: 'vertical-rl',
            transition: 'all 150ms ease'
          }}
          title="图片参考面板"
        >
          🖼️ 参考图
        </button>
      </div>
    )
  }

  return (
    <aside
      className="fixed right-0 top-0 h-full w-72 z-30 flex flex-col shadow-2xl"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderLeft: '1px solid var(--color-border)'
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header */}
      <div className="p-3 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold">🖼️ 图片参考</h3>
        <button onClick={() => setCollapsed(true)} className="btn btn-sm">✕</button>
      </div>

      {/* Drop Zone */}
      <div
        className="m-3 p-4 rounded-xl border-2 border-dashed text-center text-xs transition-all"
        style={{
          borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
          backgroundColor: dragOver ? 'var(--color-tag-bg)' : 'transparent',
          color: 'var(--color-text-muted)'
        }}
      >
        {dragOver ? '✨ 释放以添加' : '拖放图片到此处\n自动提取元数据'}
      </div>

      {/* Image List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {refs.length === 0 ? (
          <p className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            暂无参考图<br />拖放图片到此面板
          </p>
        ) : (
          refs.map(ref => (
            <div
              key={ref.id}
              className={`p-2 rounded-lg cursor-pointer transition-all text-xs ${
                activeRef?.id === ref.id ? 'ring-2' : ''
              }`}
              style={{
                backgroundColor: activeRef?.id === ref.id ? 'var(--color-tag-bg)' : 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                ringColor: 'var(--color-accent)'
              }}
              onClick={() => setActiveRef(activeRef?.id === ref.id ? null : ref)}
            >
              <div className="truncate font-medium mb-1">
                {ref.file_path?.split('\\').pop()?.split('/').pop()}
              </div>
              
              {/* Metadata */}
              {ref.metadata && (
                <div className="space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {ref.metadata.sizeBytes && (
                    <div>📦 {(ref.metadata.sizeBytes / 1024).toFixed(0)} KB</div>
                  )}
                  {ref.metadata.seed && (
                    <div>🌱 Seed: {ref.metadata.seed}</div>
                  )}
                  {ref.metadata.model && (
                    <div>🤖 {ref.metadata.model}</div>
                  )}
                  {ref.metadata.steps && (
                    <div>🔄 Steps: {ref.metadata.steps} | CFG: {ref.metadata.cfgScale} | Sampler: {ref.metadata.sampler}</div>
                  )}
                  {ref.metadata.width && (
                    <div>📐 {ref.metadata.width}×{ref.metadata.height}</div>
                  )}
                </div>
              )}

              {/* Prompt Preview */}
              {ref.metadata?.prompt && (
                <div
                  className="mt-1 p-1.5 rounded text-xs line-clamp-3"
                  style={{
                    backgroundColor: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)'
                  }}
                >
                  {ref.metadata.prompt.substring(0, 100)}
                  {ref.metadata.prompt.length > 100 ? '...' : ''}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-1 mt-2">
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRef(ref.id) }}
                  className="btn btn-sm btn-danger flex-1"
                  style={{ fontSize: '0.65rem' }}
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Metadata Detail */}
      {activeRef && activeRef.metadata && (
        <div
          className="p-3 border-t max-h-48 overflow-y-auto"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-accent)' }}>
            元数据详情
          </h4>
          <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>
            {JSON.stringify(activeRef.metadata, null, 1)}
          </pre>
        </div>
      )}
    </aside>
  )
}

export default ImagePanel
