// 魔导书 Grimoire v7 — 右侧面板（历史/预设/图片）
import React, { useEffect, useRef, useState } from 'react'
import { PresetsPanel } from '../presets/PresetsPanel'
import { HistoryPanel } from '../history/HistoryPanel'
import { ImagesPanel } from '../images/ImagesPanel'
import { SimpleAIPanel } from '../ai/SimpleAIPanel'
import { QuickUtilityPopover, type UtilityPopoverKey } from './QuickUtilityPopover'

type TabKey = 'presets' | 'history' | 'images' | 'ai'
type PopoverKey = UtilityPopoverKey | null

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [popover])

  useEffect(() => {
    if (popover === 'ai') window.dispatchEvent(new CustomEvent('grimoire:refresh'))
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
      <div className="ui-toolbar flex">
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
          className="ui-popover-surface absolute bottom-12 right-2 z-50 w-[min(420px,calc(100vw-32px))]"
        >
          <QuickUtilityPopover type={popover} />
        </div>
      )}

      <div className="flex gap-2 border-t border-[var(--color-border)] p-2">
        <button onClick={() => setPopover(popover === 'ai' ? null : 'ai')}
          className={"flex-1 py-1.5 text-xs " + (popover === 'ai' ? "rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "ui-subtle-button")}>
          🤖 AI 助手
        </button>
        <button onClick={() => setPopover(popover === 'settings' ? null : 'settings')}
          className={"flex-1 py-1.5 text-xs " + (popover === 'settings' ? "rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "ui-subtle-button")}>
          ⚙ 设置
        </button>
      </div>
    </div>
  )
}
