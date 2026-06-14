// 魔导书 Grimoire v7 — 设置面板
import React, { useState, useEffect } from 'react'
import { useI18n } from '../../i18n/context'
import { useSettingsStore } from '../../stores/settings.store'

const THEME_LIST = [
  { key: 'neon', zh: '霓虹', preview: '#a855f7' },
  { key: 'clean', zh: '简洁', preview: '#3b82f6' },
  { key: 'gold', zh: '金色', preview: '#f59e0b' },
  { key: 'midnight', zh: '暗夜', preview: '#6366f1' },
  { key: 'sakura', zh: '樱花', preview: '#ec4899' },
  { key: 'forest', zh: '森林', preview: '#22c55e' },
  { key: 'sunset', zh: '日落', preview: '#f97316' },
]

const MODEL_LIST = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
]

export function SettingsPanel() {
  const { t, setLang } = useI18n()
  const { api_key, api_endpoint, api_model, theme, language, custom_accent, setSetting } = useSettingsStore()
  const [localKey, setLocalKey] = useState('')
  const [localEndpoint, setLocalEndpoint] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [localAccent, setLocalAccent] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  
  useEffect(() => {
    setLocalEndpoint(api_endpoint)
    setLocalModel(api_model)
    setLocalAccent(custom_accent)
  }, [api_endpoint, api_model, custom_accent])
  
  const handleSaveKey = async () => {
    await setSetting('api_key', localKey)
    setLocalKey('')
    showToast(t.settings.saveSuccess, 'success')
  }
  
  const handleSaveEndpoint = async () => {
    await setSetting('api_endpoint', localEndpoint)
    showToast(t.settings.saveSuccess, 'success')
  }
  
  const handleSaveModel = async () => {
    await setSetting('api_model', localModel)
    showToast(t.settings.saveSuccess, 'success')
  }
  
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
      
      {/* API Key */}
      <Section title={t.settings.apiKey}>
        <div className="flex gap-2">
          <input
            type={keyVisible ? 'text' : 'password'}
            value={localKey}
            onChange={e => setLocalKey(e.target.value)}
            placeholder={t.settings.apiKeyPlaceholder}
            className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={() => setKeyVisible(!keyVisible)}
            className="px-2 text-xs text-[var(--color-text-secondary)]"
          >
            {keyVisible ? '🙈' : '👁'}
          </button>
          <button
            onClick={handleSaveKey}
            className="px-3 py-2 text-xs bg-[var(--color-accent)] text-white rounded-lg"
          >
            {t.app.save}
          </button>
        </div>
        {api_key && !localKey && (
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">
            API Key 已配置 (****{api_key.slice(-4)})
          </div>
        )}
      </Section>
      
      {/* API Endpoint */}
      <Section title={t.settings.apiEndpoint}>
        <div className="flex gap-2">
          <input
            type="text"
            value={localEndpoint}
            onChange={e => setLocalEndpoint(e.target.value)}
            className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button onClick={handleSaveEndpoint} className="px-3 py-2 text-xs bg-[var(--color-accent)] text-white rounded-lg">
            {t.app.save}
          </button>
        </div>
      </Section>
      
      {/* AI Model */}
      <Section title={t.settings.apiModel}>
        <select
          value={localModel}
          onChange={e => { setLocalModel(e.target.value); setSetting('api_model', e.target.value) }}
          className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
        >
          {MODEL_LIST.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value="custom">自定义...</option>
        </select>
        {localModel === 'custom' && (
          <input
            type="text"
            value={localModel}
            onChange={e => setLocalModel(e.target.value)}
            className="w-full mt-2 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-xs"
            placeholder="输入模型名..."
          />
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
