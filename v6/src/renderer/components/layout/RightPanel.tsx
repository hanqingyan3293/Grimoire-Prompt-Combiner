import React, { useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useHistoryStore } from '../../stores/history.store'
import { useI18n } from '../../i18n/context'

interface RightPanelProps { showToast: (msg: string, type?: string) => void; onOpenModal: (modal: any) => void }

const RightPanel: React.FC<RightPanelProps> = ({ showToast, onOpenModal }) => {
  const { t } = useI18n()
  const store = usePromptsStore()
  const { addHistory, saveSnapshot } = useHistoryStore()
  const { randomMin, randomMax } = useSettingsStore()
  const [previewOpen, setPreviewOpen] = useState(false)

  const cp = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); showToast(t('right.saved') + ': ' + label, 'success') }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta) }
  }

  const handleSaveHistory = async () => {
    const p = store.getFullPrompt(); if (!p) return
    await addHistory({ prompt: p, tags: store.positive.map(t => t.tag.id), negative_tags: store.negative.map(t => t.tag.id) })
    showToast(t('right.saveHistory'), 'success')
  }

  const handleSaveSnapshot = async () => {
    const n = prompt(t('right.snapshotName')); if (!n) return
    await saveSnapshot(n, { positive: store.positive, negative: store.negative, qualityWords: store.qualityWords })
    showToast(t('right.saveSnapshot'), 'success')
  }

  const handleRandom = () => {
    const allTags: any[] = []
    try { const ts = useTagsStore.getState(); for (const c of ts.categories) for (const s of c.subcategories || []) for (const tg of s.tags || []) allTags.push({ ...tg, _cat: c.name, _sub: s.name }) } catch {}
    if (allTags.length === 0) { showToast('No tags', 'error'); return }
    const mn = randomMin || 3; const mx = randomMax || 8
    const ct = Math.min(mx, Math.floor(Math.random() * (mx - mn + 1)) + mn)
    const sl = allTags.sort(() => Math.random() - 0.5).slice(0, ct)
    store.clearPositive()
    for (const tg of sl) store.addPositive({ tag: { id: tg.id, subcategory_id: tg.subcategory_id || '', en: tg.en, zh: tg.zh || '', sort_order: tg.sort_order || 0, source: tg.source || 'builtin', created_at: tg.created_at || '' }, weight: Math.round((0.8 + Math.random() * 0.7) * 10) / 10, category: tg._cat || '', subcategory: tg._sub || '' })
    showToast(t('right.randomCount') + ': ' + ct, 'success')
  }

  const f = store.getFormattedPrompt('en')
  const fz = store.getFormattedPrompt('zh')
  const emptyLabel = '(' + t('right.empty') + ')'

  return (
    <aside className="flex flex-col w-80 flex-shrink-0 border-l" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
      {/* Action buttons */}
      <div className="p-3 border-b flex flex-wrap gap-1" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={store.toggleQualityWords} title={t('common.on') + '/' + t('common.off')} className={'btn btn-sm ' + (store.qualityWords ? 'btn-primary' : '')}>{store.qualityWords ? t('common.on') : t('common.off')}</button>
        <button onClick={store.undo} title={t('common.undo') + ' (Ctrl+Z)'} className="btn btn-sm">{t('common.undo')}</button>
        <button onClick={store.redo} title={t('common.redo') + ' (Ctrl+Y)'} className="btn btn-sm">{t('common.redo')}</button>
        <button onClick={store.deduplicate} title={t('common.dedup')} className="btn btn-sm">{t('common.dedup')}</button>
        <button onClick={handleRandom} title={t('common.dice')} className="btn btn-sm">{t('common.dice')}</button>
      </div>

      {/* Positive Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>{t('right.pos')} ({store.positive.length})</span>
          <button onClick={store.clearPositive} title={t('right.clear')} className="btn btn-sm btn-danger" style={{ fontSize: '0.7rem' }}>{t('right.clear')}</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {store.positive.map(pt => (
            <div key={pt.tag.id} className="flex items-center gap-2 p-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-tag-bg)', border: '1px solid var(--color-tag-border)' }}>
              <button onClick={() => store.removePositive(pt.tag.id)} title={t('common.del')} className="text-xs flex-shrink-0 w-5 h-5 rounded flex items-center justify-center" style={{ color: 'var(--color-danger)' }}>x</button>
              <div className="flex-1 min-w-0" title={pt.tag.en}><div className="truncate font-medium">{pt.tag.zh || pt.tag.en}</div><div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{pt.tag.en}</div></div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <input type="range" min="0.1" max="3" step="0.1" value={pt.weight} onChange={e => store.updateWeight(pt.tag.id, parseFloat(e.target.value), 'positive')} title={String(pt.weight)} className="w-12 h-1" />
                <input type="number" min="0.1" max="3" step="0.1" value={pt.weight} onChange={e => store.updateWeight(pt.tag.id, parseFloat(e.target.value), 'positive')} className="w-12 px-1 py-0.5 text-xs rounded text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} title={String(pt.weight)} />
              </div>
            </div>
          ))}
          {store.positive.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--color-text-muted)' }}>{t('right.clickAdd')}</p>}
        </div>

        {/* Negative Panel */}
        <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-3 py-2 border-b flex justify-between items-center" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>{t('right.neg')} ({store.negative.length})</span>
            <button onClick={store.clearNegative} title={t('right.clear')} className="btn btn-sm btn-danger" style={{ fontSize: '0.7rem' }}>{t('right.clear')}</button>
          </div>
          <div className="overflow-y-auto p-2 space-y-1" style={{ maxHeight: '180px' }}>
            {store.negative.map(nt => (
              <div key={nt.tag.id} className="flex items-center gap-2 p-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-tag-bg)', border: '1px solid var(--color-tag-border)' }}>
                <button onClick={() => store.removeNegative(nt.tag.id)} title={t('common.del')} className="text-xs flex-shrink-0 w-5 h-5 rounded flex items-center justify-center" style={{ color: 'var(--color-danger)' }}>x</button>
                <div className="flex-1 min-w-0" title={nt.tag.en}><div className="truncate">{nt.tag.zh || nt.tag.en}</div><div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{nt.tag.en}</div></div>
                <input type="range" min="0.1" max="3" step="0.1" value={nt.weight} onChange={e => store.updateWeight(nt.tag.id, parseFloat(e.target.value), 'negative')} title={String(nt.weight)} className="w-12 h-1" />
              </div>
            ))}
            {store.negative.length === 0 && <p className="text-xs text-center py-2" style={{ color: 'var(--color-text-muted)' }}>{t('right.shiftAdd')}</p>}
          </div>
        </div>
      </div>

      {/* Preview Toggle */}
      <button onClick={() => setPreviewOpen(true)} title={t('right.fullPreview')} className="btn btn-sm mx-3 mt-2">{t('right.fullPreview')}</button>

      {/* Output + Copy */}
      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
        <div className="p-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
          <div className="mb-1 font-semibold" style={{ color: 'var(--color-success)' }}>{f.positive || emptyLabel}</div>
          {f.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {f.negative}</div>}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button onClick={() => cp(f.positive, 'EN')} title={t('right.copyEN')} className="btn btn-sm">{t('right.copyEN')}</button>
          <button onClick={() => cp(fz.positive, 'ZH')} title={t('right.copyZH')} className="btn btn-sm">{t('right.copyZH')}</button>
          <button onClick={() => cp(store.getFullPrompt(), 'Full')} title={t('right.copyFull')} className="btn btn-sm">{t('right.copyFull')}</button>
          <button onClick={() => cp(f.negative, 'Neg')} title={t('right.copyNeg')} className="btn btn-sm">{t('right.copyNeg')}</button>
        </div>
        <div className="flex gap-1">
          <button onClick={handleSaveHistory} title={t('right.history')} className="btn btn-sm flex-1">{t('right.history')}</button>
          <button onClick={handleSaveSnapshot} title={t('right.snapshot')} className="btn btn-sm flex-1">{t('right.snapshot')}</button>
          <button onClick={() => onOpenModal('settings')} title={t('right.settings')} className="btn btn-sm">{t('right.settings')}</button>
        </div>
      </div>

      {/* Preview Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={() => setPreviewOpen(false)}>
          <div className="w-full max-w-3xl mx-4 p-6 rounded-xl max-h-[85vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-3" style={{ color: 'var(--color-accent)' }}>{t('right.previewTitle')}</h3>
            <div className="p-4 rounded-lg mb-3 whitespace-pre-wrap text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
              <div className="mb-2 font-semibold" style={{ color: 'var(--color-success)' }}>{f.positive || emptyLabel}</div>
              {f.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {f.negative}</div>}
            </div>
            <div className="rounded-lg p-3 mb-3 text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <div className="font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('right.cnPreview')}</div>
              <div style={{ color: 'var(--color-success)' }}>{fz.positive || emptyLabel}</div>
              {fz.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {fz.negative}</div>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { cp(f.positive, 'EN'); setPreviewOpen(false) }} className="btn btn-sm flex-1">{t('right.copyEN')}</button>
              <button onClick={() => { cp(store.getFullPrompt(), 'Full'); setPreviewOpen(false) }} className="btn btn-sm flex-1">{t('right.copyFull')}</button>
              <button onClick={() => setPreviewOpen(false)} className="btn btn-sm flex-1">{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
export default RightPanel