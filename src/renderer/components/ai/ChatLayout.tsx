// 魔导书 Grimoire v7 — Chatbox 布局
import React, { useCallback, useEffect } from 'react'
import { useChatStore } from '../../stores/chat.store'
import { ConversationList } from './ConversationList'
import { MessageList } from './MessageList'
import { InputArea } from './InputArea'

interface Props {
  onClose?: () => void
}

export function ChatLayout({ onClose }: Props) {
  const {
    activeConversationId, loadingConv,
    loadConversations, conversations, setActiveConversation
  } = useChatStore()

  // Auto-resume last conversation on mount
  React.useEffect(() => {
    const init = async () => {
      await loadConversations()
      const { conversations: convs, activeConversationId: activeId } = useChatStore.getState()
      if (!activeId && convs.length > 0) {
        // Find most recent conversation
        const sorted = [...convs].sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        if (sorted.length > 0) {
          await setActiveConversation(sorted[0].id)
        }
      }
    }
    init()
  }, [])

  return (
    <div className="flex h-full bg-[var(--color-bg-primary)]">
      {/* 左侧对话列表 */}
      <ConversationList onClose={onClose} />

      {/* 右侧聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeConversationId ? (
          <>
            <MessageList />
            <InputArea />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-[var(--color-text-secondary)]">
              <div className="text-5xl mb-4">🤖</div>
              <div className="text-lg font-medium">魔导书 AI 助手</div>
              <div className="text-sm mt-2 opacity-70">选择或创建一个对话开始聊天</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}