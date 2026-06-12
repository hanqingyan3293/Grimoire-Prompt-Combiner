import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useI18n } from '../../i18n/context'
import { usePromptsStore } from '../../stores/prompts.store'
import { useSettingsStore } from '../../stores/settings.store'

// ============================================================
// AIPanel - Chatbox-style AI panel (Chat + Vision tabs)
// OpenAI-compatible API via nonelinear.com proxy
// ============================================================

interface AIPanelProps { showToast: (msg: string, type?: string) => void }

interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string }
interface VisionTag { name: string; confidence: number; category: string }
interface ModelInfo { id: string; owned_by?: string }

const SYSTEM_PROMPT = 'You are a professional AI art prompt engineer. Help users create, optimize, and translate prompts for Stable Diffusion. Be concise and helpful. Reply in the language the user uses.'

// ---- API helpers (OpenAI-compatible) ----
async function apiFetch(endpoint: string, body: any, apiKey: string, baseUrl: string, signal?: AbortSignal) {
  const resp = await fetch(baseUrl + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body),
    signal,
  })
  const data = await resp.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data
}

async function fetchModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
  try {
    const resp = await fetch(baseUrl + '/models', { headers: { 'Authorization': 'Bearer ' + apiKey } })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.data || []).map((m: any) => ({ id: m.id, owned_by: m.owned_by || '' }))
  } catch { return [] }
}

