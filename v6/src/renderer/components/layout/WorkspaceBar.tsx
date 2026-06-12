import React, { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { useSettingsStore } from '../../stores/settings.store'

type WorkspaceMode = 'three-col' | 'two-up-one-down' | 'focus'

interface WorkspaceBarProps {
  workspace: WorkspaceMode
  setWorkspace: (w: WorkspaceMode) => void
  setActiveModal: (m: any) => void
  fontSize: string
}

const WorkspaceBar: React.FC<WorkspaceBarProps> = ({ workspace, setWorkspace, setActiveModal, fontSize }) => {
  const { t, lang, setLang } = useI18n()
  const { setSetting } = useSettingsStore()
  const [showFontInput, setShowFontInput] = useState(false)
  const [customFontVal, setCustomFontVal] = useState(fontSize)

  const wsModes: { id: WorkspaceMode; icon: string }[] = [
    { id: 'three-col', icon: '|||' },
    { id: 'two-up-one-down', icon: '=|' },
    { id: 'focus', icon: '[]' },
  ]

  const fontPresets = [
    { label: t('settings.fontSmall'), value: '12' },
    { label: t('settings.fontMedium'), value: '14' },
    { label: t('settings.fontLarge'), value: '16' },
  ]

  const isPreset = fontPresets.some(f => f.value === fontSize)

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b text-xs flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border)' }}>
      {/* Workspace mode */}
      <div className="flex items-center gap-0.5" title={t('workspace.threeCol')}>
        {wsModes.map(m => (
          <button key={m.id} onClick={() => setWorkspace(m.id)} title={t('workspace.' + m.id)}
            className="px-2 py-1 rounded text-xs transition-all"
            style={{ backgroundColor: workspace===m.id ? 'var(--color-tag-bg)' : 'transparent', color: workspace===m.id ? 'var(--color-accent)' : 'var(--color-text-muted)', border: workspace===m.id ? '1px solid var(--color-accent)' : '1px solid transparent' }}>
            {m.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-4" style={{ backgroundColor: 'var(--color-border)' }} />

      {/* Language */}
      <button onClick={() => setLang(lang==='zh'?'en':'zh')} title={t('settings.lang') + ' / Switch Language'}
        className="px-2 py-1 rounded text-xs hover:opacity-80"
        style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
        {lang==='zh' ? '&#20013;' : 'EN'}
      </button>

      {/* Font size */}
      <div className="flex items-center gap-0.5">
        <select value={isPreset ? fontSize : '__custom'} onChange={e => {
          if (e.target.value === '__custom') { setShowFontInput(true); return }
          setSetting('fontSize', e.target.value); setShowFontInput(false)
        }} title={t('settings.fontSize')}
          className="px-1 py-1 rounded text-xs"
          style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          {fontPresets.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          {!isPreset && <option value={fontSize}>{fontSize}px</option>}
          <option value="__custom">{t('settings.fontCustom')}...</option>
        </select>
        {showFontInput && (
          <div className="flex items-center gap-0.5">
            <input type="number" min="8" max="28" value={customFontVal} onChange={e => { setCustomFontVal(e.target.value); setSetting('fontSize', e.target.value) }}
              className="w-12 px-1 py-1 rounded text-xs text-center"
              style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
              title={t('settings.fontCustom')} />
            <button onClick={() => setShowFontInput(false)} title={t('common.cancel')}
              className="text-xs px-1" style={{ color: 'var(--color-text-muted)' }}>&#10005;</button>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Title */}
      <span className="text-xs font-medium select-none" style={{ color: 'var(--color-accent)' }}>{t('app.title')}</span>

      <div className="flex-1" />

      {/* Quick actions */}
      <button onClick={() => setActiveModal('settings')} title={t('right.settings')}
        className="px-2 py-1 rounded text-xs hover:opacity-80"
        style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>&#9881;</button>
    </div>
  )
}

export default WorkspaceBar