// 魔导书 Grimoire v7 — AI 助手窗口（Chatbox 风格独立窗口）
import React, { useState, useEffect, useRef } from "react"
import { useChatStore, Conversation } from "../../stores/chat.store"
import { useProviderStore } from "../../stores/providers.store"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function AIWindow({ onClose }: { onClose: () => void }) {
  const { activeProvider } = useProviderStore()
  const {
    conversations, activeId, messages, streaming, streamingText, error, searchQuery,
    loadConversations, createConversation, deleteConversation, renameConversation,
    setActive, setSearch, sendMessage, clearError
  } = useChatStore()

  const [input, setInput] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [compressEnabled, setCompressEnabled] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Initialize
  useEffect(() => { loadConversations(); if (!activeId) createConversation() }, [])
  useEffect(() => { if (activeProvider?.default_model) setSelectedModel(activeProvider.default_model) }, [activeProvider])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, streamingText])

  // Get available models
  const models = (activeProvider?.models?.length ? activeProvider.models : (activeProvider?.default_model ? [activeProvider.default_model] : ["gpt-4o"]))
  useEffect(() => {
    if (!selectedModel && models.length > 0) setSelectedModel(models[0])
  }, [models])

  const hasApiKey = !!activeProvider?.api_key

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    if (!hasApiKey) { showToast("请先在设置中配置 API 供应商", "error"); return }
    const msg = input.trim(); setInput("")
    await sendMessage(msg, selectedModel || models[0])
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // Global shortcut: Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Group conversations
  const grouped = groupConversations(conversations)
  const filtered = searchQuery
    ? conversations.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations

  // Token estimation (~4 chars per token)
  const tokenCount = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0)
  const estCost = (tokenCount / 1000 * 0.01).toFixed(3)

  const activeConv = conversations.find(c => c.id === activeId)

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Left sidebar */}
      <div className="w-[260px] min-w-[260px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
        {/* Search + New */}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <input value={searchQuery} onChange={e => setSearch(e.target.value)}
              placeholder="搜索对话..."
              className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
            <button onClick={() => { const id = createConversation(selectedModel); setActive(id) }}
              className="shrink-0 w-9 h-9 flex items-center justify-center bg-[var(--color-accent)] text-white rounded-lg text-lg hover:opacity-90 font-bold" title="新建对话">
              +
            </button>
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {searchQuery ? (
            filtered.length === 0 ? (
              <div className="text-center text-sm text-[var(--color-text-secondary)] py-8">无匹配对话</div>
            ) : (
              filtered.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActive(c.id)}
                onDelete={() => deleteConversation(c.id)} onRename={(t) => renameConversation(c.id, t)}
                editing={editingTitle === c.id} editValue={editValue} setEditValue={setEditValue}
                setEditingTitle={setEditingTitle} />)
            )
          ) : (
            Object.entries(grouped).map(([group, convs]) => (
              <div key={group}>
                <div className="text-xs text-[var(--color-text-secondary)] px-3 py-2 font-semibold uppercase tracking-wider">{group}</div>
                {convs.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActive(c.id)}
                  onDelete={() => deleteConversation(c.id)} onRename={(t) => renameConversation(c.id, t)}
                  editing={editingTitle === c.id} editValue={editValue} setEditValue={setEditValue}
                  setEditingTitle={setEditingTitle} />)}
              </div>
            ))
          )}
          {!searchQuery && Object.keys(grouped).length === 0 && (
            <div className="text-center text-sm text-[var(--color-text-secondary)] py-8">暂无对话</div>
          )}
        </div>

        {/* Bottom settings */}
        <div className="border-t border-[var(--color-border)] p-3">
          <button onClick={() => window.api.window.openSettings()}
            className="w-full py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] rounded-lg hover:bg-[var(--color-bg-primary)] transition-colors">
            ⚙ API 设置
          </button>
        </div>
      </div>

      {/* Right: Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-bg-secondary)]/50">
          <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1">
            {activeConv?.title || "AI 助手"}
          </span>
          {models.length > 0 && (
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
              className="px-3 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 flex items-center justify-between">
              <span>{error}</span><button onClick={clearError} className="text-xs underline ml-3">关闭</button>
            </div>
          )}
          {messages.length === 0 && !streaming && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-[var(--color-text-secondary)]">
                <div className="text-5xl mb-4">🤖</div>
                <div className="text-base font-medium">魔导书 AI 助手</div>
                <div className="text-sm mt-1 opacity-60">发送消息开始对话</div>
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={"flex " + (msg.role === "user" ? "justify-end" : "justify-start")}>
              <div className={"max-w-[85%] px-4 py-3 rounded-xl text-sm leading-relaxed " + (
                msg.role === "user" ? "bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]" : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
              )}>
                {msg.images && msg.images.length > 0 && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {msg.images.map((img, i) => <img key={i} src={img} className="max-w-[200px] max-h-[150px] rounded-lg" alt="" />)}
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_pre]:text-xs [&_code]:text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[85%] px-4 py-3 rounded-xl text-sm bg-[var(--color-bg-tertiary)]">
                <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText || "▊"}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Bottom bar: token + compression toggle */}
        <div className="px-5 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 flex items-center gap-4">
          <div className="text-sm text-[var(--color-text-secondary)] flex items-center gap-4" title={"总 token: " + tokenCount + " | 消息数: " + messages.length + " | 预估费用: $" + estCost}>
            <span>📊 <strong className="text-[var(--color-text-primary)]">{tokenCount}</strong> tokens</span>
            <span className="text-xs opacity-60">约 {messages.length} 条消息</span>
            <span className="text-xs opacity-60">~${estCost}</span>
          </div>
          <div className="flex-1" />
          {/* iOS-style toggle */}
          <div className="flex items-center gap-2" title={compressEnabled ? "自动压缩：开启" : "自动压缩：关闭"}>
            <span className="text-xs text-[var(--color-text-secondary)]">📦 压缩</span>
            <button onClick={() => setCompressEnabled(!compressEnabled)}
              className={"relative w-11 h-6 rounded-full transition-colors duration-200 " + (compressEnabled ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]")}>
              <span className={"absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 " + (compressEnabled ? "translate-x-5" : "translate-x-0.5")} />
            </button>
          </div>
        </div>

        {/* Input bar */}
        <div className="border-t border-[var(--color-border)] p-4 bg-[var(--color-bg-primary)]">
          <div className="flex items-end gap-3">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)" rows={2} disabled={streaming}
              className="flex-1 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] resize-none focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]" />
            <button onClick={handleSend} disabled={streaming || !input.trim() || !hasApiKey}
              className="shrink-0 px-6 py-3 bg-[var(--color-accent)] text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={!hasApiKey ? "请先配置 API 供应商" : streaming ? "回复中..." : "发送 (Enter)"}>
              {streaming ? "⏳" : "发送"}
            </button>
          </div>
          <div className="mt-2 text-xs text-[var(--color-text-secondary)] flex items-center gap-3">
            <span>{activeProvider ? activeProvider.name + " · " + (selectedModel || "未选模型") : "⚠ 未配置供应商"}</span>
            <span>Enter 发送 · Shift+Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Conversation item
