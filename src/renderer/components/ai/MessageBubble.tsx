// 魔导书 Grimoire v7 — 消息气泡
import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../../stores/chat.store'
import type { ChatMessage } from '../../stores/chat.store'

interface Props {
  message: ChatMessage
  isStreaming: boolean
}

export function MessageBubble({ message, isStreaming }: Props) {
  const { editAndResend, resendMessage, deleteMessage } = useChatStore()
  const isUser = message.role === 'user'
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch {}
    setMenuOpen(false)
  }

  const handleEdit = () => {
    setEditing(true)
    setEditContent(message.content)
    setMenuOpen(false)
  }

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      editAndResend(message.id, editContent.trim())
    }
    setEditing(false)
  }

  const handleResend = () => {
    resendMessage(message.id)
    setMenuOpen(false)
  }

  const handleDelete = () => {
    deleteMessage(message.id)
    setMenuOpen(false)
  }

  return (
    <div className="flex gap-3">
      /* AI */
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--color-accent)]/20 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
          🤖
        </div>
      )}

      <div className="relative group max-w-[80%]">
        <div
          onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
          className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed">

          {editing && isUser ? (
            <div className="min-w-[200px]">
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit() }
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                className="w-full px-3 py-2 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded-lg resize-none outline-none text-[var(--color-text-primary)]"
                rows={3}
              />
              <div className="flex gap-2 mt-1 text-[10px] text-[var(--color-text-secondary)]">
                <span>Enter 保存 · Esc 取消</span>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0 prose-pre:my-1 [&_pre]:bg-[var(--color-bg-primary)] [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content + (isStreaming ? '▍' : '')}
              </ReactMarkdown>
            </div>
          )}

          {isStreaming && !message.content && (
            <div className="flex gap-1 items-center h-5">
              <span className="w-1.5 h-1.5 bg-[var(--color-accent)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-[var(--color-accent)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-[var(--color-accent)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>

        <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5 opacity-50">
          {message.created_at ? new Date(message.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-8 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 min-w-[140px]">
              <button onClick={handleCopy} className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">
                📋 复制
              </button>
              {isUser && (
                <button onClick={handleEdit} className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">
                  ✏ 编辑
                </button>
              )}
              {!isUser && (
                <button onClick={handleResend} className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">
                  🔄 重新生成
                </button>
              )}
              <div className="border-t border-[var(--color-border)]/30 my-1" />
              <button onClick={handleDelete} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10">
                ✕ 删除
              </button>
            </div>
          </>
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
          👤
        </div>
      )}
    </div>
  )
}
