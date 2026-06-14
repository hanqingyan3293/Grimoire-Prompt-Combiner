// 魔导书 Grimoire v7 — AI 面板（使用 ChatLayout）
import React, { useEffect } from 'react'
import { useProviderStore } from '../../stores/providers.store'
import { ChatLayout } from './ChatLayout'

interface Props {
  onClose?: () => void
}

export function AIPanel({ onClose }: Props) {
  const { loadProviders } = useProviderStore()

  useEffect(() => {
    loadProviders()
  }, [])

  return <ChatLayout onClose={onClose} />
}