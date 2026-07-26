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
  onAddPanel?: () => void
  onSplit?: (direction: "horizontal" | "vertical") => void
  onMaximize?: () => void
  onClose?: () => void
  maximized?: boolean
  closeDisabled?: boolean
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
  onAddPanel,
  onSplit,
  onMaximize,
  onClose,
  maximized = false,
  closeDisabled = false,
}: PanelShellProps) {
  return (
    <section
      data-panel-id={id}
      data-panel-type={type}
      className={"flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg-primary)] " + className}
      style={style}
    >
      {showHeader && (
        <div className="shrink-0 flex items-center gap-1 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] overflow-hidden" style={{ height: "var(--panel-header-height)" }}>
          <select
            value={type}
            onChange={e => onTypeChange?.(e.target.value as PanelType)}
            className="min-w-[72px] max-w-[180px] flex-1 bg-transparent text-xs font-medium outline-none hover:text-[var(--color-accent)]"
            style={{ color: "var(--color-text-primary)", backgroundColor: "transparent" }}
            title={title}
          >
            {panelOptions.map(option => (
              <option
                key={option.type}
                value={option.type}
                style={{ color: "var(--color-text-primary)", backgroundColor: "var(--color-bg-tertiary)" }}
              >
                {option.title}
              </option>
            ))}
          </select>
          <button
            onClick={onAddPanel}
            className="shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title="添加工具面板"
          >
            +
          </button>
          <button
            onClick={() => onSplit?.("horizontal")}
            className="shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title="左右分割"
          >
            ↔
          </button>
          <button
            onClick={() => onSplit?.("vertical")}
            className="shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title="上下分割"
          >
            ↕
          </button>
          <button
            onClick={onMaximize}
            className="shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title={maximized ? "还原面板" : "最大化面板"}
          >
            {maximized ? "▣" : "□"}
          </button>
          <button
            onClick={onClose}
            disabled={closeDisabled}
            className="shrink-0 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title={closeDisabled ? "至少保留一个面板" : "关闭面板"}
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
