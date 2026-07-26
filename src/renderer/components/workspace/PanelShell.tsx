import React, { useEffect, useRef, useState } from "react"
import type { PanelDefinition, PanelType } from "./panelTypes"
import type { SplitPlacement } from "../../stores/workspace.store"

type AddPanelDirection = "left" | "right" | "up" | "down"

interface PanelShellProps {
  id: string
  type: PanelType
  title: string
  children: React.ReactNode
  className?: string
  showHeader?: boolean
  style?: React.CSSProperties
  panelOptions?: PanelDefinition[]
  panelOptionGroups?: { title: string; types: PanelType[] }[]
  onTypeChange?: (type: PanelType) => void
  onAddPanel?: (type: PanelType, direction: "horizontal" | "vertical", placement: SplitPlacement) => void
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
  panelOptionGroups = [],
  onTypeChange,
  onAddPanel,
  onSplit,
  onMaximize,
  onClose,
  maximized = false,
  closeDisabled = false,
}: PanelShellProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [addMenuOpen])

  const handleAddPanel = (panelType: PanelType, addDirection: AddPanelDirection) => {
    const isHorizontal = addDirection === "left" || addDirection === "right"
    const placement = addDirection === "left" || addDirection === "up" ? "before" : "after"
    onAddPanel?.(panelType, isHorizontal ? "horizontal" : "vertical", placement)
    setAddMenuOpen(false)
  }
  const optionByType = new Map(panelOptions.map(option => [option.type, option]))
  const groupedOptions = panelOptionGroups.length
    ? panelOptionGroups
        .map(group => ({
          title: group.title,
          options: group.types.map(panelType => optionByType.get(panelType)).filter(Boolean) as PanelDefinition[],
        }))
        .filter(group => group.options.length > 0)
    : [{ title: "", options: panelOptions }]

  return (
    <section
      data-panel-id={id}
      data-panel-type={type}
      className={"flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg-primary)] " + className}
      style={style}
    >
      {showHeader && (
        <div className="relative z-40 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] overflow-visible" style={{ height: "var(--panel-header-height)" }}>
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
          <div ref={addMenuRef} className="relative shrink-0">
            <button
              onClick={() => setAddMenuOpen(open => !open)}
              className="rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
              style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
              title="添加面板"
            >
              +
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-2xl">
                {groupedOptions.map(group => (
                  <div key={group.title || "default"} className="py-0.5">
                    {group.title && (
                      <div className="px-3 py-1 text-[10px] font-medium text-[var(--color-text-secondary)]">
                        {group.title}
                      </div>
                    )}
                    {group.options.map(option => (
                      <div key={option.type} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[var(--color-accent)]/10">
                        <button
                          onClick={() => handleAddPanel(option.type, "right")}
                          className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs text-[var(--color-text-primary)] hover:text-[var(--color-accent)]"
                          title={option.description}
                        >
                          {option.title}
                        </button>
                        <button onClick={() => handleAddPanel(option.type, "left")} className="h-6 w-6 shrink-0 rounded text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]" title={`左侧添加${option.title}`}>左</button>
                        <button onClick={() => handleAddPanel(option.type, "right")} className="h-6 w-6 shrink-0 rounded text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]" title={`右侧添加${option.title}`}>右</button>
                        <button onClick={() => handleAddPanel(option.type, "up")} className="h-6 w-6 shrink-0 rounded text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]" title={`上方添加${option.title}`}>上</button>
                        <button onClick={() => handleAddPanel(option.type, "down")} className="h-6 w-6 shrink-0 rounded text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]" title={`下方添加${option.title}`}>下</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
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
