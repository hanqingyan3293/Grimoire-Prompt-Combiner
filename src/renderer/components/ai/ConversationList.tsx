// 魔导书 Grimoire v7 — 对话列表
import React, { useState, useEffect, useMemo } from 'react'
import { useChatStore } from '../../stores/chat.store'
import { ConversationItem } from './ConversationItem'

interface Props {
  onClose?: () => void
}

export function ConversationList({ onClose }: Props) {
  const {
    conversations, activeConversationId, groups,
    loadConversations, loadGroups,
    createConversation, setActiveConversation,
    deleteConversation, updateConversation, moveConversation,
    createGroup, deleteGroup, renameGroup,
    loadingConv,
  } = useChatStore()

  const [search, setSearch] = useState('')
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState('all')
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string } | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    loadConversations()
    loadGroups()
  }, [])

  // 关闭右键菜单
  useEffect(() => {
    const h = () => { setContextMenu(null); setRenaming(null) }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [])

  const filtered = useMemo(() => {
    let list = conversations
    if (activeGroup !== 'all') {
      list = list.filter(c => c.group_id === activeGroup)
    } else {
      // 按时间分组 (默认)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c => c.title.toLowerCase().includes(q))
    }
    return list
  }, [conversations, search, activeGroup])

  // 按时间分组显示
  const groupedByTime = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const weekAgo = new Date(today.getTime() - 7 * 86400000)
    const monthAgo = new Date(today.getTime() - 30 * 86400000)

    const groups: { label: string; items: typeof filtered }[] = [
      { label: '今天', items: [] },
      { label: '昨天', items: [] },
      { label: '本周', items: [] },
      { label: '本月', items: [] },
      { label: '更早', items: [] },
    ]

    for (const c of filtered) {
      const d = new Date(c.updated_at || c.created_at)
      if (d >= today) groups[0].items.push(c)
      else if (d >= yesterday) groups[1].items.push(c)
      else if (d >= weekAgo) groups[2].items.push(c)
      else if (d >= monthAgo) groups[3].items.push(c)
      else groups[4].items.push(c)
    }

    return groups.filter(g => g.items.length > 0)
  }, [filtered])

  const isCustomGroupMode = activeGroup !== 'all' && activeGroup !== 'time'

  const handleNewConv = async () => {
    // 用默认 provider 和 model
    const id = await createConversation('default', 'gpt-4o')
    if (id) setActiveConversation(id)
  }

  return (
    <div className="w-[280px] min-w-[280px] border-r border-[var(--color-border)] flex flex-col bg-[var(--color-bg-secondary)]">
      {/* 搜索框 */}
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="relative">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索对话..."
            className="w-full pl-8 pr-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm opacity-50">🔍</span>
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100">✕</button>
          )}
        </div>
      </div>

      {/* 分组下拉 */}
      <div className="px-3 py-2 border-b border-[var(--color-border)]/50">
        <button onClick={() => setGroupMenuOpen(!groupMenuOpen)}
          className="w-full flex items-center gap-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <span>📁</span>
          <span className="flex-1 text-left">
            {activeGroup === 'all' ? '按时间分组' :
             activeGroup === 'time' ? '按时间分组' :
             groups.find(g => g.id === activeGroup)?.name || '选择分组'}
          </span>
          <span className="text-[10px]">{groupMenuOpen ? '▲' : '▼'}</span>
        </button>
        {groupMenuOpen && (
          <div className="mt-1 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg p-1 shadow-lg">
            <button onClick={() => { setActiveGroup('all'); setGroupMenuOpen(false) }}
              className={"w-full text-left px-3 py-1.5 text-xs rounded " + (activeGroup === 'all' ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]')}>
              按时间分组
            </button>
            <div className="border-t border-[var(--color-border)]/30 my-1" />
            {groups.map(g => (
              <button key={g.id} onClick={() => { setActiveGroup(g.id); setGroupMenuOpen(false) }}
                className={"w-full text-left px-3 py-1.5 text-xs rounded " + (activeGroup === g.id ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]')}>
                {g.name}
              </button>
            ))}
            <div className="border-t border-[var(--color-border)]/30 my-1" />
            {showNewGroup ? (
              <div className="flex gap-1 px-1">
                <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { createGroup(newGroupName); setNewGroupName(''); setShowNewGroup(false) } if (e.key === 'Escape') setShowNewGroup(false) }}
                  placeholder="分组名" autoFocus
                  className="flex-1 px-2 py-1 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded" />
                <button onClick={() => { createGroup(newGroupName); setNewGroupName(''); setShowNewGroup(false) }}
                  className="px-2 py-1 text-xs bg-[var(--color-accent)] text-white rounded">确定</button>
              </div>
            ) : (
              <button onClick={() => setShowNewGroup(true)}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)] rounded">
                + 新建分组
              </button>
            )}
          </div>
        )}
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto">
        {loadingConv && conversations.length === 0 && (
          <div className="text-xs text-[var(--color-text-secondary)] text-center py-6">加载中...</div>
        )}
        {!loadingConv && filtered.length === 0 && (
          <div className="text-xs text-[var(--color-text-secondary)] text-center py-6">
            {search ? '没有匹配的对话' : '暂无对话'}
          </div>
        )}

        {activeGroup === 'all' ? (
          // 按时间分组
          groupedByTime.map(group => (
            <div key={group.label}>
              {groupedByTime.length > 1 && (
                <div className="px-3 pt-3 pb-1 text-[10px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                  {group.label}
                </div>
              )}
              {group.items.map(conv => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === activeConversationId}
                  onClick={() => setActiveConversation(conv.id)}
                  onDelete={() => deleteConversation(conv.id)}
                  onRename={(title) => updateConversation(conv.id, { title })}
                  onMove={(groupId) => moveConversation(conv.id, groupId)}
                  groups={groups}
                />
              ))}
            </div>
          ))
        ) : (
          // 自定义分组
          filtered.map(conv => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={conv.id === activeConversationId}
              onClick={() => setActiveConversation(conv.id)}
              onDelete={() => deleteConversation(conv.id)}
              onRename={(title) => updateConversation(conv.id, { title })}
              onMove={(groupId) => moveConversation(conv.id, groupId)}
              groups={groups}
            />
          ))
        )}
      </div>

      {/* 底部按钮 */}
      <div className="p-2 border-t border-[var(--color-border)] flex gap-1">
        <button onClick={handleNewConv}
          className="flex-1 py-2 text-xs bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 rounded-lg text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors font-medium">
          + 新对话
        </button>
        <button onClick={onClose}
          className="px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-lg"
          title="返回主窗口">
          ↩
        </button>
      </div>
    </div>
  )
}