// Grimoire v7 - AI Window (chat + vision)
import React, { useEffect, useState } from 'react'
import { useProviderStore } from '../../stores/providers.store'
import { ChatLayout } from './ChatLayout'
import { AIVisionPanel } from './AIVisionPanel'

interface Props {
  onClose: () => void
}

export function AIWindow({ onClose }: Props) {
  const { loadProviders } = useProviderStore()
  const [tab, setTab] = useState<'chat' | 'vision'>('chat')

  useEffect(() => {
    loadProviders()
  }, [])

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-primary)]">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        <button
          onClick={() => setTab('chat')}
          className={"px-4 py-2 text-sm font-medium transition-colors " + (tab === 'chat' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}
        >
          聊天
        </button>
        <button
          onClick={() => setTab('vision')}
          className={"px-4 py-2 text-sm font-medium transition-colors " + (tab === 'vision' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}
        >
          识图
        </button>
        <div className="flex-1" />
        <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-red-400">
          关闭
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' ? <ChatLayout onClose={onClose} /> : <AIVisionPanel />}
      </div>
    </div>
  )
}
