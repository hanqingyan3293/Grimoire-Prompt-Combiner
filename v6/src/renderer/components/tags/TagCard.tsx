import React, { useState, useRef, useEffect } from 'react'
import { useI18n } from '../../i18n/context'

interface TagCardProps {
  tag: {
    id: string
    en: string
    zh: string
    is_favorite?: boolean
    source?: string
    _cat?: string
    _sub?: string
  }
  selected?: boolean
  onClick: (e: React.MouseEvent) => void
  onEdit?: (tag: any) => void
  onDelete?: (tag: any) => void
  onToggleFavorite?: (tag: any) => void
}

const TagCard: React.FC<TagCardProps> = ({
  tag, selected, onClick, onEdit, onDelete, onToggleFavorite,
}) => {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  const handleEdit = () => { setMenuOpen(false); onEdit?.(tag) }
  const handleDelete = () => { setMenuOpen(false); onDelete?.(tag) }
  const handleToggleFav = () => { setMenuOpen(false); onToggleFavorite?.(tag) }

  const displayName = tag.zh || tag.en
  const showEnglish = tag.zh && tag.zh !== tag.en

  return (
    <>
      <div
        ref={cardRef}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        title={
          (tag.zh ? tag.zh + '\n' + tag.en : tag.en) +
          '\n左键=切换引用 | Shift+左键=负面 | 右键=更多'
        }
        style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          padding: '8px 10px',
          borderRadius: 'var(--radius-md)',
          border: selected
            ? '2px solid var(--color-accent)'
            : '1px solid var(--color-border)',
          background: selected
            ? 'var(--color-accent-bg)'
            : 'var(--color-bg-primary)',
          cursor: 'pointer',
          transition: 'all 120ms ease',
          position: 'relative',
          userSelect: 'none',
          minHeight: 52,
        }}
        onMouseEnter={e => {
          if (!selected) {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'
            ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px var(--color-accent-bg)'
          }
        }}
        onMouseLeave={e => {
          if (!selected) {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'
            ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
          }
        }}
      >
        {/* Top row: name + favorite */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%',
        }}>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: selected ? 'var(--color-accent)' : 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {selected && <span style={{ marginRight: 4 }}>✓</span>}
            {displayName}
          </span>
          {tag.is_favorite && (
            <span style={{ fontSize: 11, flexShrink: 0, marginLeft: 4 }}>⭐</span>
          )}
        </div>

        {/* Bottom row: English name */}
        {showEnglish && (
          <span style={{
            fontSize: 10, color: 'var(--color-text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {tag.en}
          </span>
        )}

        {/* Selected indicator bar */}
        {selected && (
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: 3, background: 'var(--color-accent)',
            borderRadius: '3px 0 0 3px',
          }} />
        )}
      </div>

      {/* Right-click Menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed', zIndex: 9999,
            left: menuPos.x, top: menuPos.y,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            padding: '4px 0',
            minWidth: 150,
          }}
        >
          <button onClick={handleToggleFav}
            style={menuItemStyle}>
            {tag.is_favorite ? '⭐ 取消收藏' : '☆ 收藏'}
          </button>
          <button onClick={handleEdit}
            style={menuItemStyle}>
            ✏️ {t('tags.edit')}
          </button>
          <button onClick={handleDelete}
            style={{ ...menuItemStyle, color: 'var(--color-danger)' }}>
            🗑️ {t('tags.delete')}
          </button>
          <div style={{
            height: 1, background: 'var(--color-border)',
            margin: '2px 6px',
          }} />
          <div style={{
            padding: '2px 12px', fontSize: 10,
            color: 'var(--color-text-dim)',
          }}>
            {t('tags.addToPositive')}: 左键
          </div>
          <div style={{
            padding: '2px 12px', fontSize: 10,
            color: 'var(--color-text-dim)',
          }}>
            {t('tags.addToNegative')}: Shift+左键
          </div>
        </div>
      )}
    </>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '6px 12px', fontSize: 12,
  background: 'none', border: 'none',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
}

export default TagCard