const AIPanel: React.FC<AIPanelProps> = ({ showToast }) => {
  const { t } = useI18n()
  const addPositive = usePromptsStore(s => s.addPositive)
  const apiEndpoint = useSettingsStore(s => s.aiEndpoint)
  const apiKey = useSettingsStore(s => s.aiApiKey)
  const savedModel = useSettingsStore(s => s.aiModel)

  // Tab state
  const [tab, setTab] = useState<'chat' | 'vision'>('chat')

  // ---- Chat state ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hello! I am your AI prompt engineer. I can help you create and optimize prompts for Stable Diffusion. How can I help you?' }
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [aiModel, setAiModel] = useState(savedModel || 'grok-3')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT)
  const [showSystemEdit, setShowSystemEdit] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ---- Vision state ----
  const [imageData, setImageData] = useState<string | null>(null)
  const [imageFileName, setImageFileName] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [tags, setTags] = useState<VisionTag[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load models on mount
  useEffect(() => { fetchModels(apiKey, apiEndpoint).then(setModels) }, [])

  // Scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  // ---- Chat handlers ----
  const handleSend = async () => {
    const text = chatInput.trim()
    if (!text || chatLoading) return
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setChatLoading(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const data = await apiFetch('/chat/completions', {
        model: aiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...newMessages.map(m => ({ role: m.role, content: m.content }))
        ],
        max_tokens: 2000,
        stream: false,
      }, apiKey, apiEndpoint, abort.signal)

      const reply = data.choices?.[0]?.message?.content || '(empty)'
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err: any) {
      if (err.name === 'AbortError') return
      showToast('Chat error: ' + err.message, 'error')
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }])
    }
    setChatLoading(false)
  }

  const handleClearChat = () => {
    setChatMessages([{ role: 'assistant', content: 'Conversation cleared. How can I help?' }])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ---- Vision handlers ----
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Only image files', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => { setImageData(reader.result as string); setImageFileName(file.name); setTags([]) }
    reader.readAsDataURL(file)
  }, [showToast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Only image files', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => { setImageData(reader.result as string); setImageFileName(file.name); setTags([]) }
    reader.readAsDataURL(file)
  }, [showToast])

  const handleAnalyze = async () => {
    if (!imageData) { showToast('Upload an image first', 'error'); return }
    setAnalyzing(true)
    setTags([])
    try {
      const data = await apiFetch('/chat/completions', {
        model: 'grok-3',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image for AI art tagging. Output ONLY in this exact format, one tag per line: tag_name|category|confidence\nCategories: character/scene/object/style/quality/role/action/expression/outfit/angle\nConfidence: 0.0 to 1.0\nExample:\n1girl|character|0.95\nsolo|character|0.90' },
            { type: 'image_url', image_url: { url: imageData } }
          ]
        }],
        max_tokens: 800,
        temperature: 0.2,
      }, apiKey, apiEndpoint)
      const content = data.choices?.[0]?.message?.content || ''
      const parsed = parseVisionTags(content)
      setTags(parsed)
      showToast('Found ' + parsed.length + ' tags', 'success')
    } catch (err: any) {
      showToast('Analysis failed: ' + err.message, 'error')
    }
    setAnalyzing(false)
  }

  const parseVisionTags = (text: string): VisionTag[] => {
    const cats = ['character','scene','object','style','quality','role','action','expression','outfit','angle']
    const seen = new Set<string>()
    const result: VisionTag[] = []
    const lines = (text.match(/```[\s\S]*?```/g)?.join('\n') || text).split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('```') || trimmed.startsWith('**')) continue
      const parts = trimmed.split('|')
      if (parts.length < 2) continue
      const name = parts[0].trim()
      const cat = parts[1].trim()
      const conf = parts.length > 2 ? parseFloat(parts[2].trim()) : 0.8
      if (!name || name.length > 50 || seen.has(name.toLowerCase())) continue
      if (!cats.includes(cat) && cat.length > 15) continue
      seen.add(name.toLowerCase())
      result.push({ name, category: cat, confidence: Math.min(1, Math.max(0, (conf > 1 ? conf / 100 : conf) || 0.8)) })
    }
    return result.sort((a, b) => b.confidence - a.confidence)
  }

  const handleAddTag = (tag: VisionTag) => {
    addPositive({
      tag: { id: 'ai_' + Date.now(), subcategory_id: '', en: tag.name, zh: '', sort_order: 0, source: 'ai', created_at: '' },
      weight: Math.round(tag.confidence * 10) / 10,
      category: tag.category, subcategory: 'AI'
    })
    showToast('Added: ' + tag.name, 'success')
  }

  const handleAddAllTags = () => { tags.forEach(t => handleAddTag(t)) }

  // Save AI tag to tag library (database)
  const handleSaveToLibrary = async (tag: VisionTag) => {
    try {
      const result = await (window as any).electronAPI.tags.add({
        category: 'AI Generated',
        subcategory: tag.category || 'General',
        en: tag.name,
        zh: ''
      })
      if (result?.ok) showToast('Saved to library: ' + tag.name, 'success')
      else showToast('Save failed: ' + (result?.error || 'Unknown'), 'error')
    } catch { showToast('Save failed', 'error') }
  }

  const handleSaveAllToLibrary = async () => {
    let count = 0
    for (const tag of tags) {
      try {
        const r = await (window as any).electronAPI.tags.add({
          category: 'AI Generated',
          subcategory: tag.category || 'General',
          en: tag.name, zh: ''
        })
        if (r?.ok) count++
      } catch {}
    }
    showToast('Saved ' + count + ' tags to library', 'success')
  }

  // ---- Styles ----
  const bubbleStyle = (role: string): React.CSSProperties => ({
    maxWidth: '85%', padding: '8px 12px', borderRadius: role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
    fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    background: role === 'user' ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
    color: role === 'user' ? '#fff' : 'var(--color-text-primary)',
    border: role === 'assistant' ? '1px solid var(--color-border)' : 'none',
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {[
          { id: 'chat' as const, label: '💬 Chat', key: 'chat' },
          { id: 'vision' as const, label: '🖼️ Vision', key: 'vision' },
        ].map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.id)}
            style={{
              flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === tb.id ? 'var(--color-accent)' : 'var(--color-text-dim)',
              borderBottom: tab === tb.id ? '2px solid var(--color-accent)' : '2px solid transparent',
            }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* === CHAT TAB === */}
      {tab === 'chat' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Model selector */}
          <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={aiModel} onChange={e => setAiModel(e.target.value)}
              style={{ flex: 1, height: 26, fontSize: 11, padding: '0 4px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', borderRadius: 4 }}>
              {models.filter(m => !m.id.includes('embedding') && !m.id.includes('tts') && !m.id.includes('whisper') && !m.id.includes('dall-e') && !m.id.includes('imagen') && !m.id.includes('kling') && !m.id.includes('wan') && !m.id.includes('veo') && !m.id.includes('flux') && !m.id.includes('cogview') && !m.id.includes('stable-') && !m.id.includes('sora')).slice(0, 80).map(m => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
            <button onClick={() => setShowSystemEdit(!showSystemEdit)} className="ps-btn ps-btn--xs" title="System prompt" style={{ fontSize: 11 }}>⚙</button>
            <button onClick={handleClearChat} className="ps-btn ps-btn--xs" title="Clear chat" style={{ fontSize: 11 }}>🧹</button>
          </div>

          {/* System prompt editor */}
          {showSystemEdit && (
            <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                style={{ width: '100%', height: 50, fontSize: 10, padding: 4, background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', borderRadius: 4, resize: 'vertical' }} />
            </div>
          )}

          {/* Chat messages */}
          <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={bubbleStyle(msg.role)}>{msg.content}</div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={bubbleStyle('assistant')}>Thinking...</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div style={{ padding: 8, borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: 6 }}>
            <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send)"
              style={{ flex: 1, height: 36, fontSize: 12, padding: '6px 8px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', borderRadius: 6, resize: 'none' }} />
            <button onClick={handleSend} disabled={chatLoading || !chatInput.trim()}
              className="ps-btn ps-btn--primary" style={{ width: 48, height: 36, fontSize: 16 }}>↑</button>
          </div>
        </div>
      )}

      {/* === VISION TAB === */}
      {tab === 'vision' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              margin: 8, padding: 20, minHeight: 120,
              border: '2px dashed ' + (dragOver ? 'var(--color-accent)' : 'var(--color-border)'),
              borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'border-color 120ms',
              background: dragOver ? 'var(--color-accent-bg)' : 'var(--color-bg-primary)',
            }}>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
            {imageData ? (
              <div style={{ textAlign: 'center' }}>
                <img src={imageData} alt="preview" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 4, marginBottom: 8, border: '1px solid var(--color-border)' }} />
                <div style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{imageFileName}</div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--color-text-dim)' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>🖼️</div>
                <div style={{ fontSize: 12, marginBottom: 2 }}>Drag image here</div>
                <div style={{ fontSize: 10 }}>or click to select</div>
              </div>
            )}
          </div>

          {/* Analyze button */}
          <div style={{ padding: '0 8px', marginBottom: 8 }}>
            <button onClick={handleAnalyze} disabled={analyzing || !imageData}
              className="ps-btn ps-btn--primary" style={{ width: '100%', height: 32, fontSize: 13 }}>
              {analyzing ? 'Analyzing...' : 'Analyze Image'}
            </button>
          </div>

          {/* Results */}
          {tags.length > 0 && (
            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  Results ({tags.length})
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={handleAddAllTags} className="ps-btn ps-btn--xs ps-btn--primary">+ Prompt</button>
                  <button onClick={handleSaveAllToLibrary} className="ps-btn ps-btn--xs" style={{ background: 'var(--color-bg-tertiary)' }}>+ Library</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {tags.map((tag, i) => (
                  <div key={i}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: tag.confidence > 0.7 ? 'var(--color-success)' : tag.confidence > 0.4 ? 'var(--color-warning)' : 'var(--color-text-dim)' }} />
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{tag.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-dim)', background: 'var(--color-bg-tertiary)', padding: '1px 6px', borderRadius: 4 }}>{tag.category}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-accent)', fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{Math.round(tag.confidence * 100)}%</span>
                    <button onClick={(ev) => { ev.stopPropagation(); handleAddTag(tag) }} className="ps-btn ps-btn--xs ps-btn--primary" title="Add to prompt">+</button>
                    <button onClick={(ev) => { ev.stopPropagation(); handleSaveToLibrary(tag) }} className="ps-btn ps-btn--xs" title="Save to library">💾</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* WD14 placeholder */}
          {tags.length === 0 && !analyzing && (
            <div style={{ padding: 12, margin: 8, background: 'var(--color-bg-secondary)', borderRadius: 4, border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>WD14 Tagger (coming soon)</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-dim)', lineHeight: 1.6 }}>
                <div>- Local model tag inference</div>
                <div>- WD14-vit-v2 / ConvNext / SwinV2</div>
                <div>- Configure model path in Settings</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AIPanel
