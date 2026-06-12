import React, { useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useHistoryStore } from '../../stores/history.store'
import { useI18n } from '../../i18n/context'
import PanelSection from '../ui/PanelSection'

interface PromptPanelProps { showToast: (msg: string, type?: string) => void }

// Weight input component
const WeightInput: React.FC<{
  weight: number
  onChange: (v: number) => void
}> = ({ weight, onChange }) => {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(weight))

  const commit = () => {
    const n = parseFloat(value)
    if (!isNaN(n) && n >= 0.1 && n <= 3) {
      onChange(Math.round(n * 10) / 10)
      setValue(String(Math.round(n * 10) / 10))
    } else {
      setValue(String(weight))
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="number"
        min="0.1" max="3" step="0.1"
        value={value}
        style={{
          width: 36, height: 18, fontSize: 10, textAlign: 'center',
          padding: '0 2px', border: '1px solid var(--color-accent)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-input)',
          color: 'var(--color-text-primary)',
          fontFamily: 'monospace',
        }}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setValue(String(weight)); setEditing(false) } }}
        autoFocus
        onFocus={e => e.target.select()}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="点击编辑权重"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 18, fontSize: 10, fontWeight: 700,
        cursor: 'pointer', userSelect: 'none',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-accent-bg)',
        color: 'var(--color-accent)',
        fontFamily: 'monospace',
        flexShrink: 0,
      }}
    >
      {weight.toFixed(1)}
    </span>
  )
}

