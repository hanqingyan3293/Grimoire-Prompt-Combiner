// 魔导书 Grimoire v7 — 简易 AI 面板（右侧标签页）
import React, { useState, useRef, useCallback } from "react"
import { useChatStore } from "../../stores/chat.store"
import { useProviderStore } from "../../stores/providers.store"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"

type SubTab = "chat" | "vision"

export function SimpleAIPanel() {
  const [subTab, setSubTab] = useState<SubTab>("chat")
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[var(--color-border)]">
        <button onClick={() => setSubTab("chat")}
          className={"flex-1 py-1.5 text-xs font-medium transition-colors " + (subTab === "chat" ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]" : "text-[var(--color-text-secondary)]")}>
          💬 聊天
        </button>
        <button onClick={() => setSubTab("vision")}
          className={"flex-1 py-1.5 text-xs font-medium transition-colors " + (subTab === "vision" ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]" : "text-[var(--color-text-secondary)]")}>
          👁 识图
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {subTab === "chat" ? <SimpleChat /> : <SimpleVision />}
      </div>
    </div>
  )
}

function SimpleChat() {
  const { messages, streaming, streamingText, error, sendMessage, clearError } = useChatStore()
  const { activeProvider } = useProviderStore()
  const [input, setInput] = useState("")
  const [selectedModel, setSelectedModel] = useState(activeProvider?.default_model || "gpt-4o")
  const models = activeProvider?.models || [activeProvider?.default_model || "gpt-4o"]

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    if (!activeProvider?.api_key) { showToast("请先配置 API 供应商", "error"); return }
    const msg = input.trim(); setInput("")
    await sendMessage(msg, selectedModel)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {error && <div className="text-xs text-red-400 p-2 bg-red-500/10 rounded">{error}<button onClick={clearError} className="ml-2 underline">x</button></div>}
        {messages.slice(-20).map(msg => (
          <div key={msg.id} className={"text-xs " + (msg.role === "user" ? "text-right" : "text-left")}>
            <div className={"inline-block max-w-[90%] px-2.5 py-1.5 rounded-lg " + (msg.role === "user" ? "bg-[var(--color-accent)]/15" : "bg-[var(--color-bg-primary)]")}>
              <div className="whitespace-pre-wrap break-words text-[var(--color-text-primary)]">{msg.content}</div>
            </div>
          </div>
        ))}
        {streaming && <div className="text-xs text-left"><div className="inline-block max-w-[90%] px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">{streamingText || "▊"}</div></div>}
      </div>
      <div className="p-2 border-t border-[var(--color-border)]">
        <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
          className="w-full mb-1.5 px-2 py-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[10px] text-[var(--color-text-primary)]">
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="flex gap-1">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="输入消息..."
            className="flex-1 px-2 py-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-xs" />
          <button onClick={handleSend} disabled={streaming || !input.trim()}
            className="px-3 py-1 bg-[var(--color-accent)] text-white rounded text-xs disabled:opacity-50">发送</button>
        </div>
      </div>
    </div>
  )
}

