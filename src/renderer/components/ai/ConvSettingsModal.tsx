// ConvSettingsModal.tsx
import React, { useState, useEffect } from 'react'
import { useChatStore } from '../../stores/chat.store'
import { Modal } from '../ui/Modal'

interface Props {
  open: boolean
  onClose: () => void
}

export function ConvSettingsModal({ open, onClose }: Props) {
  const { activeConversationId, conversations, updateConversation } = useChatStore()
  const conv = conversations.find(c => c.id === activeConversationId)

  const [systemPrompt, setSystemPrompt] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (conv && open) {
      setSystemPrompt(conv.system_prompt || '')
      setSaved(false)
    }
  }, [conv, open])

  const handleSave = async () => {
    if (!conv) return
    await updateConversation(conv.id, { system_prompt: systemPrompt })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleExport = () => {
    const { messages } = useChatStore.getState()
    const text = messages.map(m => {
      const role = m.role === 'user' ? '用户' : 'AI'
      return `### ${role}

${m.content}
`
    }).join('\n---\n\n')
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv?.title || 'conversation'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal title="对话设置" open={open} onClose={onClose}>
      <div className="p-4 space-y-4 min-w-[400px]">
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)]">系统提示词</label>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-2">定义 AI 的行为和角色</p>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="例如：你是一个专业的插画师..."
            rows={6}
            className="w-full px-3 py-2 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg resize-none outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)]"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)]">导出对话</label>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-2">将当前对话导出为 Markdown 文件</p>
          <button onClick={handleExport}
            className="px-4 py-2 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 transition-colors">
            导出 Markdown
          </button>
        </div>

        <div className="flex gap-3 pt-2 border-t border-[var(--color-border)]">
          <button onClick={onClose}
            className="flex-1 py-2 text-sm bg-[var(--color-bg-tertiary)] rounded-lg text-[var(--color-text-primary)]">
            关闭
          </button>
          <button onClick={handleSave}
            className="flex-1 py-2 text-sm bg-[var(--color-accent)] text-white rounded-lg disabled:opacity-50">
            {saved ? '已保存' : '保存设置'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
