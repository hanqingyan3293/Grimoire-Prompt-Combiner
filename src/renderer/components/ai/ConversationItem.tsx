// 魔导书 Grimoire v7 — 对话项
import React, { useState } from 'react'
import { FolderInput, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import type { Conversation } from '../../stores/chat.store'
import { Button, IconButton } from '../ui/Button'
import { Modal } from '../ui/Modal'

interface Props {
  conv: Conversation
  isActive: boolean
  onClick: () => void
  onDelete: () => void | Promise<void>
  onRename: (title: string) => void
  onMove: (groupId: string) => void
  groups: Array<{ id: string; name: string }>
}

export function ConversationItem({ conv, isActive, onClick, onDelete, onRename, onMove, groups }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(conv.title)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete()
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleSaveRename = () => {
    if (editTitle.trim()) {
      onRename(editTitle.trim())
    }
    setEditing(false)
  }

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const isToday = d.toDateString() === now.toDateString()
      if (isToday) {
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  return (
    <div className="relative">
      <div
        onClick={onClick}
        onKeyDown={event => { if (!editing && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick() } }}
        role='button' tabIndex={0} aria-current={isActive ? 'true' : undefined}
        onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
        className={"group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors text-sm " +
          (isActive
            ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent-text)] font-medium border-r-2 border-[var(--color-accent)]'
            : 'text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/5 border-r-2 border-transparent'
          )}>
        {editing ? (
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') { setEditing(false); setEditTitle(conv.title) } }}
            onBlur={handleSaveRename}
            autoFocus
            onClick={e => e.stopPropagation()}
            className="flex-1 px-2 py-0.5 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded outline-none"
          />
        ) : (
          <>
            <span className="flex-1 truncate">{conv.title}</span>
            <span className="text-[10px] opacity-40 whitespace-nowrap">{formatTime(conv.updated_at || conv.created_at)}</span>
            <div className="flex items-center gap-0.5">
              <IconButton icon={Pencil} label={`重命名对话 ${conv.title}`} onClick={e => { e.stopPropagation(); setEditing(true); setEditTitle(conv.title) }} className='h-6 w-6 flex-none' />
              <IconButton icon={Trash2} label={`删除对话 ${conv.title}`} onClick={e => { e.stopPropagation(); setDeleteOpen(true) }} className='ui-icon-button-danger h-6 w-6 flex-none' />
            </div>
          </>
        )}
      </div>

      {/* 右键菜单 */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-8 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 min-w-[140px]">
            <button onClick={() => { setEditing(true); setEditTitle(conv.title); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">
              <Pencil size={13} aria-hidden='true' />重命名
            </button>
            <button onClick={() => { setMoveOpen(true); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">
              <FolderInput size={13} aria-hidden='true' />移动到...
            </button>
            <div className="border-t border-[var(--color-border)]/30 my-1" />
            <button onClick={() => { setDeleteOpen(true); setMenuOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger-surface)]">
              <Trash2 size={13} aria-hidden='true' />删除
            </button>
          </div>
        </>
      )}

      {/* 移动分组子菜单 */}
      {moveOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMoveOpen(false)} />
          <div className="absolute right-2 top-8 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 min-w-[140px]">
            {groups.map(g => (
              <button key={g.id} onClick={() => { onMove(g.id); setMoveOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">
                <FolderOpen size={13} aria-hidden='true' />{g.name}
              </button>
            ))}
          </div>
        </>
      )}
      <Modal title='删除对话' open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <p className='text-sm text-[var(--color-text-primary)]'>确认删除对话“{conv.title}”？其中的全部消息也会被删除。</p>
        <div className='mt-4 flex gap-2'><Button onClick={() => setDeleteOpen(false)} className='flex-1' disabled={deleting}>取消</Button><Button variant='danger' icon={Trash2} onClick={() => void handleDelete()} className='flex-1' disabled={deleting}>{deleting ? '删除中' : '删除'}</Button></div>
      </Modal>
    </div>
  )
}