const PromptPanel: React.FC<PromptPanelProps> = ({ showToast }) => {
  const { t } = useI18n()
  const store = usePromptsStore()
  const { addHistory, saveSnapshot } = useHistoryStore()
  const { randomMin, randomMax } = useSettingsStore()
  const [previewOpen, setPreviewOpen] = useState(false)

  const cp = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); showToast(label + ' ✔', 'success') }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta) }
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

  return (
    <div>
      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8 }}>
        <button onClick={store.toggleQualityWords} title={t('common.on') + '/' + t('common.off')} className={'ps-btn ps-btn--sm' + (store.qualityWords ? ' ps-btn--primary' : '')}>{store.qualityWords ? t('common.on') : t('common.off')}</button>
        <button onClick={store.undo} title={t('common.undo') + ' (Ctrl+Z)'} className="ps-btn ps-btn--sm">{t('common.undo')}</button>
        <button onClick={store.redo} title={t('common.redo') + ' (Ctrl+Y)'} className="ps-btn ps-btn--sm">{t('common.redo')}</button>
        <button onClick={store.deduplicate} title={t('common.dedup')} className="ps-btn ps-btn--sm">{t('common.dedup')}</button>
        <button onClick={handleRandom} title={t('common.dice')} className="ps-btn ps-btn--sm">{t('common.dice')}</button>
      </div>

      {/* Positive tags */}
      <PanelSection title={t('panels.prompt.positive')} badge={String(store.positive.length)}>
        <div style={{ padding: '4px 8px 8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {store.positive.map(pt => (
              <span key={pt.tag.id} className="prompt-tag-chip" title={pt.tag.en + ' (' + pt.weight + ')'}>
                <span className="truncate" style={{ maxWidth: 120 }}>{pt.tag.zh || pt.tag.en}</span>
                <WeightInput
                  weight={pt.weight}
                  onChange={v => store.updateWeight(pt.tag.id, v, 'positive')}
                />
                <input
                  type="range" min="0.1" max="3" step="0.1"
                  value={pt.weight}
                  onChange={e => store.updateWeight(pt.tag.id, parseFloat(e.target.value), 'positive')}
                  className="ps-slider"
                  title={String(pt.weight)}
                  style={{ width: 40, flexShrink: 0 }}
                />
                <button onClick={() => store.removePositive(pt.tag.id)} className="prompt-tag-chip__remove" title={t('common.del')}>×</button>
              </span>
            ))}
            {store.positive.length === 0 && <span style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)', padding: 8 }}>{t('right.clickAdd')}</span>}
          </div>
          <button onClick={store.clearPositive} className="ps-btn ps-btn--sm ps-btn--danger" style={{ marginTop: 6 }}>{t('right.clear')}</button>
        </div>
      </PanelSection>

      {/* Negative tags */}
      <PanelSection title={t('panels.prompt.negative')} badge={String(store.negative.length)} defaultOpen={false}>
        <div style={{ padding: '4px 8px 8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {store.negative.map(nt => (
              <span key={nt.tag.id} className="prompt-tag-chip" title={nt.tag.en} style={{ borderColor: 'var(--color-danger)' }}>
                <span className="truncate" style={{ maxWidth: 120 }}>{nt.tag.zh || nt.tag.en}</span>
                <WeightInput
                  weight={nt.weight}
                  onChange={v => store.updateWeight(nt.tag.id, v, 'negative')}
                />
                <input
                  type="range" min="0.1" max="3" step="0.1"
                  value={nt.weight}
                  onChange={e => store.updateWeight(nt.tag.id, parseFloat(e.target.value), 'negative')}
                  className="ps-slider"
                  title={String(nt.weight)}
                  style={{ width: 40, flexShrink: 0 }}
                />
                <button onClick={() => store.removeNegative(nt.tag.id)} className="prompt-tag-chip__remove" title={t('common.del')}>×</button>
              </span>
            ))}
            {store.negative.length === 0 && <span style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)', padding: 8 }}>{t('right.shiftAdd')}</span>}
          </div>
          <button onClick={store.clearNegative} className="ps-btn ps-btn--sm ps-btn--danger" style={{ marginTop: 6 }}>{t('right.clear')}</button>
        </div>
      </PanelSection>

      {/* Output preview */}
      <PanelSection title={t('panels.prompt.output')}>
        <div style={{ padding: '4px 8px' }}>
          <div style={{ padding: 8, background: 'var(--color-bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-ui)', marginBottom: 8, border: '1px solid var(--color-border)', maxHeight: 120, overflowY: 'auto' }}>
            <div style={{ color: 'var(--color-success)', marginBottom: 4 }}>{f.positive || '(' + t('right.empty') + ')'}</div>
            {f.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {f.negative}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
            <button onClick={() => cp(f.positive, 'EN')} title={t('right.copyEN')} className="ps-btn ps-btn--sm">{t('right.copyEN')}</button>
            <button onClick={() => cp(fz.positive, 'ZH')} title={t('right.copyZH')} className="ps-btn ps-btn--sm">{t('right.copyZH')}</button>
            <button onClick={() => cp(store.getFullPrompt(), 'Full')} title={t('right.copyFull')} className="ps-btn ps-btn--sm">{t('right.copyFull')}</button>
            <button onClick={() => cp(f.negative, 'Neg')} title={t('right.copyNeg')} className="ps-btn ps-btn--sm">{t('right.copyNeg')}</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={async () => { const p = store.getFullPrompt(); if (!p) return; await addHistory({ prompt: p, tags: store.positive.map(t => t.tag.id), negative_tags: store.negative.map(t => t.tag.id) }); showToast(t('right.saveHistory'), 'success') }} className="ps-btn ps-btn--sm flex-1" title={t('right.history')}>{t('right.history')}</button>
            <button onClick={async () => { const n = prompt(t('right.snapshotName')); if (!n) return; await saveSnapshot(n, { positive: store.positive, negative: store.negative, qualityWords: store.qualityWords }); showToast(t('right.saveSnapshot'), 'success') }} className="ps-btn ps-btn--sm flex-1" title={t('right.snapshot')}>{t('right.snapshot')}</button>
            <button onClick={() => setPreviewOpen(true)} className="ps-btn ps-btn--sm" title={t('right.fullPreview')}>🔍</button>
          </div>
        </div>
      </PanelSection>

      {/* Preview modal */}
      {previewOpen && (
        <div className="ps-modal-overlay" onClick={() => setPreviewOpen(false)}>
          <div className="ps-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="ps-modal__header">
              <span className="ps-modal__title">{t('right.previewTitle')}</span>
              <button onClick={() => setPreviewOpen(false)} className="ps-icon-btn" title={t('common.close')}>×</button>
            </div>
            <div className="ps-modal__body" style={{ fontSize: 'var(--font-size-panel)' }}>
              <div style={{ marginBottom: 12, padding: 8, background: 'var(--color-bg-input)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ color: 'var(--color-success)', fontWeight: 600, marginBottom: 4 }}>{f.positive || '(' + t('right.empty') + ')'}</div>
                {f.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {f.negative}</div>}
              </div>
              <div style={{ marginBottom: 12, padding: 8, background: 'var(--color-bg-input)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 4 }}>{t('right.cnPreview')}</div>
                <div style={{ color: 'var(--color-success)' }}>{fz.positive || '(' + t('right.empty') + ')'}</div>
                {fz.negative && <div style={{ color: 'var(--color-danger)' }}>Negative: {fz.negative}</div>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => { cp(f.positive, 'EN'); setPreviewOpen(false) }} className="ps-btn ps-btn--primary flex-1">{t('right.copyEN')}</button>
                <button onClick={() => { cp(store.getFullPrompt(), 'Full'); setPreviewOpen(false) }} className="ps-btn flex-1">{t('right.copyFull')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PromptPanel
