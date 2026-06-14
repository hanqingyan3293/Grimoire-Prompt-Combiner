// 魔导书 Grimoire v7 — AI 面板（聊天 + 识图）
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n/context'
import { useAIStore } from '../../stores/ai.store'
import { useSettingsStore } from '../../stores/settings.store'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type TabKey = 'chat' | 'vision'

export function AIPanel() {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<TabKey>('chat')
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'chat' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
          }`}
        >
          💬 {t.ai.chat}
        </button>
        <button
          onClick={() => setActiveTab('vision')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'vision' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
          }`}
        >
          👁 {t.ai.vision}
        </button>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' ? <ChatView /> : <VisionView />}
      </div>
    </div>
  )
}

function ChatView() {
  const { t } = useI18n()
  const { messages, streaming, streamingText, error, sendMessage, loadHistory, clearError } = useAIStore()
  const { api_model, api_key } = useSettingsStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => { loadHistory() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingText])
  
  const handleSend = async () => {
    if (!input.trim() || streaming) return
    if (!api_key) {
      showToast(t.ai.noApiKey, 'error')
      return
    }
    const msg = input.trim()
    setInput('')
    await sendMessage(msg, api_model)
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg text-xs text-red-300">
            {error}
            <button onClick={clearError} className="ml-2 underline">关闭</button>
          </div>
        )}
        
        {messages.length === 0 && !streaming && (
          <div className="text-center text-[var(--color-text-secondary)] text-sm py-12">
            🤖 {t.ai.placeholder}
          </div>
        )}
        
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
              msg.role === 'user'
                ? 'bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]'
                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_pre]:text-xs [&_code]:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
            </div>
          </div>
        ))}
        
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-3 py-2 rounded-lg text-sm bg-[var(--color-bg-tertiary)]">
              <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streamingText || '▊'}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      
      {/* Input */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.ai.placeholder}
            rows={2}
            disabled={streaming}
            className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] resize-none focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="px-3 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
          >
            {t.ai.send}
          </button>
        </div>
      </div>
    </div>
  )
}

function VisionView() {
  const { t } = useI18n()
  const { visionLoading, visionResult, error, analyzeImage, clearError } = useAIStore()
  const { api_key } = useSettingsStore()
  const { positive, addPositive } = usePromptsStore()
  const { tags, findTagById } = useTagsStore()
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    if (!api_key) {
      showToast(t.ai.noApiKey, 'error')
      return
    }
    
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      setImageSrc(dataUrl)
      const base64 = dataUrl.split(',')[1]
      
      const result = await analyzeImage(base64)
      if (result) {
        // Parse suggestions
        const lines = result.split(/[,\n，、]/).map(s => s.trim().replace(/^[-*\d.\s]+/, '')).filter(Boolean)
        setSuggestions(lines.slice(0, 20))
      }
    }
    reader.readAsDataURL(file)
  }
  
  const handleAddSuggestion = (suggestion: string) => {
    // Try to find matching tag
    const match = tags.find(t => t.en.toLowerCase() === suggestion.toLowerCase() || t.zh === suggestion)
    if (match) {
      addPositive(match, '', '')
    }
  }
  
  return (
    <div className="flex flex-col h-full p-3 space-y-3">
      {/* Image Upload */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center justify-center h-40 border-2 border-dashed border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-accent)] transition-colors bg-[var(--color-bg-primary)]"
      >
        {imageSrc ? (
          <img src={imageSrc} alt="Preview" className="max-h-full max-w-full object-contain rounded" />
        ) : (
          <div className="text-center text-[var(--color-text-secondary)]">
            <div className="text-3xl mb-1">🖼</div>
            <div className="text-sm">{t.ai.selectImage}</div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      </div>
      
      {/* Loading */}
      {visionLoading && (
        <div className="text-center text-[var(--color-text-secondary)] text-sm">
          🔄 {t.ai.analyzing}
        </div>
      )}
      
      {/* Error */}
      {error && (
        <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg text-xs text-red-300">
          {error}
          <button onClick={clearError} className="ml-2 underline">关闭</button>
        </div>
      )}
      
      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
            {t.ai.addTagsToPanel} ({suggestions.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => {
              const matched = tags.find(t => t.en.toLowerCase() === s.toLowerCase())
              const alreadyAdded = positive.find(p => p.tag.en.toLowerCase() === s.toLowerCase())
              return (
                <button
                  key={i}
                  onClick={() => handleAddSuggestion(s)}
                  disabled={!!alreadyAdded}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    alreadyAdded
                      ? 'bg-green-900/30 text-green-400 cursor-not-allowed'
                      : matched
                        ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 border border-[var(--color-accent)]/30'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]'
                  }`}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function showToast(message: string, type: 'success' | 'error' | 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}
