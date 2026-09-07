// 魔导书 Grimoire v7 — 消息列表
import React, { useEffect, useRef } from 'react'
import { LoaderCircle, MessageSquare } from 'lucide-react'
import { useChatStore } from '../../stores/chat.store'
import { MessageBubble } from './MessageBubble'
import { EmptyState } from '../ui/Feedback'

export function MessageList() {
  const { messages, streamingMessageId, loadingMsg } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  // 自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {loadingMsg && messages.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-text-secondary)]" role='status'><LoaderCircle size={17} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />加载消息中</div>
      )}
      {!loadingMsg && messages.length === 0 && (
        <EmptyState icon={MessageSquare} title='暂无消息' description='发送一条消息开始对话' />
      )}

      {messages.map(msg => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isStreaming={msg.id === streamingMessageId}
        />
      ))}

      <div ref={bottomRef} />
    </div>
  )
}
