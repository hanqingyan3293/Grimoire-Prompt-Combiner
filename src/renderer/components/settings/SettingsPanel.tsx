// 魔导书 Grimoire v7 — 设置面板
import React, { useState, useEffect } from 'react'
import { useI18n } from '../../i18n/context'
import { useSettingsStore } from '../../stores/settings.store'
import { useProviderStore } from '../../stores/providers.store'

const THEME_LIST = [
  { key: 'neon', zh: '霓虹', preview: '#a855f7' },
  { key: 'clean', zh: '简洁', preview: '#3b82f6' },
  { key: 'gold', zh: '金色', preview: '#f59e0b' },
  { key: 'midnight', zh: '暗夜', preview: '#6366f1' },
  { key: 'sakura', zh: '樱花', preview: '#ec4899' },
  { key: 'forest', zh: '森林', preview: '#22c55e' },
  { key: 'sunset', zh: '日落', preview: '#f97316' },
]

export function SettingsPanel() {
  const { t, setLang } = useI18n()
  const { theme, language, custom_accent, setSetting } = useSettingsStore()
  const { providers, activeProvider, setActive } = useProviderStore()
  const [localAccent, setLocalAccent] = useState('')
  
  useEffect(() => {
    setLocalAccent(custom_accent)
  }, [custom_accent])
  
  const handleThemeChange = async (newTheme: string) => {
    await setSetting('theme', newTheme)
  }
  
  const handleLangChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value as 'zh' | 'en'
    await setSetting('language', newLang)
    setLang(newLang)
  }
  
  const handleAccentSave = async () => {
    await setSetting('custom_accent', localAccent)
    document.documentElement.style.setProperty('--color-accent', localAccent)
    showToast(t.settings.saveSuccess, 'success')
  }
  
  const handleExportDb = async () => {
    const ok = await window.api.db.export()
    if (ok) showToast(t.actions.dbExported, 'success')
  }
  
  const handleImportDb = async () => {
    const ok = await window.api.db.import()
    if (ok) showToast(t.actions.dbImported, 'success')
  }
  
  return (
    <div className="p-3 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 100px)' }}>
      
      {/* Provider / API 供应商 */}
      <Section title="API 供应商">
        {providers.length === 0 ? (
          <div className="text-xs text-[var(--color-text-secondary)] py-2">
            尚未配置，请在设置窗口中添加
          </div>
        ) : (
          <div className="space-y-1">
            {providers.map(p => (
              <button key={p.id} onClick={() => setActive(p.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  p.is_active
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30"
                    : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40"
                }`}>
                <div className="font-medium">{p.name}</div>
                <div className="text-[10px] opacity-70 truncate">{p.base_url}</div>
              </button>
            ))}
          </div>
        )}
      </Section>
      
      {/* Theme */}
      <Section title={t.settings.theme}>
        <div className="grid grid-cols-4 gap-2">
          {THEME_LIST.map(tm => (
            <button
              key={tm.key}
              onClick={() => handleThemeChange(tm.key)}
              className={`py-2 text-xs rounded-lg border transition-colors ${
                theme === tm.key
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50'
              }`}
            >
              <div className="w-4 h-4 rounded-full mx-auto mb-1" style={{ backgroundColor: tm.preview }} />
              {tm.zh}
            </button>
          ))}
        </div>
      </Section>
      
      {/* Custom Accent */}
      <Section title={t.settings.customAccent}>
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={localAccent}
            onChange={e => setLocalAccent(e.target.value)}
            className="w-10 h-8 rounded border border-[var(--color-border)] cursor-pointer"
          />
          <input
            type="text"
            value={localAccent}
            onChange={e => setLocalAccent(e.target.value)}
            className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-xs"
          />
          <button onClick={handleAccentSave} className="px-3 py-2 text-xs bg-[var(--color-accent)] text-white rounded-lg">
            {t.app.save}
          </button>
        </div>
      </Section>
      
      {/* Language */}
      <Section title={t.settings.language}>
        <select
          value={language}
          onChange={handleLangChange}
          className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)]"
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </Section>
      
      {/* Data Management */}
      <Section title={t.settings.importExport}>
        <div className="flex gap-2">
          <button onClick={handleExportDb} className="flex-1 py-2 text-xs border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-accent)]/10 transition-colors">
            📤 {t.settings.exportDb}
          </button>
          <button onClick={handleImportDb} className="flex-1 py-2 text-xs border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-accent)]/10 transition-colors">
            📥 {t.settings.importDb}
          </button>
        </div>
      </Section>
      
      {/* About */}
      <Section title={t.settings.about}>
        <div className="text-xs text-[var(--color-text-secondary)] space-y-1">
          <div>Grimoire v7.0.0</div>
          <div>GPL-3.0 License</div>
          <div>Electron + React + TypeScript + Tailwind CSS</div>
          <a
            href="https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner"
            className="text-[var(--color-accent)] hover:underline"
            onClick={e => { e.preventDefault(); window.open('https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner', '_blank') }}
          >
            GitHub
          </a>
        </div>
      </Section>
      
      {/* Spacer for safe scrolling */}
      <div className="h-8" />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">{title}</div>
      {children}
    </div>
  )
}

function showToast(message: string, type: 'success' | 'error' | 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}
