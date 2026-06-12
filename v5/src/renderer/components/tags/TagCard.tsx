import React, { useState, useRef, useEffect } from 'react'

interface TagCardProps {
  tag: {
    id: string
    en: string
    zh: string
    is_favorite?: boolean
    source?: string
  }
  onClick: (e: React.MouseEvent) => void
  onEdit?: (tag: any) => void
  onDelete?: (tag: any) => void
  onToggleFavorite?: (tag: any) => void
}

const TagCard: React.FC<TagCardProps> = ({ tag, onClick, onEdit, onDelete, onToggleFavorite }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

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

  return (
    <>
      <div
        className="tag-badge flex flex-col items-start relative"
        onClick={onClick}
        onContextMenu={handleContextMenu}
        title={tag.zh ? `${tag.zh}\n${tag.en}\n右键编辑 | Shift+点击=负面` : `${tag.en}\n右键编辑 | Shift+点击=负面`}
      >
        <span className="tag-zh font-medium">{tag.zh || tag.en}</span>
        {tag.zh && <span className="tag-en">{tag.en}</span>}
        {tag.is_favorite && (
          <span className="absolute top-0.5 right-0.5 text-xs leading-none">⭐</span>
        )}
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            backgroundColor: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)'
          }}
        >
          <button
            onClick={handleToggleFav}
            className="w-full text-left px-3 py-1.5 text-sm hover:opacity-80"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {tag.is_favorite ? '⭐ 取消收藏' : '☆ 收藏'}
          </button>
          <button
            onClick={handleEdit}
            className="w-full text-left px-3 py-1.5 text-sm hover:opacity-80"
            style={{ color: 'var(--color-text-primary)' }}
          >
            ✏️ 编辑
          </button>
          {tag.source === 'custom' && (
            <button
              onClick={handleDelete}
              className="w-full text-left px-3 py-1.5 text-sm hover:opacity-80"
              style={{ color: 'var(--color-danger)' }}
            >
              🗑️ 删除
            </button>
          )}
        </div>
      )}
    </>
  )
}

export default TagCard