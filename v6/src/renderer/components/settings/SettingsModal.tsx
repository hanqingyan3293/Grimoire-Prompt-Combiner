import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { useI18n } from '../../i18n/context'
import ColorWheel from './ColorWheel'

const THEMES = [
  { id: 'neon', name: 'Neon', emoji: '🟣' },
  { id: 'clean', name: 'Clean', emoji: '🔵' },
  { id: 'gold', name: 'Gold', emoji: '🟡' },
  { id: 'midnight', name: 'Midnight', emoji: '🌙' },
  { id: 'sakura', name: 'Sakura', emoji: '🌸' },
  { id: 'forest', name: 'Forest', emoji: '🌲' },
  { id: 'sunset', name: 'Sunset', emoji: '🌅' },
]

interface SettingsModalProps { onClose: () => void; showToast: (msg: string, type?: string) => void }

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, showToast }) => {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme, fontSize, setSetting, randomMin, randomMax, customAccent } = useSettingsStore()
  const aiProvider = useSettingsStore(s => s.aiProvider) || 'openai'
  const aiApiKey = useSettingsStore(s => s.aiApiKey) || ''
  const aiEndpointStore = useSettingsStore(s => s.aiEndpoint) || ''
  const aiModelStore = useSettingsStore(s => s.aiModel) || 'gpt-4o'
  const [aiProviderLocal, setAiProviderLocal] = useState(aiProvider)
  const [aiKey, setAiKey] = useState(aiApiKey)
  const [aiEndpoint, setAiEndpointLocal] = useState(aiEndpointStore)
  const [aiModel, setAiModel] = useState(aiModelStore)
  const [localMin, setLocalMin] = useState(String(randomMin||3))
  const [localMax, setLocalMax] = useState(String(randomMax||8))

  const handleSaveAI = async () => {
    await setSetting('aiProvider', aiProviderLocal)
    await setSetting('aiApiKey', aiKey)
    await setSetting('aiEndpoint', aiEndpoint)
    await setSetting('aiModel', aiModel)
    showToast(t('settings.save'), 'success')
  }

  const handleRandomRange = () => {
    const mn = Math.max(1, parseInt(localMin)||3)
    const mx = Math.max(mn, parseInt(localMax)||8)
    setSetting('randomMin', String(mn))
    setSetting('randomMax', String(mx))
    showToast(t('common.save')+' ✅', 'success')
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-lg mx-4 p-6 rounded-xl max-h-[85vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-accent)' }}>⚙ {t('settings.title')}</h2>

        {/* Language */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.lang')}</h3>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setLang('zh')} title="中文" className={'btn btn-sm flex-1 '+(lang==='zh'?'btn-primary':'')}>🇨🇳 中文</button>
          <button onClick={() => setLang('en')} title="English" className={'btn btn-sm flex-1 '+(lang==='en'?'btn-primary':'')}>🇬🇧 English</button>
        </div>

        {/* Font Size */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.fontSize')}</h3>
        <div className="flex gap-1 mb-4">
          {[12,14,16].map(s => (
            <button key={s} onClick={() => setSetting('fontSize', String(s))} title={s+'px'} className={'btn btn-sm flex-1 '+(fontSize===String(s)?'btn-primary':'')}>{s}px</button>
          ))}
          <input type="number" min="10" max="24" value={fontSize||14} onChange={e => setSetting('fontSize', e.target.value)} title={t('settings.fontCustom')} className="w-16 px-2 py-1 rounded text-xs text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        </div>

        {/* Random Range */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.randomRange')}</h3>
        <div className="flex gap-2 items-center mb-4">
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Min</span>
          <input type="number" min="1" max="20" value={localMin} onChange={e => setLocalMin(e.target.value)} title="Min" className="w-16 px-2 py-1 rounded text-xs text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>-</span>
          <input type="number" min="1" max="30" value={localMax} onChange={e => setLocalMax(e.target.value)} title="Max" className="w-16 px-2 py-1 rounded text-xs text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
          <button onClick={handleRandomRange} className="btn btn-sm btn-primary">{t('common.save')}</button>
        </div>

        {/* Theme */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.theme')}</h3>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {THEMES.map(tm => (
            <button key={tm.id} onClick={() => setTheme(tm.id)} title={tm.name}
              className="p-2 rounded-lg text-center text-sm transition-all"
              style={{ backgroundColor: theme===tm.id ? 'var(--color-tag-bg)' : 'var(--color-bg-primary)', border: theme===tm.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
              <div className="text-lg">{tm.emoji}</div><div className="text-xs">{tm.name}</div>
            </button>
          ))}
        </div>

        {/* Custom Color */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.customColor')}</h3>
        <div className="mb-4">
          <ColorWheel accentColor={customAccent||'#7c3aed'} onChange={c => setSetting('customAccent', c)} />
        </div>

        {/* AI Settings */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>🤖 {t('settings.aiTitle')}</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>{t('settings.aiNote')}</p>
        <div className="space-y-3 mb-4">
          <div><label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.aiProvider')}</label>
            <select value={aiProviderLocal} onChange={e => setAiProviderLocal(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
              <option value="openai">OpenAI Compatible</option><option value="custom">Custom</option>
            </select></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Endpoint</label>
            <input type="text" value={aiEndpoint} onChange={e => setAiEndpointLocal(e.target.value)} placeholder="https://api.nonelinear.com/v1" className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.apiKey')}</label>
            <input type="password" value={aiKey} onChange={e => setAiKey(e.target.value)} placeholder="sk-..." className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} /></div>
          <div><label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.model')}</label>
            <input type="text" value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} /></div>
          <button onClick={handleSaveAI} className="btn btn-primary w-full">{t('settings.save')}</button>
        </div>

        {/* Shortcuts */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.shortcuts')}</h3>
        <div className="text-xs space-y-1 mb-4" style={{ color: 'var(--color-text-muted)' }}>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+Z</kbd> {t('common.undo')}</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+Y</kbd> {t('common.redo')}</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+K</kbd> {t('sidebar.search')}</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Shift+Click</kbd> {t('right.shiftAdd')}</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+H</kbd> {t('history.title')}</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+P</kbd> {t('presets.title')}</div>
        </div>

        <button onClick={onClose} className="btn w-full">{t('common.close')}</button>
      </div>
    </div>
  )
}
export default SettingsModal