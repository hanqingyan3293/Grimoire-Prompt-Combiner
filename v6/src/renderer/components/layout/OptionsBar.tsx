import React, { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { useSettingsStore } from '../../stores/settings.store'

type WorkspaceMode = 'default' | 'compact' | 'wide-canvas'

interface OptionsBarProps {
  workspace: WorkspaceMode
  setWorkspace: (w: WorkspaceMode) => void
  rightPanelCollapsed: boolean
  onToggleRightPanel: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSettings?: () => void
}

const OptionsBar: React.FC<OptionsBarProps> = ({
  workspace, setWorkspace,
  rightPanelCollapsed, onToggleRightPanel,
  sidebarCollapsed, onToggleSidebar,
  onOpenSettings,
}) => {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme, fontSize, setSetting } = useSettingsStore()
  const [showFontInput, setShowFontInput] = useState(false)
  const [showWsMenu, setShowWsMenu] = useState(false)

  const wsModes: { id: WorkspaceMode; icon: string; label: string }[] = [
    { id: 'default', icon: '≡', label: t('workspace.default') },
    { id: 'compact', icon: '▣', label: t('workspace.compact') },
    { id: 'wide-canvas', icon: '▢', label: t('workspace.wideCanvas') },
  ]

  const themes = [
    { id: 'darkest', emoji: '🌙' },
    { id: 'dark', emoji: '🌑' },
    { id: 'medium-dark', emoji: '🌒' },
    { id: 'light', emoji: '☀' },
  ]

  return (
    <div className="ps-optionsbar" style={{ position: 'relative' }}>
      {/* Sidebar toggle */}
      <button onClick={onToggleSidebar} className="ps-icon-btn"
        title={sidebarCollapsed ? t('panel.expand') + ' ' + t('sidebar.categories') : t('panel.collapse') + ' ' + t('sidebar.categories')}>
        {sidebarCollapsed ? '◀' : '▶'}
      </button>

      <div className="ps-optionsbar__sep" />

      {/* Workspace */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowWsMenu(!showWsMenu)}
          title={t('optionsBar.workspace')}
          className="ps-btn ps-btn--sm" style={{ gap: 2 }}>
          <span>{wsModes.find(w => w.id === workspace)?.icon || '≡'}</span>
          <span style={{ fontSize: 10 }}>▾</span>
        </button>
        {showWsMenu && (
          <div className="ps-dropdown" style={{ top: '100%', left: 0, marginTop: 4 }}
            onClick={() => setShowWsMenu(false)}>
            {wsModes.map(w => (
              <div key={w.id} className="ps-dropdown__item"
                onClick={() => setWorkspace(w.id)}
                style={{ color: workspace === w.id ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                <span>{w.icon}</span><span>{w.label}</span>
              </div>
            ))}
            <div className="ps-dropdown__divider" />
            <div className="ps-dropdown__item"
              onClick={() => {
                alert(t('optionsBar.saveWorkspace') + ': ' + (wsModes.find(w=>w.id===workspace)?.label||workspace))
              }}
              style={{ color: 'var(--color-text-secondary)' }}>
              <span>💾</span><span>{t('optionsBar.saveWorkspace')}</span>
            </div>
          </div>
        )}
      </div>

      <div className="ps-optionsbar__sep" />

      {/* Language */}
      <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        title={t('settings.lang')} className="ps-btn ps-btn--sm">
        {lang === 'zh' ? '🇨🇳' : '🇺🇸'} {lang === 'zh' ? '中文' : 'English'}
      </button>

      <div className="ps-optionsbar__sep" />

      {/* Font Size */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <select value={fontSize || '14'} onChange={e => {
          const v = e.target.value;
          if (v === 'custom') setShowFontInput(true);
          else setSetting('fontSize', v)
        }}
          style={{
            height: 22, padding: '0 4px', fontSize: 10,
            background: 'var(--color-bg-input)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            borderRadius: 'var(--radius-sm)',
          }}>
          <option value="12">12px</option>
          <option value="14">14px</option>
          <option value="16">16px</option>
          {!['12','14','16'].includes(fontSize || '14') && <option value={fontSize}>{fontSize}px</option>}
          <option value="custom">{t('settings.fontCustom')}...</option>
        </select>
        {showFontInput && (
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input type="number" min="8" max="28" value={fontSize || 14}
              onChange={e => setSetting('fontSize', e.target.value)}
              className="ps-input" style={{ width: 44, textAlign: 'center', height: 22 }} />
            <button onClick={() => setShowFontInput(false)} className="ps-icon-btn"
              title={t('common.cancel')}>×</button>
          </div>
        )}
      </div>

      <div className="ps-optionsbar__sep" />

      {/* Theme */}
      <div style={{ display: 'flex', gap: 1 }}>
        {themes.map(tm => (
          <button key={tm.id} onClick={() => setTheme(tm.id)}
            title={t('theme.' + tm.id)}
            className={'ps-icon-btn' + (theme === tm.id ? ' ps-icon-btn--active' : '')}
            style={{ fontSize: 13 }}>{tm.emoji}</button>
        ))}
      </div>

      <div className="ps-optionsbar__sep" />

      {/* Settings button */}
      {onOpenSettings && (
        <button onClick={onOpenSettings} className="ps-icon-btn"
          title={t('right.settings')} style={{ fontWeight: 600 }}>
          ⚙
        </button>
      )}

      <div style={{ flex: 1 }} />

      {/* Title */}
      <span style={{ fontSize: 10, color: 'var(--color-text-dim)', userSelect: 'none' }}>
        魔导书 Grimoire v5.3.2
      </span>
    </div>
  )
}

export default OptionsBar