function ConvItem({ conv, active, onClick, onDelete, onRename, editing, editValue, setEditValue, setEditingTitle }: {
  conv: Conversation; active: boolean; onClick: () => void;
  onDelete: () => void; onRename: (t: string) => void;
  editing: boolean; editValue: string; setEditValue: (v: string) => void; setEditingTitle: (id: string | null) => void;
}) {
  return (
    <div className={"group flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-colors " + (
      active ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]"
    )} onClick={editing ? undefined : onClick}>
      {editing ? (
        <input value={editValue} onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { onRename(editValue); setEditingTitle(null) } }}
          onBlur={() => { onRename(editValue); setEditingTitle(null) }}
          className="flex-1 px-2 py-1 bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded text-sm outline-none"
          autoFocus onClick={e => e.stopPropagation()} />
      ) : (
        <>
          <span className="truncate flex-1">{conv.title}</span>
          <div className="hidden group-hover:flex gap-0.5">
            <button onClick={e => { e.stopPropagation(); setEditingTitle(conv.id); setEditValue(conv.title) }}
              className="text-xs px-1.5 py-0.5 hover:text-[var(--color-accent)] rounded" title="重命名">✏️</button>
            <button onClick={e => { e.stopPropagation(); if (confirm("删除此对话？")) onDelete() }}
              className="text-xs px-1.5 py-0.5 hover:text-red-400 rounded" title="删除">🗑</button>
          </div>
        </>
      )}
    </div>
  )
}

// Group by time
function groupConversations(convs: Conversation[]): Record<string, Conversation[]> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const week = new Date(today.getTime() - 7 * 86400000)
  const groups: Record<string, Conversation[]> = { "今天": [], "昨天": [], "本周": [], "更早": [] }
  for (const c of convs) {
    const d = new Date(c.updated_at)
    if (d >= today) groups["今天"].push(c)
    else if (d >= yesterday) groups["昨天"].push(c)
    else if (d >= week) groups["本周"].push(c)
    else groups["更早"].push(c)
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0))
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}