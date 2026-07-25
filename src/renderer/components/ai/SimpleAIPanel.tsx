// Grimoire v7 - Simple AI Panel (right sidebar tab)
import React, { useState, useRef, useCallback, useEffect } from "react"
import { useChatStore } from "../../stores/chat.store"
import { useProviderStore } from "../../stores/providers.store"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"
import { useSettingsStore } from "../../stores/settings.store"
import { MessageBubble } from "./MessageBubble"
import type { Tag } from "../../../shared/types"

type SubTab = "chat" | "vision"

export function SimpleAIPanel() {
  const [subTab, setSubTab] = useState<SubTab>("chat")
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[var(--color-border)]">
        <button onClick={() => setSubTab("chat")}
          className={"flex-1 py-1.5 text-xs font-medium transition-colors " + (subTab === "chat" ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]" : "text-[var(--color-text-secondary)]")}>
          聊天
        </button>
        <button onClick={() => setSubTab("vision")}
          className={"flex-1 py-1.5 text-xs font-medium transition-colors " + (subTab === "vision" ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]" : "text-[var(--color-text-secondary)]")}>
          识图
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {subTab === "chat" ? <SimpleChat /> : <SimpleVision />}
      </div>
    </div>
  )
}

// ==================== SimpleChat ====================
function SimpleChat() {
  const {
    messages, conversations, activeConversationId,
    streamingMessageId, sendMessage, setActiveConversation,
    createConversation, loadConversations, loadGroups, loadMessages
  } = useChatStore()
  const { activeProvider, providers, loadProviders } = useProviderStore()
  const [input, setInput] = useState("")
  const [selectedModel, setSelectedModel] = useState(activeProvider?.default_model || "")
  const [modelOpen, setModelOpen] = useState(false)
  const [convOpen, setConvOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const models = activeProvider?.models?.length
    ? activeProvider.models
    : (activeProvider?.default_model ? [activeProvider.default_model] : [])

  const isStreaming = streamingMessageId !== null

  useEffect(() => {
    loadProviders()
    loadConversations()
    loadGroups()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Sync model when provider changes
  useEffect(() => {
    if (activeProvider?.default_model) {
      setSelectedModel(activeProvider.default_model)
    }
  }, [activeProvider?.id])

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return
    if (!activeProvider?.id) { showToast("未配置 API 供应商", "error"); return }
    const providerId = activeProvider.id
    const model = selectedModel || activeProvider.default_model || "gpt-4o"
    const msg = input.trim()
    setInput("")

    // Auto-create conversation if none active
    if (!activeConversationId) {
      await createConversation(providerId, model)
    }
    const state = useChatStore.getState()
    if (!state.activeConversationId) {
      showToast("创建对话失败", "error")
      return
    }
    await sendMessage(msg, providerId, model)
  }

  const handleNewConv = async () => {
    if (!activeProvider?.id) { showToast("未配置 API 供应商", "error"); return }
    const model = selectedModel || activeProvider.default_model || "gpt-4o"
    await createConversation(activeProvider.id, model)
  }

  const switchConv = async (id: string) => {
    setConvOpen(false)
    await setActiveConversation(id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: conversation selector + new */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        <div className="relative flex-1">
          <button
            onClick={() => setConvOpen(!convOpen)}
            className="w-full text-left px-2 py-1 text-[11px] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded truncate"
          >
            {conversations.find(c => c.id === activeConversationId)?.title || "新对话"}
          </button>
          {convOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl max-h-40 overflow-y-auto">
              {conversations.map(c => (
                <button
                  key={c.id}
                  onClick={() => switchConv(c.id)}
                  className={"w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--color-accent)]/10 " + (c.id === activeConversationId ? "text-[var(--color-accent)] font-medium" : "text-[var(--color-text-primary)]")}
                >
                  {c.title || "未命名"}
                </button>
              ))}
              {conversations.length === 0 && (
                <div className="px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">暂无对话</div>
              )}
            </div>
          )}
        </div>
        <button onClick={handleNewConv}
          className="px-2 py-1 text-[11px] bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded hover:bg-[var(--color-accent)]/20 flex-shrink-0">
          + 新建
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-[var(--color-text-secondary)] mt-8">
            <div className="text-3xl mb-2">AI</div>
            <div className="text-[11px]">发送消息开始对话</div>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={msg.id === streamingMessageId}
          />
        ))}
      </div>

      {/* Input area */}
      <div className="p-2 border-t border-[var(--color-border)]">
        {/* Model selector */}
        <div className="relative mb-1.5">
          <button
            onClick={() => setModelOpen(!modelOpen)}
            className="w-full flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded"
          >
            <span className="flex-1 text-left truncate">{selectedModel || "选择模型"}</span>
            <span className="text-[10px]">{modelOpen ? "▲" : "▼"}</span>
          </button>
          {modelOpen && (
            <div ref={listRef} className="absolute left-0 right-0 bottom-full mb-1 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl max-h-40 overflow-y-auto">
              {models.map(m => (
                <button
                  key={m}
                  onClick={() => { setSelectedModel(m); setModelOpen(false) }}
                  className={"w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--color-accent)]/10 " + (m === selectedModel ? "text-[var(--color-accent)] font-medium" : "text-[var(--color-text-primary)]")}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input + Send */}
        <div className="flex gap-1">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              const { getShortcut } = useSettingsStore.getState()
              const sendKey = getShortcut('chat.send') || 'Enter'
              const parts = sendKey.split('+')
              const mainKey = parts[parts.length - 1]
              const needShift = parts.includes('Shift')
              const needCtrl = parts.includes('Ctrl')
              if (e.key === mainKey && e.shiftKey === needShift && (e.ctrlKey || e.metaKey) === needCtrl) {
                e.preventDefault(); handleSend()
              }
            }}
            placeholder="输入消息..."
            rows={2}
            className="flex-1 px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[11px] resize-none text-[var(--color-text-primary)]"
          />
          <button onClick={handleSend} disabled={isStreaming || !input.trim()}
            className="px-3 py-1 bg-[var(--color-accent)] text-white rounded text-[11px] disabled:opacity-50 hover:opacity-90 self-end">
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== SimpleVision ====================
function SimpleVision() {
  const { activeProvider, providers, loadProviders } = useProviderStore()
  const { positive, addPositive, addNegative } = usePromptsStore()
  const { tags, categories, subcategories, addTag } = useTagsStore()
  const {
    conversations, activeConversationId, createConversation,
    loadConversations, messages, loadMessages, setActiveConversation
  } = useChatStore()
  const [images, setImages] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ en: string; zh: string }>>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [selectedModel, setSelectedModel] = useState(activeProvider?.default_model || "")
  const [modelOpen, setModelOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState("")

  const models = activeProvider?.models?.length
    ? activeProvider.models
    : (activeProvider?.default_model ? [activeProvider.default_model] : [])

  useEffect(() => {
    loadProviders()
    loadConversations()
  }, [])

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type.startsWith("image/"))
    Promise.all(fileArr.map(f => new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.readAsDataURL(f)
    }))).then(urls => setImages(prev => [...prev, ...urls]))
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(true)
  }

  const handleAnalyze = async () => {
    if (!images.length) return
    if (!activeProvider?.id) { showToast("未配置 API 供应商", "error"); return }
    setAnalyzing(true)
    try {
      const base64 = images[0].split(",")[1] || images[0]
      const model = selectedModel || activeProvider.default_model || "gpt-4o"
      const prompt = customPrompt || "Analyze this image and list relevant Stable Diffusion / NovelAI prompt tags. Return ONLY a JSON array of objects with 'en' 和 'zh' 字段. Example: [{'en':'1girl','zh':'女孩'}]"
      const result = await window.api.ai.vision({
        providerId: activeProvider.id,
        model,
        imageBase64: base64,
        prompt,
      })
      if (result.error) {
        showToast("识别失败: " + result.error, "error")
        return
      }
      // Parse result text as JSON or line-by-line
      const text = result.text || ""
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) {
          setSuggestions(parsed.map((t: any) => ({
            en: t.en || t.tag || String(t),
            zh: t.zh || ""
          })))
        } else {
          throw new Error("Not array")
        }
      } catch {
        // Fallback: split by lines
        const lines = text.split("\n").filter(Boolean)
        setSuggestions(lines.map(l => {
          const parts = l.split(/[,，]/)
          return { en: parts[0]?.trim() || l, zh: parts[1]?.trim() || "" }
        }))
      }
      // Save to vision history
      const convId = activeConversationId || await createConversation(activeProvider.id, model)
      if (convId) {
        await window.api.chat.saveMessage({
          conv_id: convId,
          role: "user",
          content: "[图片分析] " + (customPrompt || "标签识别"),
        })
        await window.api.chat.saveMessage({
          conv_id: convId,
          role: "assistant",
          content: text,
        })
      }
    } catch (e: any) {
      showToast("错误: " + (e?.message || String(e)), "error")
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleSelect = (i: number) => {
    const next = new Set(selected)
    next.has(i) ? next.delete(i) : next.add(i)
    setSelected(next)
  }

  const selectAll = () => setSelected(new Set(suggestions.map((_, i) => i)))
  const clearSel = () => setSelected(new Set())

  const copySel = () => {
    const text = Array.from(selected).map(i => suggestions[i].en).join(", ")
    navigator.clipboard.writeText(text).then(() => showToast("已复制", "success"))
  }

  const resolvePromptTag = (suggestion: { en: string; zh: string }): {
    tag: Tag
    category: string
    subcategory: string
  } => {
    const normalizedEn = suggestion.en.trim().toLowerCase()
    const existing = tags.find(t =>
      t.en.trim().toLowerCase() === normalizedEn ||
      (!!suggestion.zh && t.zh.trim() === suggestion.zh.trim())
    )
    if (existing) {
      const sub = subcategories.find(s => s.id === existing.subcategory_id)
      const cat = categories.find(c => c.id === sub?.category_id)
      return {
        tag: existing,
        category: cat?.zh || "",
        subcategory: sub?.zh || "",
      }
    }

    return {
      tag: {
        id: "vision_" + normalizedEn,
        subcategory_id: "vision",
        en: suggestion.en.trim(),
        zh: suggestion.zh.trim() || suggestion.en.trim(),
        sort_order: 0,
        source: "custom",
        created_at: new Date().toISOString(),
      },
      category: "识图",
      subcategory: "AI 识图",
    }
  }

  const addToPositive = () => {
    if (selected.size === 0) return
    Array.from(selected).forEach(i => {
      const item = resolvePromptTag(suggestions[i])
      addPositive(item.tag, item.category, item.subcategory)
    })
    showToast("已添加到正面提示词", "success")
  }

  const addToNegative = () => {
    if (selected.size === 0) return
    Array.from(selected).forEach(i => {
      const item = resolvePromptTag(suggestions[i])
      addNegative(item.tag, item.category, item.subcategory)
    })
    showToast("已添加到负面提示词", "success")
  }

  const addToLibrary = () => {
    const selectedTags = Array.from(selected).map(i => suggestions[i])
    // Simple: add to first subcategory
    const defaultSub = subcategories[0]
    if (!defaultSub) {
      showToast("没有可用子类", "error")
      return
    }
    Promise.all(selectedTags.map(t =>
      window.api.tags.create({ subcategory_id: defaultSub.id, en: t.en, zh: t.zh })
        .catch(() => {})
    )).then(() => {
      showToast("已添加到标签库", "success")
    }).catch(() => showToast("部分标签添加失败", "error"))
  }

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(suggestions, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "vision-tags.json"
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Image upload zone */}
      <div className="p-2 border-b border-[var(--color-border)]">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragging(false)}
          className={"border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors min-h-[100px] flex items-center justify-center " + (dragging ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/40")}
          onClick={() => document.getElementById("sv-input")?.click()}
        >
          {images.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto max-w-full">
              {images.map((img, i) => (
                <img key={i} src={img} className="h-20 rounded object-cover flex-shrink-0" alt="" />
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-secondary)]">
              <div className="text-2xl mb-1">图片</div>
              <div>点击或拖拽图片到此处</div>
            </div>
          )}
          <input
            id="sv-input"
            type="file"
            accept="image/*"
            multiple
            onChange={e => e.target.files && handleFiles(e.target.files)}
            className="hidden"
          />
        </div>

        {/* Custom prompt */}
        <input
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          placeholder="自定义提示词 (可选)..."
          className="w-full mt-1 px-2 py-1 text-[10px] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded"
        />

        {/* Model + Analyze row */}
        <div className="flex gap-1 mt-1.5">
          <div className="relative flex-1">
            <button
              onClick={() => setModelOpen(!modelOpen)}
              className="w-full text-left px-2 py-1 text-[10px] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded"
            >
              {selectedModel || "选择模型"}
            </button>
            {modelOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl max-h-32 overflow-y-auto">
                {models.map(m => (
                  <button
                    key={m}
                    onClick={() => { setSelectedModel(m); setModelOpen(false) }}
                    className={"w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--color-accent)]/10 " + (m === selectedModel ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]")}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !images.length}
            className="px-3 py-1 text-[11px] bg-[var(--color-accent)] text-white rounded disabled:opacity-50"
          >
            {analyzing ? "分析中..." : "分析"}
          </button>
          {images.length > 0 && (
            <button onClick={() => setImages([])} className="px-2 py-1 text-[10px] border border-[var(--color-border)] rounded text-[var(--color-text-secondary)]">
              清除
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-2">
        {suggestions.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-[var(--color-text-secondary)]">结果 ({suggestions.length})</span>
              <div className="flex gap-1">
                <button onClick={selectAll} className="text-[10px] text-[var(--color-accent)] hover:underline">全选</button>
                <button onClick={clearSel} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">取消</button>
                <button onClick={copySel} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">复制</button>
                <button onClick={addToPositive} className="text-[10px] text-green-400 hover:underline">+正面</button>
                <button onClick={addToNegative} className="text-[10px] text-red-400 hover:underline">+负面</button>
                <button onClick={addToLibrary} className="text-[10px] text-[var(--color-accent)] hover:underline">+标签库</button>
                <button onClick={exportJSON} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">导出</button>
              </div>
            </div>
            <div className="space-y-0.5">
              {suggestions.map((s, i) => {
                const sel = selected.has(i)
                const inLib = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
                return (
                  <div
                    key={i}
                    onClick={() => toggleSelect(i)}
                    className={"flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer " + (sel ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "hover:bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]")}
                  >
                    <input type="checkbox" checked={sel} readOnly className="accent-[var(--color-accent)] w-3 h-3" />
                    <span className="font-medium flex-1 truncate">{s.en}</span>
                    <span className="text-[10px] text-[var(--color-text-secondary)] truncate max-w-[100px]">{s.zh}</span>
                    {inLib && <span className="text-[10px] text-green-400">lib</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}
        {!analyzing && suggestions.length === 0 && images.length > 0 && (
          <div className="text-center text-[var(--color-text-secondary)] mt-4 text-[11px]">
            点击分析按钮进行识图
          </div>
        )}
      </div>
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
