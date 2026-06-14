// 魔导书 Grimoire v7 — AI 助手独立窗口
import React, { useEffect } from 'react'
import { useProviderStore } from '../../stores/providers.store'
import { ChatLayout } from './ChatLayout'

interface Props {
  onClose: () => void
}

export function AIWindow({ onClose }: Props) {
  const { loadProviders } = useProviderStore()

  useEffect(() => {
    loadProviders()
  }, [])

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-primary)]">
      <ChatLayout onClose={onClose} />
    </div>
  )
}