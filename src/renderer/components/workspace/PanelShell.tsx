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
}: PanelShellProps) {
  return (
    <section
      data-panel-id={id}
      data-panel-type={type}
      className={"min-h-0 min-w-0 flex flex-col bg-[var(--color-bg-primary)] " + className}
      style={style}
    >
      {showHeader && (
        <div className="h-8 shrink-0 flex items-center gap-2 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
          <select
            value={type}
            onChange={e => onTypeChange?.(e.target.value as PanelType)}
            className="min-w-0 max-w-[180px] bg-transparent text-xs font-medium text-[var(--color-text-primary)] outline-none hover:text-[var(--color-accent)]"
            title={title}
          >
            {panelOptions.map(option => (
              <option key={option.type} value={option.type}>
                {option.title}
              </option>
            ))}
          </select>
          <div className="flex-1 min-w-0" />
          <button
            onClick={() => onSplit?.("horizontal")}
            className="w-6 h-6 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="左右分割"
          >
            ↔
          </button>
          <button
            onClick={() => onSplit?.("vertical")}
            className="w-6 h-6 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="上下分割"
          >
            ↕
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {children}
      </div>
    </section>
  )
}
