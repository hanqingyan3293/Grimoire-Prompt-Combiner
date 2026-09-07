// 魔导书 Grimoire v7 — 对话列表
import React, { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Clock3, Plus, Search, X } from 'lucide-react'
import { useChatStore } from '../../stores/chat.store'
import { ConversationItem } from './ConversationItem'
import { Button, IconButton } from '../ui/Button'
import { EmptyState } from '../ui/Feedback'

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
            aria-label='搜索对话' className="ui-field w-full pl-8 pr-9"
          />
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" aria-hidden='true' />
          {search && (
            <IconButton icon={X} label='清除搜索' onClick={() => setSearch('')} className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2" />
          )}
        </div>
      </div>

      {/* 分组标签栏 */}
      <div className="px-2 py-1.5 border-b border-[var(--color-border)]/50 flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setActiveGroup('all')}
          className={"px-2 py-1 text-[11px] rounded-full border transition-colors " + (activeGroup === 'all' ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/30 text-[var(--color-accent-text)] font-medium' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10')}>
          <Clock3 size={12} className='mr-1 inline' aria-hidden='true' />时间
        </button>
        {groups.map(g => (
          <button key={g.id}
            onClick={() => setActiveGroup(g.id)}
            className={"px-2 py-1 text-[11px] rounded-full border transition-colors max-w-[100px] truncate " + (activeGroup === g.id ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/30 text-[var(--color-accent-text)] font-medium' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10')}>
            {g.name}
          </button>
        ))}
        {showNewGroup ? (
          <div className="flex items-center gap-1">
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { createGroup(newGroupName); setNewGroupName(''); setShowNewGroup(false) }
                if (e.key === 'Escape') { setNewGroupName(''); setShowNewGroup(false) }
              }}
              placeholder="分组名"
              autoFocus
              className="w-16 px-1.5 py-0.5 text-[10px] bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded-full outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setShowNewGroup(true)}
            className="px-2 py-1 text-[11px] rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent-text)] transition-colors"
            title="新建分组">
            + 新建
          </button>
        )}
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto">
        {loadingConv && conversations.length === 0 && (
          <div className="py-6 text-center text-xs text-[var(--color-text-secondary)]" role='status'>正在加载对话</div>
        )}
        {!loadingConv && filtered.length === 0 && (
          <div className='p-3'><EmptyState icon={Search} title={search ? '没有匹配的对话' : '暂无对话'} description={search ? '尝试缩短关键词或清除搜索' : '创建一个新对话后即可开始使用 AI 助手'} /></div>
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
        <Button size='sm' variant='primary' icon={Plus} onClick={() => void handleNewConv()} className='flex-1'>新对话</Button>
        {onClose && <IconButton icon={ArrowLeft} label='返回主窗口' onClick={onClose} />}
      </div>
    </div>
  )
}
