// 魔导书 Grimoire v7 — 右侧面板（历史/预设/图片）
import React, { useEffect, useRef, useState } from 'react'
import { PresetsPanel } from '../presets/PresetsPanel'
import { HistoryPanel } from '../history/HistoryPanel'
import { ImagesPanel } from '../images/ImagesPanel'
import { SimpleAIPanel } from '../ai/SimpleAIPanel'
import { useSettingsStore } from '../../stores/settings.store'

type TabKey = 'presets' | 'history' | 'images' | 'ai'
type PopoverKey = 'ai' | 'settings' | null

const THEMES = [
  { key: 'neon', label: '霓虹', color: '#a855f7' },
  { key: 'clean', label: '简洁', color: '#3b82f6' },
  { key: 'gold', label: '金色', color: '#f59e0b' },
  { key: 'midnight', label: '暗夜', color: '#6366f1' },
  { key: 'sakura', label: '樱花', color: '#ec4899' },
  { key: 'forest', label: '森林', color: '#22c55e' },
  { key: 'sunset', label: '日落', color: '#f97316' },
]

export function RightPanel() {
  const [activeTab, setActiveTab] = useState<TabKey>('presets')
  const [popover, setPopover] = useState<PopoverKey>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Auto-refresh when switching to AI tab
  useEffect(() => {
    if (activeTab === 'ai') {
      window.dispatchEvent(new CustomEvent('grimoire:refresh'))
    }
  }, [activeTab])

  useEffect(() => {
    if (!popover) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setPopover(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [popover])

  const tabs: { key: TabKey; icon: string; label: string }[] = [
    { key: 'presets', icon: '📁', label: '预设' },
    { key: 'history', icon: '🕐', label: '历史' },
    { key: 'images', icon: '🖼', label: '图片' },
    { key: 'ai', icon: '🤖', label: 'AI' },
  ]

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Tab Bar */}
      <div className="flex border-b border-[var(--color-border)]">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
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
      {popover && (
        <div
          ref={popoverRef}
          className="absolute bottom-12 right-2 z-50 w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl"
        >
          {popover === 'settings' ? (
            <QuickSettingsPanel onOpenFull={() => window.api.window.openSettings()} />
          ) : (
            <QuickAIPanel onOpenFull={() => window.api.window.openAI()} />
          )}
        </div>
      )}

      <div className="border-t border-[var(--color-border)] p-2 flex gap-2">
        <button onClick={() => setPopover(popover === 'ai' ? null : 'ai')}
          className={"flex-1 py-1.5 text-xs rounded-lg border transition-colors " + (popover === 'ai' ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10")}>
          🤖 AI 助手
        </button>
        <button onClick={() => setPopover(popover === 'settings' ? null : 'settings')}
          className={"flex-1 py-1.5 text-xs rounded-lg border transition-colors " + (popover === 'settings' ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10")}>
          ⚙ 设置
        </button>
      </div>
    </div>
  )
}

function QuickAIPanel({ onOpenFull }: { onOpenFull: () => void }) {
  return (
    <div className="flex h-[min(560px,calc(100vh-128px))] min-h-[360px] flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">AI 助手</span>
        <button
          onClick={onOpenFull}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          独立窗口
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <SimpleAIPanel />
      </div>
    </div>
  )
}

function QuickSettingsPanel({ onOpenFull }: { onOpenFull: () => void }) {
  const { theme, ui_scale, ui_density, setSetting } = useSettingsStore()

  return (
    <div className="max-h-[min(560px,calc(100vh-128px))] overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">快捷设置</span>
        <button
          onClick={onOpenFull}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          完整设置
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">主题</div>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map(item => (
              <button
                key={item.key}
                onClick={() => setSetting('theme', item.key)}
                className={"flex items-center gap-2 rounded border px-3 py-2 text-xs transition-colors " + (theme === item.key ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-accent)]/50")}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--color-text-secondary)]">字体大小</span>
            <span className="text-[var(--color-accent)]">{ui_scale}px</span>
          </div>
          <input
            type="range"
            min="12"
            max="20"
            step="1"
            value={ui_scale}
            onChange={e => setSetting('ui_scale', e.target.value)}
            className="w-full accent-[var(--color-accent)]"
          />
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">界面密度</div>
          <div className="flex gap-2">
            {[
              ['compact', '紧凑'],
              ['normal', '标准'],
              ['comfortable', '舒适'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setSetting('ui_density', value)}
                className={"flex-1 rounded border px-2 py-2 text-xs transition-colors " + (ui_density === value ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
