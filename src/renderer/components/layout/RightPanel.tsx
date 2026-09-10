// 魔导书 Grimoire v7 — 右侧面板（历史/预设/图片）
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Bot, Clock3, Folder, FolderOpen, Images, LoaderCircle, Settings } from 'lucide-react'
import { PresetsPanel } from '../presets/PresetsPanel'
import { HistoryPanel } from '../history/HistoryPanel'
import { ImagesPanel } from '../images/ImagesPanel'
import { QuickUtilityPopover, type UtilityPopoverKey } from './QuickUtilityPopover'
import { Button } from '../ui/Button'

const SimpleAIPanel = lazy(() => import('../ai/SimpleAIPanel').then(module => ({ default: module.SimpleAIPanel })))
const PromptAssetsPanel = lazy(() => import('../prompt-assets/PromptAssetsPanel').then(module => ({ default: module.PromptAssetsPanel })))

type TabKey = 'assets' | 'presets' | 'history' | 'images' | 'ai'
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

  const tabs = [
    { key: 'assets' as const, icon: FolderOpen, label: '资产' },
    { key: 'presets' as const, icon: Folder, label: '预设' },
    { key: 'history' as const, icon: Clock3, label: '历史' },
    { key: 'images' as const, icon: Images, label: '图片' },
    { key: 'ai' as const, icon: Bot, label: 'AI' },
  ]

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Tab Bar */}
      <div className="ui-toolbar flex px-1" role="tablist" aria-label="工具面板">
        {tabs.map(tab => { const Icon = tab.icon; return (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            role="tab" aria-selected={activeTab === tab.key}
            className={`ui-nav-tab flex flex-1 items-center justify-center gap-1.5 py-2 ${activeTab === tab.key ? 'ui-nav-tab-active' : ''}`}
            title={tab.label}><Icon size={14} aria-hidden="true" /><span>{tab.label}</span></button>
        )})}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto p-[3px]">
        {activeTab === 'assets' && <Suspense fallback={<div className='flex h-full items-center justify-center text-xs text-[var(--color-text-secondary)]'>正在载入资产</div>}><PromptAssetsPanel /></Suspense>}
        {activeTab === 'presets' && <PresetsPanel />}
        {activeTab === 'history' && <HistoryPanel />}
        {activeTab === 'images' && <ImagesPanel />}
        {activeTab === 'ai' && <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-text-secondary)]"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />正在载入 AI</div>}><SimpleAIPanel /></Suspense>}
      </div>

      {/* Bottom buttons for Settings & AI */}
      {popover && (
        <div
          ref={popoverRef}
          className="ui-popover-surface ui-utility-popover absolute z-50"
        >
          <QuickUtilityPopover type={popover} />
        </div>
      )}

      <div className="flex shrink-0 gap-2 border-t border-[var(--color-border)] p-3">
        <Button size="sm" icon={Bot} onClick={() => setPopover(popover === 'ai' ? null : 'ai')} variant={popover === 'ai' ? 'primary' : 'secondary'} className="flex-1">AI 助手</Button>
        <Button size="sm" icon={Settings} onClick={() => setPopover(popover === 'settings' ? null : 'settings')} variant={popover === 'settings' ? 'primary' : 'secondary'} className="flex-1">设置</Button>
      </div>
    </div>
  )
}
