import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'

const THEMES = [
  { id: 'neon', name: '霓虹紫', emoji: '🟣' },
  { id: 'clean', name: '简洁蓝', emoji: '🔵' },
  { id: 'gold', name: '古典金', emoji: '🟡' },
  { id: 'midnight', name: '午夜蓝', emoji: '🌙' },
  { id: 'sakura', name: '樱花粉', emoji: '🌸' },
  { id: 'forest', name: '森林绿', emoji: '🌲' },
  { id: 'sunset', name: '日落橙', emoji: '🌅' }
]

interface SettingsModalProps {
  onClose: () => void
  showToast: (msg: string, type?: string) => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, showToast }) => {
  const { theme, setTheme, aiProvider, aiApiKey, aiModel, setSetting } = useSettingsStore()
  const [localKey, setLocalKey] = useState(aiApiKey || '')
  const [localModel, setLocalModel] = useState(aiModel || 'gpt-4o')
  const [localProvider, setLocalProvider] = useState(aiProvider || 'openai')

  const handleSaveAI = async () => {
    await setSetting('aiProvider', localProvider)
    await setSetting('aiModel', localModel)
    // API Key is stored securely - in production, use safeStorage
    await setSetting('aiApiKey', localKey ? '***configured***' : '')
    showToast('AI 设置已保存 (接口预留)', 'success')
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-lg mx-4 p-6 rounded-xl max-h-[80vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-accent)' }}>⚙️ 设置</h2>

        {/* Theme */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>主题配色</h3>
        <div className="grid grid-cols-4 gap-2 mb-6">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className="p-3 rounded-lg text-center text-sm transition-all"
              style={{
                backgroundColor: theme === t.id ? 'var(--color-tag-bg)' : 'var(--color-bg-primary)',
                border: theme === t.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                color: 'var(--color-text-primary)'
              }}
            >
              <div className="text-xl mb-1">{t.emoji}</div>
              {t.name}
            </button>
          ))}
        </div>

        {/* AI Settings */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          🤖 AI 识图接口（预留）
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          配置视觉模型 API 以启用图片标签自动识别功能（功能开发中）
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>AI 提供商</label>
            <select
              value={localProvider}
              onChange={e => setLocalProvider(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            >
              <option value="openai">OpenAI (GPT-4V)</option>
              <option value="claude">Anthropic (Claude Vision)</option>
              <option value="custom">自定义 API</option>
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>API Key</label>
            <input
              type="password"
              value={localKey}
              onChange={e => setLocalKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>模型</label>
            <input
              type="text"
              value={localModel}
              onChange={e => setLocalModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <button onClick={handleSaveAI} className="btn btn-primary w-full">保存 AI 设置</button>
        </div>

        {/* Shortcuts Reference */}
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>键盘快捷键</h3>
        <div className="text-xs space-y-1 mb-4" style={{ color: 'var(--color-text-muted)' }}>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+Z</kbd> 撤销</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+Y</kbd> 重做</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+K</kbd> 搜索标签</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Shift+点击</kbd> 添加负面标签</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+H</kbd> 历史</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+P</kbd> 预设</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Ctrl+,</kbd> 设置</div>
          <div><kbd className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>Esc</kbd> 清除搜索</div>
        </div>

        <button onClick={onClose} className="btn w-full">关闭</button>
      </div>
    </div>
  )
}

export default SettingsModal
