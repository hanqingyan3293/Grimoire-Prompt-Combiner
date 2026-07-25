import React from "react"
import type { PanelDefinition, PanelType } from "./panelTypes"

interface PanelShellProps {
  id: string
  type: PanelType
  title: string
  children: React.ReactNode
  className?: string
  showHeader?: boolean
  style?: React.CSSProperties
  panelOptions?: PanelDefinition[]
  onTypeChange?: (type: PanelType) => void
  onSplit?: (direction: "horizontal" | "vertical") => void
  onMaximize?: () => void
  onClose?: () => void
  maximized?: boolean
}

export function PanelShell({
  id,
  type,
  title,
  children,
  className = "",
  showHeader = false,
  style,
  panelOptions = [],
  onTypeChange,
  onSplit,
  onMaximize,
  onClose,
  maximized = false,
}: PanelShellProps) {
  return (
    <section
      data-panel-id={id}
      data-panel-type={type}
      className={"flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg-primary)] " + className}
      style={style}
    >
      {showHeader && (
        <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] overflow-hidden">
          <select
            value={type}
            onChange={e => onTypeChange?.(e.target.value as PanelType)}
            className="min-w-[72px] max-w-[180px] flex-1 bg-transparent text-xs font-medium text-[var(--color-text-primary)] outline-none hover:text-[var(--color-accent)]"
            title={title}
          >
            {panelOptions.map(option => (
              <option key={option.type} value={option.type}>
                {option.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSplit?.("horizontal")}
            className="w-6 h-6 shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="左右分割"
          >
            ↔
          </button>
          <button
            onClick={() => onSplit?.("vertical")}
            className="w-6 h-6 shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="上下分割"
          >
            ↕
          </button>
          <button
            onClick={onMaximize}
            className="w-6 h-6 shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title={maximized ? "还原面板" : "最大化面板"}
          >
            {maximized ? "▣" : "□"}
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-red-400 hover:bg-red-500/10"
            title="关闭面板"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 min-w-0 overflow-auto">
        {children}
      </div>
    </section>
  )
}
