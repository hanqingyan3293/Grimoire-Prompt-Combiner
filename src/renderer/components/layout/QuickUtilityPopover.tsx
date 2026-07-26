import React from "react"
import { SimpleAIPanel } from "../ai/SimpleAIPanel"
import { useSettingsStore } from "../../stores/settings.store"

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
  return type === "settings" ? <QuickSettingsPanel /> : <QuickAIPanel />
}

function QuickAIPanel() {
  return (
    <div className="flex h-[min(560px,calc(100vh-128px))] min-h-[360px] flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">AI 助手</span>
        <button
          onClick={() => window.api.window.openAI()}
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

function QuickSettingsPanel() {
  const { theme, ui_scale, ui_density, setSetting } = useSettingsStore()

  return (
    <div className="max-h-[min(560px,calc(100vh-128px))] overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">快捷设置</span>
        <button
          onClick={() => window.api.window.openSettings()}
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
                onClick={() => setSetting("theme", item.key)}
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
            onChange={e => setSetting("ui_scale", e.target.value)}
            className="w-full accent-[var(--color-accent)]"
          />
        </div>

        <div>
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
