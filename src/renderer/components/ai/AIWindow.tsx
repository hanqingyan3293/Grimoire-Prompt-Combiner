// 魔导书 Grimoire v7 — AI 助手窗口（Chatbox 风格）
import React, { useState, useEffect, useRef } from "react"
import { useAIStore } from "../../stores/ai.store"
import { useSettingsStore } from "../../stores/settings.store"
import { useProviderStore } from "../../stores/providers.store"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type TabKey = "chat" | "vision"

export function AIWindow({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>("chat")
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [winSize, setWinSize] = useState({ w: 900, h: 640 })
  const [resizing, setResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const [minimized, setMinimized] = useState(false)

  const onTitleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return
    setDragging(true); setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y })
  }

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setResizing(true)
    setResizeStart({ x: e.clientX, y: e.clientY, w: winSize.w, h: winSize.h })
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging) setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
      if (resizing) {
        setWinSize({ w: Math.max(500, resizeStart.w + (e.clientX - resizeStart.x)), h: Math.max(400, resizeStart.h + (e.clientY - resizeStart.y)) })
      }
    }
    const onUp = () => { setDragging(false); setResizing(false) }
    if (dragging || resizing) {
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
      return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    }
  }, [dragging, resizing, dragStart, resizeStart])

  if (minimized) {
    return (
      <div className="fixed z-50 bottom-4 right-20">
        <button onClick={() => setMinimized(false)} className="px-4 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-lg text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)]">🤖 AI 助手</button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div className="absolute bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        style={{ width: winSize.w, minWidth: 500, maxWidth: "96vw", height: winSize.h, minHeight: 400, maxHeight: "92vh", left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)`, transform: "translate(-50%, -50%)" }}>
        
        {/* Header - bigger font, drag area */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]" onMouseDown={onTitleMouseDown} style={{ cursor: dragging ? "grabbing" : "grab" }}>
          <div className="flex items-center gap-3">
            <span className="font-bold text-base text-[var(--color-text-primary)]">🤖 AI 助手</span>
            <div className="flex rounded bg-[var(--color-bg-primary)] p-0.5 ml-2">
              <button onClick={() => setActiveTab("chat")} className={`px-3 py-1 text-sm rounded transition-colors ${activeTab === "chat" ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]"}`}>💬 聊天</button>
              <button onClick={() => setActiveTab("vision")} className={`px-3 py-1 text-sm rounded transition-colors ${activeTab === "vision" ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]"}`}>👁 识图</button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setMinimized(true)} className="text-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 leading-none">─</button>
            <button onClick={onClose} className="text-lg text-[var(--color-text-secondary)] hover:text-red-400 px-2 leading-none">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "chat" ? <ChatView /> : <VisionView />}
        </div>

        {/* Resize handle - bottom-right corner, small, doesn't block content */}
        <div onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
          style={{ background: "linear-gradient(135deg, transparent 60%, var(--color-border) 60%)" }} />
      </div>
    </div>
  )
}

