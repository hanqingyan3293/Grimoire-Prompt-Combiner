import React, { useState, useEffect } from 'react'
import { useI18n } from '../../i18n/context'

interface TagEditModalProps {
  tag: { id: string; en: string; zh: string; _cat?: string; _sub?: string } | null
  onClose: () => void
  onSave: (data: { tagId: string; en: string; zh: string }) => void
  onDelete?: (tagId: string) => void
}

const TagEditModal: React.FC<TagEditModalProps> = ({ tag, onClose, onSave, onDelete }) => {
  const { t } = useI18n()
  const [en, setEn] = useState('')
  const [zh, setZh] = useState('')

  useEffect(() => {
    if (tag) {
      setEn(tag.en || '')
      setZh(tag.zh || '')
    }
  }, [tag])

  if (!tag) return null

  const handleSave = () => {
    if (!en.trim()) return
    onSave({ tagId: tag.id, en: en.trim(), zh: zh.trim() })
    onClose()
  }

  const handleDelete = () => {
    if (onDelete) onDelete(tag.id)
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '90vw',
          padding: 28,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        }}
      >
        <h3 style={{
          fontSize: 18, fontWeight: 700,
          color: 'var(--color-accent)',
          margin: '0 0 6px 0',
        }}>
          ✏️ {t('tags.editTitle')}
        </h3>

        {/* Info */}
        {(tag._cat || tag._sub) && (
          <div style={{
            fontSize: 11, color: 'var(--color-text-dim)',
            marginBottom: 16, display: 'flex', gap: 12,
          }}>
            {tag._cat && <span>📂 {tag._cat}</span>}
            {tag._sub && <span>📁 {tag._sub}</span>}
          </div>
        )}

        {/* EN Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block', fontSize: 13, fontWeight: 600,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
          }}>
            {t('tags.enName')} <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            type="text"
            value={en}
            onChange={e => setEn(e.target.value)}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            style={{
              width: '100%', padding: '10px 14px',
              fontSize: 16, fontWeight: 500,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
            }}
            placeholder="例如: 1girl"
          />
        </div>

        {/* ZH Name */}
        <div style={{ marginBottom: 24 }}>
          <label style={{
            display: 'block', fontSize: 13, fontWeight: 600,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
          }}>
            {t('tags.zhName')}
          </label>
          <input
            type="text"
            value={zh}
            onChange={e => setZh(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            style={{
              width: '100%', padding: '10px 14px',
              fontSize: 16, fontWeight: 500,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
            }}
            placeholder="例如: 一个女孩"
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            className="ps-btn ps-btn--primary"
            style={{ flex: 1, height: 38, fontSize: 14, fontWeight: 600 }}
          >
            💾 {t('common.save')}
          </button>
          {onDelete && (
            <button
              onClick={handleDelete}
              className="ps-btn ps-btn--danger"
              style={{ height: 38, fontSize: 14, padding: '0 20px' }}
            >
              🗑 {t('common.del')}
            </button>
          )}
          <button
            onClick={onClose}
            className="ps-btn"
            style={{ height: 38, fontSize: 14, padding: '0 20px' }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TagEditModal
