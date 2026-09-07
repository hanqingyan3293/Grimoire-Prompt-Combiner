// Grimoire v7 - AI Window (chat + vision)
import React, { Suspense, lazy, useEffect, useState } from 'react'
import { LoaderCircle, MessageSquare, ScanSearch, X } from 'lucide-react'
import { useProviderStore } from '../../stores/providers.store'
import { IconButton } from '../ui/Button'

const ChatLayout = lazy(() => import('./ChatLayout').then(module => ({ default: module.ChatLayout })))
const AIVisionPanel = lazy(() => import('./AIVisionPanel').then(module => ({ default: module.AIVisionPanel })))

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
      <div className="ui-app-chrome flex shrink-0 items-center border-b border-[var(--color-border)] px-2 pt-1" role="tablist" aria-label="AI 工具">
        <button
          onClick={() => setTab('chat')}
          role="tab" aria-selected={tab === 'chat'}
          className={"ui-nav-tab flex items-center gap-2 px-4 py-2 " + (tab === 'chat' ? 'ui-nav-tab-active' : '')}
        >
          <MessageSquare size={15} aria-hidden="true" />聊天
        </button>
        <button
          onClick={() => setTab('vision')}
          role="tab" aria-selected={tab === 'vision'}
          className={"ui-nav-tab flex items-center gap-2 px-4 py-2 " + (tab === 'vision' ? 'ui-nav-tab-active' : '')}
        >
          <ScanSearch size={15} aria-hidden="true" />识图
        </button>
        <div className="flex-1" />
        <IconButton onClick={onClose} icon={X} label="关闭 AI 窗口" className="ui-icon-button-danger" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle size={17} className="animate-spin" aria-hidden="true" />正在载入</div>}>{tab === 'chat' ? <ChatLayout onClose={onClose} /> : <AIVisionPanel />}</Suspense>
      </div>
    </div>
  )
}
