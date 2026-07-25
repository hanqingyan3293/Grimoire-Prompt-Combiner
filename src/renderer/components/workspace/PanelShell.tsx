import React from "react"
import type { PanelType } from "./panelTypes"

interface PanelShellProps {
  id: string
  type: PanelType
  title: string
  children: React.ReactNode
  className?: string
  showHeader?: boolean
  style?: React.CSSProperties
}

export function PanelShell({
  id,
  type,
  title,
  children,
  className = "",
  showHeader = false,
  style,
}: PanelShellProps) {
  return (
    <section
      data-panel-id={id}
      data-panel-type={type}
      className={"min-h-0 min-w-0 flex flex-col bg-[var(--color-bg-primary)] " + className}
      style={style}
    >
      {showHeader && (
        <div className="h-8 shrink-0 flex items-center justify-between px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{title}</span>
          <button
            className="w-6 h-6 rounded text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="Panel menu"
          >
            v
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {children}
      </div>
    </section>
  )
}