function SimpleVision() {
  const { activeProvider } = useProviderStore()
  const { positive, addPositive, addNegative } = usePromptsStore()
  const { tags } = useTagsStore()
  const [images, setImages] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ en: string; zh: string }>>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState<Array<{ time: string; image: string; tags: string[] }>>([])
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type.startsWith("image/"))
    Promise.all(fileArr.map(f => new Promise<string>((resolve) => {
      const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(f)
    }))).then(urls => setImages(prev => [...prev, ...urls]))
  }, [])

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files) }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }

  const handleAnalyze = async () => {
    if (!images.length || !activeProvider?.api_key) { showToast("请先选择图片并配置 API", "error"); return }
    setAnalyzing(true)
    const allTags: Array<{ en: string; zh: string }> = []
    for (const img of images) {
      try {
        const base64 = img.split(",")[1]
        const result = await window.api.ai.vision(base64, "请分析这张图片，列出适合Stable Diffusion/NovelAI提示词的中英文标签，格式：英文 - 中文")
        if (result.success && result.text) {
          const lines = result.text.split(/[\n,，、]/).map(s => s.trim()).filter(Boolean)
          for (const line of lines) {
            const m = line.match(/^(.+?)\s*[-—–]\s*(.+)$/)
            if (m) allTags.push({ en: m[1].trim(), zh: m[2].trim() })
            else { const c = line.replace(/^[-*\d.\s]+/, "").trim(); if (c && c.length < 80) allTags.push({ en: c, zh: c }) }
          }
        }
      } catch {}
    }
    setSuggestions([...new Map(allTags.map(t => [t.en, t])).values()])
    setAnalyzing(false)
  }

  const toggleSelect = (i: number) => { const n = new Set(selected); n.has(i) ? n.delete(i) : n.add(i); setSelected(n) }
  const selectAll = () => setSelected(new Set(suggestions.map((_, i) => i)))
  const clear = () => setSelected(new Set())

  const addToPositive = () => {
    selected.forEach(i => {
      const s = suggestions[i]; const t = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
      if (t) addPositive(t, s.zh, s.en)
    })
    showToast("已添加到正面标签", "success")
  }

  const copySel = () => {
    const text = Array.from(selected).map(i => suggestions[i].en).join(", ")
    navigator.clipboard.writeText(text).then(() => showToast("已复制", "success"))
  }

  const saveRec = () => {
    setHistory(prev => [{ time: new Date().toLocaleString(), image: images[0], tags: suggestions.map(s => s.en) }, ...prev])
    showToast("已保存记录", "success")
  }

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(suggestions, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tags.json"; a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-[var(--color-border)]">
        <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={() => setDragging(false)}
          className={"border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors min-h-[120px] flex items-center justify-center " + (dragging ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/40")}
          onClick={() => document.getElementById("sv-input")?.click()}>
          {images.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto">
              {images.map((img, i) => <img key={i} src={img} className="h-16 rounded object-cover" alt="" />)}
            </div>
          ) : <div className="text-xs text-[var(--color-text-secondary)]">🖼 点击/拖拽上传图片</div>}
          <input id="sv-input" type="file" accept="image/*" multiple onChange={e => e.target.files && handleFiles(e.target.files)} className="hidden" />
        </div>
        <div className="flex gap-1 mt-1.5">
          <button onClick={handleAnalyze} disabled={analyzing || !images.length} className="flex-1 py-1 text-xs bg-[var(--color-accent)] text-white rounded disabled:opacity-50">
            {analyzing ? "分析中..." : "🔍 分析图片"}
          </button>
          {images.length > 0 && <button onClick={() => setImages([])} className="px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:text-red-400">清除</button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {suggestions.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-[var(--color-text-secondary)]">结果 ({suggestions.length})</span>
              <div className="flex gap-1">
                <button onClick={selectAll} className="text-[10px] text-[var(--color-accent)] hover:underline">全选</button>
                <button onClick={clear} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">取消</button>
                <button onClick={copySel} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">复制</button>
                <button onClick={addToPositive} className="text-[10px] text-[var(--color-accent)] hover:underline">+正面</button>
              </div>
            </div>
            <div className="space-y-0.5">
              {suggestions.map((s, i) => {
                const sel = selected.has(i); const inLib = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
                return (
                  <div key={i} onClick={() => toggleSelect(i)}
                    className={"flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer " + (sel ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "hover:bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]")}>
                    <input type="checkbox" checked={sel} readOnly className="accent-[var(--color-accent)]" />
                    <span className="font-medium flex-1 truncate">{s.en}</span>
                    <span className="text-[10px] text-[var(--color-text-secondary)] truncate max-w-[80px]">{s.zh}</span>
                    {inLib && <span className="text-[10px] text-green-400">v库</span>}
                  </div>
                )
              })}
            </div>
            <div className="flex gap-1 mt-2 flex-wrap">
              <button onClick={saveRec} className="text-[10px] px-2 py-1 border border-[var(--color-border)] rounded">💾 保存记录</button>
              <button onClick={exportJSON} className="text-[10px] px-2 py-1 border border-[var(--color-border)] rounded">📤 导出JSON</button>
            </div>
          </>
        )}
        {history.length > 0 && (
          <div className="mt-3 border-t border-[var(--color-border)] pt-2">
            <div className="text-[10px] text-[var(--color-text-secondary)] mb-1">历史记录</div>
            {history.map((h, i) => (
              <div key={i} className="text-[10px] text-[var(--color-text-secondary)] py-0.5">
                {h.time} · {h.tags.slice(0, 5).join(", ")}{h.tags.length > 5 ? " +" + (h.tags.length - 5) : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}