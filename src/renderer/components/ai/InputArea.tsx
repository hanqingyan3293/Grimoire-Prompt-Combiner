// 魔导书 Grimoire v7 — 输入区域
import React, { useState, useRef, useCallback } from 'react'
import { useChatStore } from '../../stores/chat.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useProviderStore } from '../../stores/providers.store'
import { ToolbarRow } from './ToolbarRow'
import { SendBar } from './SendBar'
import { ConvSettingsModal } from './ConvSettingsModal'

export function InputArea() {
  const {
    activeConversationId, conversations, messages,
    sendMessage, updateConversation,
  } = useChatStore()
  const providerStore = useProviderStore()
  const providers = providerStore.providers

  const [input, setInput] = useState('')
  const [compressEnabled, setCompressEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeProvider = providerStore.activeProvider || providers[0]
  const conv = conversations.find(c => c.id === activeConversationId)
  const model = conv?.model || activeProvider?.default_model || 'gpt-4o'
  const models = activeProvider?.models || []
  const tokenUsed = messages.reduce((sum, m) => sum + (m.token_count || 0), 0)
  const tokenMax = activeProvider?.context_size || 128000

  // Provider 列表
  const providerList = providers.map(p => ({ id: p.id, name: p.name }))

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || !activeProvider) return
    sendMessage(text, activeProvider.id, model)
    setInput('')
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, activeProvider, model, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const { getShortcut } = useSettingsStore.getState()
    const sendKey = getShortcut('chat.send') || 'Enter'
    const newlineKey = getShortcut('chat.newline') || 'Shift+Enter'

    // Parse send shortcut
    const sendParts = sendKey.split('+')
    const sendMain = sendParts[sendParts.length - 1]
    const sendShift = sendParts.includes('Shift')
    const sendCtrl = sendParts.includes('Ctrl')

    // Parse newline shortcut
    const nlParts = newlineKey.split('+')
    const nlMain = nlParts[nlParts.length - 1]
    const nlShift = nlParts.includes('Shift')
    const nlCtrl = nlParts.includes('Ctrl')

    // Check send shortcut
    if (e.key === sendMain &&
        e.shiftKey === sendShift &&
        (e.ctrlKey || e.metaKey) === sendCtrl) {
      e.preventDefault()
      handleSend()
      return
    }

    // Check newline shortcut
    if (e.key === nlMain &&
        e.shiftKey === nlShift &&
        (e.ctrlKey || e.metaKey) === nlCtrl) {
      e.preventDefault()
      const el = e.target as HTMLTextAreaElement
      const start = el.selectionStart
      const end = el.selectionEnd
      const val = el.value
      const newVal = val.slice(0, start) + '\n' + val.slice(end)
      setInput(newVal)
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1
        // Auto-resize
        el.style.height = 'auto'
        const lineHeight = 20
        const minHeight = lineHeight * 2 + 12
        const maxHeight = lineHeight * 5 + 12
        el.style.height = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight) + 'px'
      })
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // 自动调整高度 (2-5行)
    const el = e.target
    el.style.height = 'auto'
    const lineHeight = 20
    const minHeight = lineHeight * 2 + 12
    const maxHeight = lineHeight * 5 + 12
    el.style.height = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight) + 'px'
  }

  const handleUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files
      if (!files) return
      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1]
          setInput(prev => prev + ` [图片: ${file.name}]`)
        }
        reader.readAsDataURL(file)
      }
    }
    input.click()
  }

  const handleProviderChange = (id: string) => {
    useProviderStore.getState().setActive(id)
  }

  const handleModelChange = (m: string) => {
    if (conv) {
      updateConversation(conv.id, { model: m })
    }
  }

  // 如果没有任何 provider，显示提示
  if (providers.length === 0) {
    return (
      <div className="border-t border-[var(--color-border)] p-4">
        <div className="text-center text-sm text-[var(--color-text-secondary)]">
          <div className="mb-2">⚠ 未配置 API 供应商</div>
          <div className="text-xs opacity-70">请在设置中添加 API 供应商以开始聊天</div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--color-border)] p-3 bg-[var(--color-bg-primary)]">
      <ToolbarRow
        onUpload={handleUpload}
        onWebSearch={() => {}}
        onConvSettings={() => setSettingsOpen(true)}
      />

      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (快捷键可在设置中自定义)"
        rows={2}
        className="w-full px-3 py-2 text-sm bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl resize-none outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] transition-colors"
        style={{ minHeight: '48px', maxHeight: '112px' }}
      />

      <div className="mt-2">
        <SendBar
          providerName={activeProvider?.name || ''}
          providers={providerList}
          providerId={activeProvider?.id || ''}
          onProviderChange={handleProviderChange}
          model={model}
          models={models}
          onModelChange={handleModelChange}
          tokenUsed={tokenUsed}
          tokenMax={tokenMax}
          compressEnabled={compressEnabled}
          onCompressToggle={() => setCompressEnabled(!compressEnabled)}
          onSend={handleSend}
          canSend={input.trim().length > 0}
        />
      </div>

      <ConvSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}