import React, { useEffect, useState, useCallback } from 'react'
import { useImagesStore } from '../../stores/images.store'
import { useI18n } from '../../i18n/context'

interface ImagesPanelProps { showToast: (msg: string, type?: string) => void }

const ImagesPanel: React.FC<ImagesPanelProps> = ({ showToast }) => {
  const { t } = useI18n()
  const { refs, loadRefs, deleteRef } = useImagesStore()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!loaded) {
      loadRefs().then(() => setLoaded(true)).catch(() => setLoaded(true))
    }
  }, [])

  const handleDelete = async (id: number) => {
    try { await deleteRef(id); showToast(t('common.del') + ' ✓', 'success') } catch { showToast('Error', 'error') }
  }

  const handleRefresh = () => {
    setLoaded(false)
    loadRefs().then(() => setLoaded(true)).catch(() => setLoaded(true))
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '6px 8px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 'var(--font-size-ui)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
          🖼 {t('panels.images.generated')} ({refs.length})
        </span>
        <button onClick={handleRefresh} className="ps-btn ps-btn--xs" title="刷新">
          🔄
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
        {refs.length === 0 ? (
          <div style={{
            color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)',
            padding: 32, textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
            <div>{t('panels.images.generated')}</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>暂无图片数据</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 4 }}>
            {refs.map((img: any) => (
              <div key={img.id} style={{
                position: 'relative', borderRadius: 'var(--radius-sm)',
                overflow: 'hidden', border: '1px solid var(--color-border)',
                cursor: 'pointer', aspectRatio: '1',
              }}>
                {img.file_path ? (
                  <img
                    src={'file://' + img.file_path}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : null}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(img.id) }}
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    background: 'rgba(0,0,0,0.75)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-sm)',
                    width: 20, height: 20, cursor: 'pointer',
                    fontSize: 12, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', lineHeight: 1,
                  }}
                  title={t('common.del')}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ImagesPanel
