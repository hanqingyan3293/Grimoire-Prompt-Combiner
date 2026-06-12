import React, { useState } from 'react'

interface TagEditModalProps {
  tag: { id: string; en: string; zh: string } | null
  onClose: () => void
  onSave: (data: { tagId: string; en: string; zh: string }) => void
  onDelete: (tagId: string) => void
}

const TagEditModal: React.FC<TagEditModalProps> = ({ tag, onClose, onSave, onDelete }) => {
  const [en, setEn] = useState(tag?.en || '')
  const [zh, setZh] = useState(tag?.zh || '')

  if (!tag) return null

  const handleSave = () => {
    if (!en.trim()) return
    onSave({ tagId: tag.id, en: en.trim(), zh: zh.trim() })
    onClose()
  }

  const handleDelete = () => {
    if (confirm('确定删除这个标签吗？')) {
      onDelete(tag.id)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-sm mx-4 p-5 rounded-xl" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--color-accent)' }}>✏️ 编辑标签</h3>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>英文名</label>
            <input
              type="text"
              value={en}
              onChange={e => setEn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>中文名</label>
            <input
              type="text"
              value={zh}
              onChange={e => setZh(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={handleSave} className="btn btn-primary flex-1">💾 保存</button>
          <button onClick={handleDelete} className="btn btn-danger flex-1">🗑️ 删除</button>
          <button onClick={onClose} className="btn flex-1">取消</button>
        </div>
      </div>
    </div>
  )
}

export default TagEditModal