function ChatView() {
  const { messages, streaming, streamingText, error, sendMessage, loadHistory, clearMessages, clearError } = useAIStore()
  const { activeProvider } = useProviderStore()
  const selectedModels = activeProvider?.models || []
  const defaultModel = activeProvider?.default_model || "gpt-4o"
  const hasApiKey = !!activeProvider?.api_key
  const [selectedModel, setSelectedModel] = useState(defaultModel)
  const [input, setInput] = useState("")
  const [historyList, setHistoryList] = useState<Array<{ id: string; role: string; content: string; model: string; created_at: string }>>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadHistory(); loadHistoryList() }, [])
  useEffect(() => { setSelectedModel(defaultModel) }, [defaultModel])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, streamingText])

  const loadHistoryList = async () => {
    try { const list = await window.api.ai.chatHistory(); setHistoryList(list) } catch { /* ignore */ }
  }

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    if (!hasApiKey) { showToast("请先在设置中配置 API 供应商", "error"); return }
    const msg = input.trim(); setInput("")
    await sendMessage(msg, selectedModel || defaultModel)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-[200px] min-w-[200px] border-r border-[var(--color-border)] bg-[var(--color-bg-primary)]/60 flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)]">
          <button onClick={() => { clearMessages(); setTimeout(() => loadHistoryList(), 300) }}
            className="w-full py-2 text-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/25">+ 新对话</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">历史对话</div>
          {historyList.length === 0 ? (
            <div className="text-center text-[var(--color-text-secondary)] text-[10px] py-4">暂无</div>
          ) : (
            <div className="px-3 py-2 rounded text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 truncate cursor-pointer">
              {(() => { const u = historyList.find(m => m.role === "user"); return u ? u.content.slice(0, 28) + (u.content.length > 28 ? "..." : "") : "对话记录" })()}
            </div>
          )}
        </div>
        <div className="p-2 border-t border-[var(--color-border)]">
          <button onClick={() => { loadHistory(); loadHistoryList() }} className="w-full py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] rounded">🔄 刷新历史</button>
        </div>
      </div>

      {/* Right: Chat */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400 flex items-center justify-between">
              <span>{error}</span><button onClick={clearError} className="text-xs underline ml-2">关闭</button>
            </div>
          )}
          {messages.length === 0 && !streaming && (
            <div className="flex items-center justify-center h-full"><div className="text-center text-[var(--color-text-secondary)]"><div className="text-3xl mb-2">🤖</div><div className="text-sm">AI 助手</div><div className="text-xs mt-1 opacity-50">发送消息开始对话</div></div></div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] px-4 py-2.5 rounded text-sm leading-relaxed ${msg.role === "user" ? "bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]" : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"}`}>
                {msg.role === "assistant" ? <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_pre]:text-xs [&_code]:text-xs"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div> : <div className="whitespace-pre-wrap">{msg.content}</div>}
              </div>
            </div>
          ))}
          {streaming && <div className="flex justify-start"><div className="max-w-[80%] px-4 py-2.5 rounded text-sm bg-[var(--color-bg-tertiary)]"><div className="prose prose-sm prose-invert max-w-none [&_p]:my-1"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText || "▊"}</ReactMarkdown></div></div></div>}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]/30">
          {selectedModels.length > 0 && (
            <div className="flex items-center gap-2 mb-2 pr-5">
              <span className="text-xs text-[var(--color-text-secondary)] shrink-0">模型:</span>
              <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                className="flex-1 px-2 py-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]">
                {selectedModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 items-end pr-5">
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送)" rows={2} disabled={streaming}
              className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] resize-none focus:outline-none focus:border-[var(--color-accent)]" />
            <button onClick={handleSend} disabled={streaming || !input.trim()}
              className="px-5 py-2 bg-[var(--color-accent)] text-white rounded text-sm font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-50">发送</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function VisionView() {
  const { visionLoading, error, analyzeImage, clearError } = useAIStore()
  const { api_key } = useSettingsStore()
  const { positive, addPositive } = usePromptsStore()
  const { tags } = useTagsStore()
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (!api_key) { showToast("请先配置 API Key", "error"); return }
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string; setImageSrc(dataUrl)
      const result = await analyzeImage(dataUrl.split(",")[1])
      if (result) setSuggestions(result.split(/[,\n，、]/).map(s => s.trim().replace(/^[-*\d.\s]+/, "")).filter(Boolean).slice(0, 25))
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex h-full">
      <div className="w-1/2 border-r border-[var(--color-border)] p-4 flex items-center justify-center bg-[var(--color-bg-primary)]/30">
        <div onClick={() => fileInputRef.current?.click()} className="w-full h-full border-2 border-dashed border-[var(--color-border)] rounded flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] overflow-hidden">
          {imageSrc ? <img src={imageSrc} className="max-h-full max-w-full object-contain rounded" alt="preview" /> : <div className="text-center text-[var(--color-text-secondary)]"><div className="text-4xl mb-2">🖼</div><div className="text-sm">点击选择图片</div></div>}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
        </div>
      </div>
      <div className="w-1/2 flex flex-col">
        <div className="p-3 border-b border-[var(--color-border)] text-sm font-medium text-[var(--color-text-primary)] flex items-center justify-between">
          <span>识别结果</span>
          {suggestions.length > 0 && <button onClick={async () => { for (const s of suggestions) { if (!tags.find(t => t.en.toLowerCase() === s.toLowerCase())) { try { await window.api.tags.create({ subcategory_id: "custom", en: s, zh: s }) } catch { /* skip */ } } } showToast("已导入", "success") }} className="text-xs text-[var(--color-accent)] hover:underline">📥 导入标签库</button>}
        </div>
        <div className="flex-1 overflow-auto p-4">
          {visionLoading && <div className="text-center text-[var(--color-text-secondary)] py-8">AI 正在分析图片...</div>}
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">{error}</div>}
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => {
              const added = positive.find(p => p.tag.en.toLowerCase() === s.toLowerCase())
              return <button key={i} onClick={() => { const m = tags.find(t => t.en.toLowerCase() === s.toLowerCase()); if (m) addPositive(m, "", "") }} disabled={!!added}
                className={`px-3 py-1.5 text-xs rounded border ${added ? "bg-green-500/10 border-green-500/30 text-green-400" : tags.find(t => t.en.toLowerCase() === s.toLowerCase()) ? "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20" : "bg-[var(--color-bg-primary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40"}`}>{s}</button>
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
