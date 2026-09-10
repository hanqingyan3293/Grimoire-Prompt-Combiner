import React, { Suspense, lazy } from "react"
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { useSettingsStore } from "../../stores/settings.store"
import { Button } from '../ui/Button'

const SimpleAIPanel = lazy(() => import('../ai/SimpleAIPanel').then(module => ({ default: module.SimpleAIPanel })))

export type UtilityPopoverKey = "ai" | "settings"

const THEMES = [
  { key: "neon", label: "霓虹", color: "#a855f7" },
  { key: "clean", label: "简洁", color: "#3b82f6" },
  { key: "gold", label: "金色", color: "#f59e0b" },
  { key: "midnight", label: "暗夜", color: "#6366f1" },
  { key: "sakura", label: "樱花", color: "#ec4899" },
  { key: "forest", label: "森林", color: "#22c55e" },
  { key: "sunset", label: "日落", color: "#f97316" },
]

export function QuickUtilityPopover({ type }: { type: UtilityPopoverKey }) {
  return type === "settings" ? <QuickSettingsPanel variant="popover" /> : <QuickAIPanel variant="popover" />
}

export function QuickAIPanel({ variant = "popover" }: { variant?: "popover" | "embedded" }) {
  const containerClassName = variant === "embedded"
    ? "flex h-full min-h-0 flex-col"
    : "flex h-[min(560px,calc(100vh-128px))] min-h-[360px] flex-col"

  return (
    <div className={`${containerClassName} ui-utility-panel`}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">AI 助手</span>
        <Button size="sm" icon={ExternalLink} onClick={() => window.api.window.openAI()}>独立窗口</Button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-text-secondary)]"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />正在载入 AI</div>}><SimpleAIPanel /></Suspense>
      </div>
    </div>
  )
}

export function QuickSettingsPanel({ variant = "popover" }: { variant?: "popover" | "embedded" }) {
  const { theme, appearance_mode, ui_scale, ui_density, setSetting, setThemePreference } = useSettingsStore()
  const panelClassName = variant === "embedded"
    ? "h-full overflow-y-auto p-4"
    : "max-h-full overflow-y-auto p-4"

  return (
    <div className={panelClassName}>
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-1 pb-3.5">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">快捷设置</span>
        <Button size="sm" icon={ExternalLink} onClick={() => window.api.window.openSettings()}>完整设置</Button>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">外观模式</div>
          <div className="grid grid-cols-3 gap-2">
            {[["system", "系统"], ["light", "浅色"], ["dark", "深色"]].map(([value, label]) => (
              <button key={value} onClick={() => setSetting("appearance_mode", value)} className={"rounded border px-2 py-2 text-xs transition-colors " + (appearance_mode === value ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">主题</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {THEMES.map(item => (
              <button
                key={item.key}
                onClick={() => void setThemePreference(item.key, item.color)}
                className={"flex items-center gap-2 rounded border px-3 py-2 text-xs transition-colors " + (theme === item.key ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]" : "border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-accent)]/50")}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--color-text-secondary)]">字体大小</span>
            <span className="text-[var(--color-accent-text)]">{ui_scale}px</span>
          </div>
          <input
            type="range"
            draggable={false}
            min="12"
            max="20"
            step="1"
            value={ui_scale}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onDragStart={e => e.preventDefault()}
            onChange={e => setSetting("ui_scale", e.target.value)}
            className="w-full cursor-pointer accent-[var(--color-accent)]"
          />
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">界面密度</div>
          <div className="flex gap-2">
            {[
              ["compact", "紧凑"],
              ["normal", "标准"],
              ["comfortable", "舒适"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setSetting("ui_density", value)}
                className={"flex-1 rounded border px-2 py-2 text-xs transition-colors " + (ui_density === value ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50")}
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
