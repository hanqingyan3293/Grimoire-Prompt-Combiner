import React, { useRef } from "react"
import { PanelShell } from "./PanelShell"
import { ENABLED_PANEL_OPTIONS, PANEL_DEFINITIONS, renderPanel } from "./PanelRegistry"
import { useWorkspaceStore } from "../../stores/workspace.store"

const MIN_LEFT_WIDTH = 180
const MIN_RIGHT_WIDTH = 220
const MIN_CENTER_WIDTH = 360

export function FixedWorkspace() {
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace())
  const widths = useWorkspaceStore(s => s.getPanelWidths(workspace.id))
  const setPanelWidths = useWorkspaceStore(s => s.setPanelWidths)
  const setSlotPanelType = useWorkspaceStore(s => s.setSlotPanelType)
  const containerRef = useRef<HTMLDivElement>(null)

  const startResize = (dividerIndex: number, event: React.MouseEvent) => {
    event.preventDefault()
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const onMove = (moveEvent: MouseEvent) => {
      const maxLeft = Math.max(MIN_LEFT_WIDTH, rect.width - widths.right - MIN_CENTER_WIDTH)
      const maxRight = Math.max(MIN_RIGHT_WIDTH, rect.width - widths.left - MIN_CENTER_WIDTH)

      if (dividerIndex === 0) {
        const nextLeft = Math.min(maxLeft, Math.max(MIN_LEFT_WIDTH, moveEvent.clientX - rect.left))
        setPanelWidths(workspace.id, { ...widths, left: Math.round(nextLeft) })
      } else {
        const nextRight = Math.min(maxRight, Math.max(MIN_RIGHT_WIDTH, rect.right - moveEvent.clientX))
        setPanelWidths(workspace.id, { ...widths, right: Math.round(nextRight) })
      }
    }

    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const getSlotStyle = (index: number): React.CSSProperties => {
    if (index === 0) return { width: widths.left, minWidth: MIN_LEFT_WIDTH }
    if (index === 2) return { width: widths.right, minWidth: MIN_RIGHT_WIDTH }
    return { flex: 1, minWidth: MIN_CENTER_WIDTH }
  }

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      {workspace.slots.map((slot, index) => {
        const definition = PANEL_DEFINITIONS[slot.type]
        return (
          <React.Fragment key={slot.id}>
            <PanelShell
              id={slot.id}
              type={slot.type}
              title={definition.title}
              className={slot.className}
              style={getSlotStyle(index)}
              showHeader
              panelOptions={ENABLED_PANEL_OPTIONS}
              onTypeChange={(type) => setSlotPanelType(workspace.id, slot.id, type)}
            >
              {renderPanel(slot.type)}
            </PanelShell>
            {index < workspace.slots.length - 1 && (
              <button
                onMouseDown={(event) => startResize(index, event)}
                className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                title="拖动调整面板宽度"
                aria-label="拖动调整面板宽度"
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
