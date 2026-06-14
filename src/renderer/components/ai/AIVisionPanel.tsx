// Grimoire v7 - AI Vision Panel (for AIWindow)
import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useProviderStore } from '../../stores/providers.store'
import { useChatStore } from '../../stores/chat.store'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'

export function AIVisionPanel() {
  const { activeProvider, loadProviders } = useProviderStore()
  const { addPositive, addNegative } = usePromptsStore()
  const { tags, subcategories } = useTagsStore()
  const {
    conversations, activeConversationId, createConversation,
    loadConversations, setActiveConversation
  } = useChatStore()
  const [images, setImages] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ en: string; zh: string }>>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [selectedModel, setSelectedModel] = useState(activeProvider?.default_model || '')
  const [modelOpen, setModelOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [history, setHistory] = useState<Array<{ time: string; image: string; tags: string[] }>>([])

  const models = activeProvider?.models?.length
    ? activeProvider.models
    : (activeProvider?.default_model ? [activeProvider.default_model] : [])

  useEffect(() => { loadProviders(); loadConversations() }, [])

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'))
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
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }

  const handleAnalyze = async () => {
    if (!images.length) return
    if (!activeProvider?.id) { showToast('请先配置 API 供应商', 'error'); return }
    setAnalyzing(true)
    try {
      const base64 = images[0].split(',')[1] || images[0]
      const model = selectedModel || activeProvider.default_model || 'gpt-4o'
      const prompt = customPrompt || '分析图片列出提示词标签，返回JSON: [{"en":"tag","zh":"标签"},...]'
      const result = await window.api.ai.vision({ providerId: activeProvider.id, model, imageBase64: base64, prompt })
      if (result.error) { showToast('识别失败: ' + result.error, 'error'); return }
      const text = result.text || ''
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) {
          setSuggestions(parsed.map((t: any) => ({ en: t.en || t.tag || String(t), zh: t.zh || '' })))
        }
      } catch {
        const lines = text.split('\n').filter(Boolean)
        setSuggestions(lines.map(l => { const p = l.split(/[,，]/); return { en: p[0]?.trim() || l, zh: p[1]?.trim() || '' } }))
      }
      // Save to history
      const tagNames = suggestions.map(s => s.en)
      setHistory(prev => [{ time: new Date().toLocaleTimeString('zh-CN'), image: images[0], tags: tagNames }, ...prev].slice(0, 50))
    } catch (e: any) { showToast('错误: ' + (e?.message || String(e)), 'error') }
    finally { setAnalyzing(false) }
  }

  const toggleSelect = (i: number) => {
    const next = new Set(selected); next.has(i) ? next.delete(i) : next.add(i); setSelected(next)
  }
  const selectAll = () => setSelected(new Set(suggestions.map((_, i) => i)))
  const clearSel = () => setSelected(new Set())
  const copySel = () => {
    navigator.clipboard.writeText(Array.from(selected).map(i => suggestions[i].en).join(', '))
      .then(() => showToast('已复制', 'success'))
  }
  const addToPositive = () => { Array.from(selected).forEach(i => addPositive({ tag_id: suggestions[i].en, weight: 1 } as any)); showToast('已添加到正面', 'success') }
  const addToNegative = () => { Array.from(selected).forEach(i => addNegative({ tag_id: suggestions[i].en, weight: 1 } as any)); showToast('已添加到负面', 'success') }
  const addToLibrary = () => {
    const sub = subcategories[0]
    if (!sub) { showToast('没有可用子类', 'error'); return }
    Promise.all(Array.from(selected).map(i => suggestions[i]).map(t =>
      window.api.tags.create({ subcategory_id: sub.id, en: t.en, zh: t.zh }).catch(() => {})
    )).then(() => showToast('已添加到标签库', 'success'))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Upload zone */}
      <div className="p-4 border-b border-[var(--color-border)]">
        <div
          onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={() => setDragging(false)}
          className={'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors min-h-[120px] flex items-center justify-center ' + (dragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40')}
          onClick={() => document.getElementById('aiv-input')?.click()}
        >
          {images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, i) => <img key={i} src={img} className="h-24 rounded-lg object-cover" alt="" />)}
            </div>
          ) : (
            <div className="text-sm text-[var(--color-text-secondary)]">
              <div className="text-3xl mb-2">🖼</div>
              <div>点击或拖拽图片到此处</div>
            </div>
          )}
          <input id="aiv-input" type="file" accept="image/*" multiple onChange={e => e.target.files && handleFiles(e.target.files)} className="hidden" />
        </div>

        <input value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
          placeholder="自定义提示词 (可选)..." className="w-full mt-2 px-3 py-2 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg" />

        <div className="flex gap-2 mt-2">
          <div className="relative flex-1">
            <button onClick={() => setModelOpen(!modelOpen)}
              className="w-full text-left px-3 py-2 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg">
              {selectedModel || '选择模型'}
            </button>
            {modelOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl max-h-40 overflow-y-auto">
                {models.map(m => (
                  <button key={m} onClick={() => { setSelectedModel(m); setModelOpen(false) }}
                    className={'w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-accent)]/10 ' + (m === selectedModel ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]')}>{m}</button>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleAnalyze} disabled={analyzing || !images.length}
            className="px-6 py-2 text-sm bg-[var(--color-accent)] text-white rounded-lg disabled:opacity-50 font-medium">
            {analyzing ? '分析中...' : '🔍 分析'}
          </button>
          {images.length > 0 && (
            <button onClick={() => setImages([])} className="px-3 py-2 text-xs border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)]">清除</button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {suggestions.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">结果 ({suggestions.length})</span>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-[var(--color-accent)] hover:underline">全选</button>
                <button onClick={clearSel} className="text-xs text-[var(--color-text-secondary)] hover:underline">取消</button>
                <button onClick={copySel} className="text-xs text-[var(--color-text-secondary)] hover:underline">复制</button>
                <button onClick={addToPositive} className="text-xs text-green-400 hover:underline">+正面</button>
                <button onClick={addToNegative} className="text-xs text-red-400 hover:underline">+负面</button>
                <button onClick={addToLibrary} className="text-xs text-[var(--color-accent)] hover:underline">+标签库</button>
              </div>
            </div>
            <div className="space-y-1">
              {suggestions.map((s, i) => {
                const sel = selected.has(i)
                const inLib = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
                return (
                  <div key={i} onClick={() => toggleSelect(i)}
                    className={'flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ' + (sel ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'hover:bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]')}>
                    <input type="checkbox" checked={sel} readOnly className="accent-[var(--color-accent)]" />
                    <span className="font-medium flex-1">{s.en}</span>
                    <span className="text-xs text-[var(--color-text-secondary)] max-w-[120px] truncate">{s.zh}</span>
                    {inLib && <span className="text-xs text-green-400 px-1.5 py-0.5 bg-green-400/10 rounded">库</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}
        {/* History */}
        {history.length > 0 && (
          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            <div className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">历史记录</div>
            <div className="space-y-1">
              {history.map((h, i) => (
                <div key={i} className="flex gap-2 text-xs text-[var(--color-text-secondary)] py-1">
                  <span className="text-[var(--color-accent)]">{h.time}</span>
                  <span className="truncate">{h.tags.slice(0, 5).join(', ')}{h.tags.length > 5 ? ' +' + (h.tags.length - 5) : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function showToast(message: string, type: 'success' | 'error' | 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}
