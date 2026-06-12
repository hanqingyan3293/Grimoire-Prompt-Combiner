import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { useI18n } from '../../i18n/context'
import PanelSection from '../ui/PanelSection'

interface SettingsPanelProps { showToast: (msg: string, type?: string) => void }

const THEMES = [
  { id: 'darkest', name: 'darkest', emoji: '🌙' },
  { id: 'dark', name: 'dark', emoji: '🌑' },
  { id: 'medium-dark', name: 'mediumDark', emoji: '🌒' },
  { id: 'light', name: 'light', emoji: '☀️' },
]

const PRESET_PALETTES = [
  ['#4b9cd3','#5dade2','#85c1e9','#aed6f1','#d6eaf8'],
  ['#7c3aed','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe'],
  ['#ef4444','#f87171','#fca5a5','#fecaca','#fee2e2'],
  ['#22c55e','#4ade80','#86efac','#bbf7d0','#dcfce7'],
  ['#f59e0b','#fbbf24','#fcd34d','#fde68a','#fef3c7'],
  ['#ec4899','#f472b6','#f9a8d4','#fbcfe8','#fce7f3'],
]

const SettingsPanel: React.FC<SettingsPanelProps> = ({ showToast }) => {
  const { t, lang, setLang } = useI18n()
  const {
    theme, setTheme, fontSize, setSetting,
    randomMin, randomMax, customAccent,
  } = useSettingsStore()
  const [localMin, setLocalMin] = useState(String(randomMin || 3))
  const [localMax, setLocalMax] = useState(String(randomMax || 8))
  const [customHex, setCustomHex] = useState(customAccent || '#4b9cd3')
  const [aiProvider, setAiProvider] = useState(useSettingsStore.getState().aiProvider || 'grok')
  const [aiEndpoint, setAiEndpoint] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiModel, setAiModel] = useState(useSettingsStore.getState().aiModel || 'grok-2-vision')
  const [testingAI, setTestingAI] = useState(false)

  // Load saved AI settings
  React.useEffect(() => {
    const s = useSettingsStore.getState()
    setAiEndpoint(s.aiEndpoint || '')
    setAiKey(s.aiApiKey || '')
    setAiModel(s.aiModel || 'grok-2-vision')
    setAiProvider(s.aiProvider || 'grok')
  }, [])

  const handleRandomRange = () => {
    const mn = Math.max(1, parseInt(localMin) || 3)
    const mx = Math.max(mn, parseInt(localMax) || 8)
    setSetting('randomMin', String(mn))
    setSetting('randomMax', String(mx))
    showToast(t('common.save') + ' ✔', 'success')
  }

  const handleAccent = (c: string) => {
    setSetting('customAccent', c)
    setCustomHex(c)
  }

  const handleSaveAI = () => {
    setSetting('aiProvider', aiProvider)
    setSetting('aiEndpoint', aiEndpoint)
    setSetting('aiApiKey', aiKey)
    setSetting('aiModel', aiModel)
    showToast('AI 设置已保存 ✔', 'success')
  }

  const handleTestAI = async () => {
    if (!aiKey || !aiEndpoint) {
      showToast('请先填写 API Key 和端点地址', 'error')
      return
    }
    setTestingAI(true)
    try {
      const resp = await fetch(aiEndpoint + '/models', {
        headers: { 'Authorization': 'Bearer ' + aiKey },
      })
      if (resp.ok) {
        const data = await resp.json()
        showToast('连接成功! 可用模型: ' + (data.data?.length || '?'), 'success')
      } else {
        showToast('连接失败: HTTP ' + resp.status, 'error')
      }
    } catch (e: any) {
      showToast('连接失败: ' + e.message, 'error')
    }
    setTestingAI(false)
  }

  return (
    <div style={{ padding: '4px 0 16px 0' }}>
      {/* Theme */}
      <PanelSection title={t('settings.theme')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 8 }}>
          {THEMES.map(tm => (
            <button key={tm.id} onClick={() => setTheme(tm.id)}
              title={t('theme.' + tm.name)}
              style={{
                padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                border: theme === tm.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: theme === tm.id ? 'var(--color-accent-bg)' : 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)', fontSize: 'var(--font-size-ui)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span>{tm.emoji}</span>
              <span>{t('theme.' + tm.name)}</span>
            </button>
          ))}
        </div>
      </PanelSection>

      {/* Language */}
      <PanelSection title={t('settings.lang')}>
        <div style={{ display: 'flex', gap: 4, padding: 8 }}>
          <button onClick={() => setLang('zh')}
            className={'ps-btn ps-btn--sm flex-1' + (lang === 'zh' ? ' ps-btn--primary' : '')}>
            🇨🇳 中文
          </button>
          <button onClick={() => setLang('en')}
            className={'ps-btn ps-btn--sm flex-1' + (lang === 'en' ? ' ps-btn--primary' : '')}>
            🇺🇸 English
          </button>
        </div>
      </PanelSection>

      {/* Font Size */}
      <PanelSection title={t('settings.fontSize')}>
        <div style={{ display: 'flex', gap: 4, padding: 8, alignItems: 'center' }}>
          {[12, 14, 16].map(s => (
            <button key={s} onClick={() => setSetting('fontSize', String(s))}
              className={'ps-btn ps-btn--sm' + (fontSize === String(s) ? ' ps-btn--primary' : '')}>
              {s}px
            </button>
          ))}
          <input type="number" min="8" max="28" value={fontSize || 14}
            onChange={e => setSetting('fontSize', e.target.value)}
            className="ps-input" style={{ width: 52, textAlign: 'center' }}
            title={t('settings.fontCustom')} />
        </div>
      </PanelSection>

      {/* Random Range */}
      <PanelSection title={t('settings.randomRange')}>
        <div style={{ display: 'flex', gap: 4, padding: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>最小</span>
          <input type="number" min="1" max="20" value={localMin}
            onChange={e => setLocalMin(e.target.value)}
            className="ps-input" style={{ width: 52, textAlign: 'center' }} />
          <span style={{ color: 'var(--color-text-dim)' }}>-</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>最大</span>
          <input type="number" min="1" max="30" value={localMax}
            onChange={e => setLocalMax(e.target.value)}
            className="ps-input" style={{ width: 52, textAlign: 'center' }} />
          <button onClick={handleRandomRange}
            className="ps-btn ps-btn--sm ps-btn--primary">{t('common.save')}</button>
        </div>
      </PanelSection>

      {/* Custom Accent Color */}
      <PanelSection title={t('settings.customColor')}>
        <div style={{ padding: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="color" value={customAccent || '#4b9cd3'}
              onChange={e => handleAccent(e.target.value)}
              style={{
                width: 32, height: 24, padding: 0,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: 'none',
              }} />
            <input type="text" value={customHex}
              onChange={e => {
                setCustomHex(e.target.value)
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) handleAccent(e.target.value)
              }}
              className="ps-input flex-1" />
            <div style={{
              width: 24, height: 24, borderRadius: 'var(--radius-sm)',
              backgroundColor: customAccent || '#4b9cd3',
              border: '1px solid var(--color-border)',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-dim)', marginBottom: 4 }}>
            {t('settings.presetColors')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {PRESET_PALETTES.map((palette, pi) => (
              <div key={pi} style={{ display: 'flex', gap: 2 }}>
                {palette.map((color, ci) => (
                  <button key={ci} onClick={() => handleAccent(color)}
                    style={{
                      width: 28, height: 20, borderRadius: 'var(--radius-sm)',
                      backgroundColor: color,
                      border: customAccent === color
                        ? '2px solid var(--color-text-primary)'
                        : '1px solid var(--color-border)',
                      cursor: 'pointer', transition: 'transform var(--tr-fast)',
                    }}
                    title={color} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </PanelSection>

      {/* AI Settings */}
      <PanelSection title="🤖 AI 识图接口配置" defaultOpen={true}>
        <div style={{ padding: '4px 8px 8px' }}>
          <div style={{
            fontSize: 10, color: 'var(--color-text-dim)',
            marginBottom: 6, lineHeight: 1.5,
          }}>
            配置视觉模型 API 用于图片反推标签。支持 Grok Vision、OpenAI Vision 等兼容接口。
          </div>

          <div className="ps-setting-label" style={{ fontSize: 11, marginBottom: 2 }}>
            AI 提供商
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'grok', name: 'Grok Vision', icon: '🔬' },
              { id: 'openai', name: 'OpenAI', icon: '🤖' },
              { id: 'wd14', name: 'WD14 Tagger', icon: '🧠' },
              { id: 'custom', name: '自定义', icon: '⚙' },
            ].map(p => (
              <button key={p.id} onClick={() => setAiProvider(p.id)}
                className={'ps-btn ps-btn--sm' + (aiProvider === p.id ? ' ps-btn--primary' : '')}>
                {p.icon} {p.name}
              </button>
            ))}
          </div>

          <div className="ps-setting-label" style={{ fontSize: 11, marginBottom: 2 }}>
            端点地址 (Base URL)
          </div>
          <input type="text" value={aiEndpoint}
            onChange={e => setAiEndpoint(e.target.value)}
            className="ps-input w-full" style={{ marginBottom: 8 }}
            placeholder="https://api.nonelinear.com/v1" />

          <div className="ps-setting-label" style={{ fontSize: 11, marginBottom: 2 }}>
            API Key
          </div>
          <input type="password" value={aiKey}
            onChange={e => setAiKey(e.target.value)}
            className="ps-input w-full" style={{ marginBottom: 8 }}
            placeholder="sk-..." />

          <div className="ps-setting-label" style={{ fontSize: 11, marginBottom: 2 }}>
            模型名称
          </div>
          <input type="text" value={aiModel}
            onChange={e => setAiModel(e.target.value)}
            className="ps-input w-full" style={{ marginBottom: 10 }}
            placeholder="grok-2-vision" />

          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={handleSaveAI}
              className="ps-btn ps-btn--primary ps-btn--sm">
              💾 {t('common.save')}
            </button>
            <button onClick={handleTestAI} disabled={testingAI}
              className="ps-btn ps-btn--sm">
              {testingAI ? '⏳ 测试中...' : '🔌 测试连接'}
            </button>
          </div>
        </div>
      </PanelSection>

      {/* Shortcuts */}
      <PanelSection title={t('settings.shortcuts')} defaultOpen={false}>
        <div style={{
          padding: 8, fontSize: 'var(--font-size-ui)',
          color: 'var(--color-text-muted)', lineHeight: 2.2,
        }}>
          <div>
            <kbd style={kbdStyle}>Ctrl+Z</kbd> {t('common.undo')}
          </div>
          <div>
            <kbd style={kbdStyle}>Ctrl+Y</kbd> {t('common.redo')}
          </div>
          <div>
            <kbd style={kbdStyle}>Ctrl+K</kbd> 搜索标签
          </div>
          <div>
            <kbd style={kbdStyle}>Ctrl+S</kbd> 保存快照
          </div>
          <div>
            <kbd style={kbdStyle}>Ctrl+D</kbd> {t('common.dedup')}
          </div>
          <div>
            <kbd style={kbdStyle}>Shift+Click</kbd> {t('right.shiftAdd')}
          </div>
          <div>
            <kbd style={kbdStyle}>左键点击</kbd> {t('tags.addToPositive')} / 取消
          </div>
          <div>
            <kbd style={kbdStyle}>右键点击</kbd> 编辑/收藏/删除
          </div>
        </div>
      </PanelSection>

      {/* About */}
      <PanelSection title="关于" defaultOpen={false}>
        <div style={{
          padding: 8, fontSize: 'var(--font-size-ui)',
          color: 'var(--color-text-secondary)', lineHeight: 1.8,
        }}>
          <div>📖 魔导书 Grimoire v5.3.2</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>
            AI绘画提示词工作站
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>
            技术栈: Electron + React + SQLite
          </div>
        </div>
      </PanelSection>
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  padding: '1px 6px',
  background: 'var(--color-bg-input)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  fontSize: 10,
  fontFamily: 'monospace',
}

export default SettingsPanel
