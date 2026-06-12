import React, { useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { useHistoryStore } from '../../stores/history.store'

interface RightPanelProps {
  showToast: (msg: string, type?: string) => void
  onOpenModal: (modal: 'presets' | 'history' | 'settings' | null) => void
}

const RightPanel: React.FC<RightPanelProps> = ({ showToast, onOpenModal }) => {
  const { positive, negative, qualityWords, removePositive, removeNegative, updateWeight, toggleQualityWords, clearPositive, clearNegative, deduplicate, undo, redo, getFormattedPrompt, getFullPrompt } = usePromptsStore()
  const { addHistory, saveSnapshot } = useHistoryStore()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 2000); showToast('Copied: ' + label, 'success') }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); setCopied(label); setTimeout(() => setCopied(null), 2000) }
  }

  const handleSaveHistory = async () => {
    const prompt = getFullPrompt(); if (!prompt) return
    await addHistory({ prompt, tags: positive.map(t => t.tag.id), negative_tags: negative.map(t => t.tag.id) })
    showToast('Saved to history', 'success')
  }

  const handleSaveSnapshot = async () => {
    const name = prompt('Snapshot name:'); if (!name) return
    await saveSnapshot(name, { positive, negative, qualityWords })
    showToast('Snapshot saved', 'success')
  }

  const handleRandom = () => {
    const store = usePromptsStore.getState()
    const allTags: any[] = []
    try { const ts = useTagsStore.getState(); for (const cat of ts.categories) for (const sub of cat.subcategories||[]) for (const tag of sub.tags||[]) allTags.push({...tag, _cat: cat.name, _sub: sub.name}) } catch {}
    if (allTags.length===0) { showToast('No tags available', 'error'); return }
    const count = Math.min(8, Math.floor(Math.random()*6)+3)
    const sel = allTags.sort(()=>Math.random()-0.5).slice(0,count)
    store.clearPositive()
    for (const tag of sel) store.addPositive({ tag: { id: tag.id, subcategory_id: tag.subcategory_id||'', en: tag.en, zh: tag.zh||'', sort_order: tag.sort_order||0, source: tag.source||'builtin', created_at: tag.created_at||'' }, weight: Math.round((0.8+Math.random()*0.7)*10)/10, category: tag._cat||'', subcategory: tag._sub||'' })
    showToast('Random: ' + count + ' tags', 'success')
  }

  const formatted = getFormattedPrompt('en')
  const formattedZh = getFormattedPrompt('zh')

  return (
    <aside className="flex flex-col w-80 flex-shrink-0 border-l" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
      <div className="p-3 border-b flex flex-wrap gap-1" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={toggleQualityWords} className={'btn btn-sm '+(qualityWords?'btn-primary':'')}>{qualityWords?'ON':'OFF'}</button>
        <button onClick={undo} className="btn btn-sm" title="Ctrl+Z">Undo</button>
        <button onClick={redo} className="btn btn-sm" title="Ctrl+Y">Redo</button>
        <button onClick={deduplicate} className="btn btn-sm">Clean</button>
        <button onClick={handleRandom} className="btn btn-sm">Dice</button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>POS ({positive.length})</span>
          <button onClick={clearPositive} className="btn btn-sm btn-danger" style={{ fontSize: '0.7rem' }}>Clear</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {positive.map(t=>(
            <div key={t.tag.id} className="flex items-center gap-2 p-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-tag-bg)', border: '1px solid var(--color-tag-border)' }}>
              <button onClick={()=>removePositive(t.tag.id)} className="text-xs flex-shrink-0 w-5 h-5 rounded flex items-center justify-center" style={{ color: 'var(--color-danger)' }}>X</button>
              <div className="flex-1 min-w-0"><div className="truncate font-medium">{t.tag.zh||t.tag.en}</div><div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{t.tag.en}</div></div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <input type="range" min="0.1" max="3" step="0.1" value={t.weight} onChange={e=>updateWeight(t.tag.id,parseFloat(e.target.value),'positive')} className="w-12 h-1" />
                <input type="number" min="0.1" max="3" step="0.1" value={t.weight} onChange={e=>updateWeight(t.tag.id,parseFloat(e.target.value),'positive')} className="w-12 px-1 py-0.5 text-xs rounded text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
              </div>
            </div>
          ))}
          {positive.length===0 && <p className="text-xs text-center py-4" style={{ color: 'var(--color-text-muted)' }}>Click tags to add</p>}
        </div>

        <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-3 py-2 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>NEG ({negative.length})</span>
            <button onClick={clearNegative} className="btn btn-sm btn-danger" style={{ fontSize: '0.7rem' }}>Clear</button>
          </div>
          <div className="overflow-y-auto p-2 space-y-1" style={{ maxHeight: '180px' }}>
            {negative.map(t=>(
              <div key={t.tag.id} className="flex items-center gap-2 p-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-tag-bg)', border: '1px solid var(--color-tag-border)' }}>
                <button onClick={()=>removeNegative(t.tag.id)} className="text-xs flex-shrink-0 w-5 h-5 rounded flex items-center justify-center" style={{ color: 'var(--color-danger)' }}>X</button>
                <div className="flex-1 min-w-0"><div className="truncate">{t.tag.zh||t.tag.en}</div><div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{t.tag.en}</div></div>
                <input type="range" min="0.1" max="3" step="0.1" value={t.weight} onChange={e=>updateWeight(t.tag.id,parseFloat(e.target.value),'negative')} className="w-12 h-1" />
              </div>
            ))}
            {negative.length===0 && <p className="text-xs text-center py-2" style={{ color: 'var(--color-text-muted)' }}>Shift+Click = negative</p>}
          </div>
        </div>
      </div>

      <button onClick={()=>setPreviewOpen(true)} className="btn btn-sm mx-3 mt-2">Full Preview</button>

      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
        <div className="p-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
          <div className="mb-1 font-semibold" style={{ color: 'var(--color-success)' }}>{formatted.positive||'(empty)'}</div>
          {formatted.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {formatted.negative}</div>}
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button onClick={()=>copyToClipboard(formatted.positive,'EN')} className="btn btn-sm">EN pos</button>
          <button onClick={()=>copyToClipboard(formattedZh.positive,'ZH')} className="btn btn-sm">ZH pos</button>
          <button onClick={()=>copyToClipboard(getFullPrompt(),'Full')} className="btn btn-sm">Full</button>
          <button onClick={()=>copyToClipboard(formatted.negative,'EN neg')} className="btn btn-sm">EN neg</button>
        </div>

        <div className="flex gap-1">
          <button onClick={handleSaveHistory} className="btn btn-sm flex-1">History</button>
          <button onClick={handleSaveSnapshot} className="btn btn-sm flex-1">Snapshot</button>
          <button onClick={()=>onOpenModal('settings')} className="btn btn-sm">Settings</button>
        </div>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={()=>setPreviewOpen(false)}>
          <div className="w-full max-w-3xl mx-4 p-6 rounded-xl max-h-[85vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--color-accent)' }}>Prompt Preview</h3>
            <div className="p-4 rounded-lg mb-3 whitespace-pre-wrap text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
              <div className="mb-2 font-semibold" style={{ color: 'var(--color-success)' }}>{formatted.positive||'(empty)'}</div>
              {formatted.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {formatted.negative}</div>}
            </div>
            <div className="rounded-lg p-3 mb-3 text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <div className="font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>CN Preview</div>
              <div style={{ color: 'var(--color-success)' }}>{formattedZh.positive||'(empty)'}</div>
              {formattedZh.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {formattedZh.negative}</div>}
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{copyToClipboard(formatted.positive,'EN');setPreviewOpen(false)}} className="btn btn-sm flex-1">Copy EN</button>
              <button onClick={()=>{copyToClipboard(getFullPrompt(),'Full');setPreviewOpen(false)}} className="btn btn-sm flex-1">Copy Full</button>
              <button onClick={()=>setPreviewOpen(false)} className="btn btn-sm flex-1">Close</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

export default RightPanel