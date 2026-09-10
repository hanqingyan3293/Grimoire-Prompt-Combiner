import React, { useEffect, useRef, useState } from "react"
import type { PanelDefinition, PanelType } from "./panelTypes"
import type { SplitPlacement } from "../../stores/workspace.store"

type AddPanelDirection = "left" | "right" | "up" | "down"
type CornerPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right"
export type CornerMergeSide = "left" | "right" | "up" | "down"
type CornerDragPreview = {
  direction: "horizontal" | "vertical"
  placement: SplitPlacement
  ratio: number
} | null
type MergePreviewRect = {
  left: number
  top: number
  width: number
  height: number
} | null

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
  onAddPanel?: (type: PanelType, direction: "horizontal" | "vertical", placement: SplitPlacement, ratio?: number) => void
  onCornerMergePreview?: (panelId: string, side: CornerMergeSide | null) => void
  onCornerMergeDrop?: (panelId: string, side: CornerMergeSide) => boolean
  onSplit?: (direction: "horizontal" | "vertical") => void
  onMaximize?: () => void
  onClose?: () => void
  maximized?: boolean
  closeDisabled?: boolean
  mergeHighlighted?: boolean
  mergePreviewRect?: MergePreviewRect
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
  onCornerMergePreview,
  onCornerMergeDrop,
  onSplit,
  onMaximize,
  onClose,
  maximized = false,
  closeDisabled = false,
  mergeHighlighted = false,
  mergePreviewRect = null,
}: PanelShellProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuPosition, setAddMenuPosition] = useState({ left: 8, top: 8 })
  const [cornerDragPreview, setCornerDragPreview] = useState<CornerDragPreview>(null)
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
    onAddPanel?.(panelType, isHorizontal ? "horizontal" : "vertical", placement, 0.5)
    setAddMenuOpen(false)
  }
  const startCornerDrag = (corner: CornerPosition, event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const handleElement = event.currentTarget
    handleElement.setPointerCapture?.(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const panelRect = (event.currentTarget.closest("[data-panel-id]") as HTMLElement | null)?.getBoundingClientRect()
    let latestPreview: CornerDragPreview = null
    let latestMergeSide: CornerMergeSide | null = null

    const updatePreview = (clientX: number, clientY: number) => {
      const dx = clientX - startX
      const dy = clientY - startY
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      if (Math.max(absX, absY) < 28) {
        latestPreview = null
        latestMergeSide = null
        setCornerDragPreview(null)
        onCornerMergePreview?.(id, null)
        return
      }
      if (absX >= absY) {
        const rawRatio = panelRect ? (clientX - panelRect.left) / panelRect.width : 0.5
        const ratio = Math.min(0.88, Math.max(0.12, rawRatio))
        latestPreview = {
          direction: "horizontal",
          placement: dx < 0 ? "before" : "after",
          ratio,
        }
      } else {
        const rawRatio = panelRect ? (clientY - panelRect.top) / panelRect.height : 0.5
        const ratio = Math.min(0.88, Math.max(0.12, rawRatio))
        latestPreview = {
          direction: "vertical",
          placement: dy < 0 ? "before" : "after",
          ratio,
        }
      }
      if (panelRect) {
        const outsideSide = getOutsidePanelSide(panelRect, clientX, clientY)
        latestMergeSide = outsideSide
        onCornerMergePreview?.(id, outsideSide)
      }
      setCornerDragPreview(latestPreview)
    }

    const handleMove = (moveEvent: PointerEvent) => {
      updatePreview(moveEvent.clientX, moveEvent.clientY)
    }
    const cleanup = () => {
      document.body.style.cursor = ""
      document.documentElement.classList.remove("is-resizing-diagonal-a", "is-resizing-diagonal-b")
      document.body.style.userSelect = ""
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", cleanup)
      window.removeEventListener("blur", cleanup)
      try { handleElement.releasePointerCapture?.(event.pointerId) } catch {}
      setCornerDragPreview(null)
      onCornerMergePreview?.(id, null)
    }
    const handleUp = () => {
      if (latestMergeSide) {
        onCornerMergeDrop?.(id, latestMergeSide)
      } else if (latestPreview) {
        onAddPanel?.(type, latestPreview.direction, latestPreview.placement, latestPreview.ratio)
      }
      cleanup()
    }

    document.body.style.cursor = corner.includes("left") ? "nwse-resize" : "nesw-resize"
    document.documentElement.classList.add(corner.includes("left") ? "is-resizing-diagonal-a" : "is-resizing-diagonal-b")
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", cleanup)
    window.addEventListener("blur", cleanup)
  }
  const toggleAddMenu = () => {
    if (addMenuOpen) {
      setAddMenuOpen(false)
      return
    }
    const rect = addMenuRef.current?.getBoundingClientRect()
    if (rect) {
      const menuWidth = 224
      const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8)
      setAddMenuPosition({ left, top: Math.min(rect.bottom + 4, window.innerHeight - 80) })
    }
    setAddMenuOpen(true)
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
      className={"ui-panel-shell relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] shadow-[0_1px_2px_var(--color-panel-shadow),inset_0_1px_0_rgba(255,255,255,0.035)] " + className}
      style={style}
    >
      {showHeader && (
        <div
          className={
            "ui-panel-header relative shrink-0 flex min-w-0 items-center gap-1.5 px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-visible " +
            (addMenuOpen ? "z-[120]" : "z-40")
          }
          style={{ height: "var(--panel-header-height)" }}
        >
          <select
            value={type}
            onChange={e => onTypeChange?.(e.target.value as PanelType)}
            className="ui-panel-select min-w-[72px] max-w-[180px] flex-1 bg-transparent text-xs font-medium outline-none hover:text-[var(--color-accent-text)]"
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
              onClick={toggleAddMenu}
              className="rounded border border-transparent bg-[var(--color-bg-primary)]/60 text-[12px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent)]/10"
              style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
              title="添加面板"
            >
              +
            </button>
            {addMenuOpen && (
              <div
                className="ui-popover-surface ui-popover-menu fixed z-[130] max-h-64 w-56 overflow-y-auto"
                style={{ left: addMenuPosition.left, top: addMenuPosition.top }}
              >
                {groupedOptions.map(group => (
                  <div key={group.title || "default"} className="py-0.5">
                    {group.title && (
                      <div className="px-3 py-1 text-[10px] font-medium text-[var(--color-text-secondary)]">
                        {group.title}
                      </div>
                    )}
                    {group.options.map(option => (
                      <div key={option.type} className="flex items-center gap-1 px-1.5 py-0.5">
                        <button
                          onClick={() => handleAddPanel(option.type, "right")}
                          className="ui-menu-item min-w-0 flex-1 truncate px-1.5 py-1 text-xs"
                          title={option.description}
                        >
                          {option.title}
                        </button>
                        <div className="ui-menu-direction-group flex items-center gap-1">
                          <button onClick={() => handleAddPanel(option.type, "left")} className="ui-menu-direction-button" title={`左侧添加${option.title}`}>左</button>
                          <button onClick={() => handleAddPanel(option.type, "right")} className="ui-menu-direction-button" title={`右侧添加${option.title}`}>右</button>
                          <button onClick={() => handleAddPanel(option.type, "up")} className="ui-menu-direction-button" title={`上方添加${option.title}`}>上</button>
                          <button onClick={() => handleAddPanel(option.type, "down")} className="ui-menu-direction-button" title={`下方添加${option.title}`}>下</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onSplit?.("horizontal")}
            className="shrink-0 rounded border border-transparent bg-[var(--color-bg-primary)]/60 text-[12px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title="左右分割"
          >
            ↔
          </button>
          <button
            onClick={() => onSplit?.("vertical")}
            className="shrink-0 rounded border border-transparent bg-[var(--color-bg-primary)]/60 text-[12px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title="上下分割"
          >
            ↕
          </button>
          <button
            onClick={onMaximize}
            className="shrink-0 rounded border border-transparent bg-[var(--color-bg-primary)]/60 text-[12px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent)]/10"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title={maximized ? "还原面板" : "最大化面板"}
          >
            {maximized ? "▣" : "□"}
          </button>
          <button
            onClick={onClose}
            disabled={closeDisabled}
            className="shrink-0 rounded border border-transparent bg-[var(--color-bg-primary)]/60 text-[12px] text-[var(--color-text-secondary)] hover:border-red-400/40 hover:text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-[var(--color-bg-primary)]/60 disabled:hover:text-[var(--color-text-secondary)]"
            style={{ width: "var(--panel-control-size)", height: "var(--panel-control-size)" }}
            title={closeDisabled ? "至少保留一个面板" : "关闭面板"}
          >
            ×
          </button>
        </div>
      )}
      <div className="ui-panel-content flex-1 min-h-0 min-w-0 overflow-auto p-[3px]">
        {children}
      </div>
      <CornerHandle position="top-left" onPointerDown={startCornerDrag} />
      <CornerHandle position="top-right" onPointerDown={startCornerDrag} />
      <CornerHandle position="bottom-left" onPointerDown={startCornerDrag} />
      <CornerHandle position="bottom-right" onPointerDown={startCornerDrag} />
      {cornerDragPreview && !mergeHighlighted && (
        <div
          className={
            "pointer-events-none absolute z-40 bg-sky-500/15 outline outline-2 outline-dashed outline-sky-400 " +
            (cornerDragPreview.direction === "horizontal"
              ? "left-0 top-0 h-full"
              : "left-0 top-0 w-full")
          }
          style={cornerDragPreview.direction === "horizontal"
            ? {
                width: `${cornerDragPreview.placement === "before" ? cornerDragPreview.ratio * 100 : (1 - cornerDragPreview.ratio) * 100}%`,
                left: cornerDragPreview.placement === "before" ? 0 : `${cornerDragPreview.ratio * 100}%`,
              }
            : {
                height: `${cornerDragPreview.placement === "before" ? cornerDragPreview.ratio * 100 : (1 - cornerDragPreview.ratio) * 100}%`,
                top: cornerDragPreview.placement === "before" ? 0 : `${cornerDragPreview.ratio * 100}%`,
              }}
        />
      )}
      {mergeHighlighted && (
        <div
          className="pointer-events-none absolute z-50 bg-emerald-500/20 outline outline-2 outline-emerald-400"
          style={mergePreviewRect
            ? {
                left: `${mergePreviewRect.left * 100}%`,
                top: `${mergePreviewRect.top * 100}%`,
                width: `${mergePreviewRect.width * 100}%`,
                height: `${mergePreviewRect.height * 100}%`,
              }
            : { inset: 0 }}
        />
      )}
    </section>
  )
}

function getOutsidePanelSide(rect: DOMRect, clientX: number, clientY: number): CornerMergeSide | null {
  const threshold = 18
  const candidates: { side: CornerMergeSide; distance: number }[] = []
  if (clientX < rect.left - threshold) candidates.push({ side: "left", distance: (rect.left - threshold - clientX) / rect.width })
  if (clientX > rect.right + threshold) candidates.push({ side: "right", distance: (clientX - rect.right - threshold) / rect.width })
  if (clientY < rect.top - threshold) candidates.push({ side: "up", distance: (rect.top - threshold - clientY) / rect.height })
  if (clientY > rect.bottom + threshold) candidates.push({ side: "down", distance: (clientY - rect.bottom - threshold) / rect.height })
  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0]?.side ?? null
}

function CornerHandle({
  position,
  onPointerDown,
}: {
  position: CornerPosition
  onPointerDown: (position: CornerPosition, event: React.PointerEvent) => void
}) {
  const positionClass =
    position === "top-left" ? "left-0 top-0 cursor-nwse-resize" :
    position === "top-right" ? "right-0 top-0 cursor-nesw-resize" :
    position === "bottom-left" ? "bottom-0 left-0 cursor-nesw-resize" :
    "bottom-0 right-0 cursor-nwse-resize"

  return (
    <button
      onPointerDown={event => onPointerDown(position, event)}
      className={"ui-panel-corner absolute z-30 h-6 w-6 opacity-0 hover:opacity-100 focus:opacity-100 " + positionClass}
      title="拖拽分割面板"
      aria-label="拖拽分割面板"
    >
      <span className="pointer-events-none absolute inset-1 block rounded-sm border border-[var(--color-accent)] bg-[var(--color-accent)]/30" />
    </button>
  )
}
