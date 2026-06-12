import React, { useEffect, useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useI18n } from '../../i18n/context'
import PanelSection from '../ui/PanelSection'

interface PresetsPanelProps { showToast: (msg: string, type?: string) => void }

const PresetsPanel: React.FC<PresetsPanelProps> = ({ showToast }) => {
  const { t } = useI18n()
  const [presets, setPresets] = useState<any[]>([])
  const [saveName, setSaveName] = useState('')

  useEffect(() => { loadPresets() }, [])

  const loadPresets = async () => {
    try { const p = await window.electronAPI.presets.getAll(); setPresets(Array.isArray(p) ? p : []) } catch { setPresets([]) }
  }

  const handleSave = async () => {
    if (!saveName.trim()) return
    const store = usePromptsStore.getState()
    try {
      await window.electronAPI.presets.save({
        id: crypto.randomUUID(),
        name: saveName.trim(),
        positive: store.positive,
        negative: store.negative,
        qualityWords: store.qualityWords,
        created_at: new Date().toISOString()
      })
      setSaveName('')
      await loadPresets()
      showToast(t('presets.saved'), 'success')
    } catch { showToast('Error', 'error') }
  }

  const handleLoad = async (p: any) => {
    const store = usePromptsStore.getState()
    store.clearPositive(); store.clearNegative()
    if (p.positive) for (const pt of p.positive) store.addPositive(pt)
    if (p.negative) for (const nt of p.negative) store.addNegative(nt)
    showToast(t('presets.loaded'), 'success')
  }

  const handleDelete = async (id: string) => {
    try { await window.electronAPI.presets.delete(id); await loadPresets(); showToast(t('presets.deleted'), 'success') } catch {}
  }

  const handleCopy = async (p: any) => {
    try {
      const text = JSON.stringify({ positive: p.positive, negative: p.negative }, null, 2)
      await navigator.clipboard.writeText(text)
      showToast(t('common.copy') + ' \u2714', 'success')
    } catch {}
  }

  return (
    <div>
      {/* Save */}
      <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid var(--color-border)' }}>
        <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder={t('presets.name')} className="ps-input flex-1" />
        <button onClick={handleSave} className="ps-btn ps-btn--sm ps-btn--primary">{t('presets.save')}</button>
      </div>

      <PanelSection title={t('panels.presets.myPresets')} badge={String(presets.length)}>
        <div style={{ padding: 4 }}>
          {presets.length === 0 ? (
            <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)', padding: 16, textAlign: 'center' }}>{t('presets.noPresets')}</div>
          ) : (
            presets.map((p: any) => (
              <div key={p.id} style={{ padding: '4px 8px', borderBottom: '1px solid var(--separator-color)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-ui)' }}>
                <div className="truncate flex-1" style={{ color: 'var(--color-text-secondary)' }} title={p.name}>{p.name}</div>
                <button onClick={() => handleLoad(p)} className="ps-btn ps-btn--xs ps-btn--primary" title={t('presets.load')}>{t('presets.load')}</button>
                <button onClick={() => handleCopy(p)} className="ps-btn ps-btn--xs" title={t('common.copy')}>{t('common.copy')}</button>
                <button onClick={() => handleDelete(p.id)} className="ps-btn ps-btn--xs ps-btn--danger" title={t('presets.delete')}>&times;</button>
              </div>
            ))
          )}
        </div>
      </PanelSection>
    </div>
  )
}

export default PresetsPanel