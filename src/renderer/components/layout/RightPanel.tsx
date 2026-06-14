// 魔导书 Grimoire v7 — 右侧面板（历史/预设/图片）
import React, { useState } from 'react'
import { PresetsPanel } from '../presets/PresetsPanel'
import { HistoryPanel } from '../history/HistoryPanel'
import { ImagesPanel } from '../images/ImagesPanel'
import { SimpleAIPanel } from '../ai/SimpleAIPanel'

type TabKey = 'presets' | 'history' | 'images' | 'ai'

export function RightPanel({ onOpenSettings, onOpenAI }: {
  onOpenSettings: () => void; onOpenAI: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('presets')

  const tabs: { key: TabKey; icon: string; label: string }[] = [
    { key: 'presets', icon: '📁', label: '预设' },
    { key: 'history', icon: '🕐', label: '历史' },
    { key: 'images', icon: '🖼', label: '图片' },
    { key: 'ai', icon: '🤖', label: 'AI' },
  ]

  return (
    <div className="flex flex-col w-[320px] min-w-[320px] border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Tab Bar */}
      <div className="flex border-b border-[var(--color-border)]">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => handleTabSwitch(tab.key)}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
            title={tab.label}>{tab.icon}</button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'presets' && <PresetsPanel />}
        {activeTab === 'history' && <HistoryPanel />}
        {activeTab === 'images' && <ImagesPanel />}
        {activeTab === 'ai' && <SimpleAIPanel />}
      </div>

      {/* Bottom buttons for Settings & AI */}
      <div className="border-t border-[var(--color-border)] p-2 flex gap-2">
        <button onClick={() => window.api.window.openAI()}
          className="flex-1 py-1.5 text-xs rounded-lg border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors">
          🤖 AI 助手
        </button>
        <button onClick={() => window.api.window.openSettings()}
          className="flex-1 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10 transition-colors">
          ⚙ 设置
        </button>
      </div>
    </div>
  )
}
