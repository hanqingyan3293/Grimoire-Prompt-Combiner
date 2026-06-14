// 魔导书 Grimoire v7 — 消息列表
import React, { useEffect, useRef } from 'react'
import { useChatStore } from '../../stores/chat.store'
import { MessageBubble } from './MessageBubble'

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
        <div className="text-sm text-[var(--color-text-secondary)] text-center py-10">加载消息中...</div>
      )}
      {!loadingMsg && messages.length === 0 && (
        <div className="text-sm text-[var(--color-text-secondary)] text-center py-10">
          <div className="text-3xl mb-2">💬</div>
          <div>发送一条消息开始对话</div>
        </div>
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