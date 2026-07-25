import React, { useMemo, useRef } from "react"
import { PanelShell } from "./PanelShell"
import { ENABLED_PANEL_OPTIONS, PANEL_DEFINITIONS, renderPanel } from "./PanelRegistry"
import { WORKSPACES, findPanelNode, getDefaultLayout, useWorkspaceStore } from "../../stores/workspace.store"
import type { WorkspaceLayoutNode } from "../../stores/workspace.store"

export function FixedWorkspace() {
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const layouts = useWorkspaceStore(s => s.layouts)
  const maximizedPanels = useWorkspaceStore(s => s.maximizedPanels)
  const setPanelType = useWorkspaceStore(s => s.setPanelType)
  const splitPanel = useWorkspaceStore(s => s.splitPanel)
  const closePanel = useWorkspaceStore(s => s.closePanel)
  const setSplitRatio = useWorkspaceStore(s => s.setSplitRatio)
  const setMaximizedPanel = useWorkspaceStore(s => s.setMaximizedPanel)
  const containerRef = useRef<HTMLDivElement>(null)
  const workspace = useMemo(
    () => WORKSPACES.find(w => w.id === activeWorkspaceId) || WORKSPACES[0],
    [activeWorkspaceId]
  )
  const layout = useMemo(
    () => layouts[workspace.id] || getDefaultLayout(workspace.id),
    [layouts, workspace.id]
  )
  const maximizedPanelId = maximizedPanels[workspace.id] || null
  const maximizedPanel = useMemo(
    () => maximizedPanelId ? findPanelNode(layout, maximizedPanelId) : null,
    [layout, maximizedPanelId]
  )

  const startResize = (node: Extract<WorkspaceLayoutNode, { kind: "split" }>, event: React.MouseEvent) => {
    event.preventDefault()
    const container = (event.currentTarget.parentElement || containerRef.current) as HTMLElement | null
    if (!container) return

    const rect = container.getBoundingClientRect()
    const onMove = (moveEvent: MouseEvent) => {
      if (node.direction === "horizontal") {
        const ratio = (moveEvent.clientX - rect.left) / rect.width
        setSplitRatio(workspace.id, node.id, ratio)
      } else {
        const ratio = (moveEvent.clientY - rect.top) / rect.height
        setSplitRatio(workspace.id, node.id, ratio)
      }
    }

    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    document.body.style.cursor = node.direction === "horizontal" ? "col-resize" : "row-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const renderNode = (node: WorkspaceLayoutNode): React.ReactNode => {
    if (node.kind === "panel") {
      const definition = PANEL_DEFINITIONS[node.type]
      return (
        <PanelShell
          id={node.id}
          type={node.type}
          title={definition.title}
          style={{ width: "100%", height: "100%" }}
          showHeader
          panelOptions={ENABLED_PANEL_OPTIONS}
          onTypeChange={(type) => setPanelType(workspace.id, node.id, type)}
          onSplit={(direction) => splitPanel(workspace.id, node.id, direction)}
          onMaximize={() => setMaximizedPanel(workspace.id, maximizedPanelId === node.id ? null : node.id)}
          onClose={() => closePanel(workspace.id, node.id)}
          maximized={maximizedPanelId === node.id}
        >
          {renderPanel(node.type)}
        </PanelShell>
      )
    }

    const isHorizontal = node.direction === "horizontal"
    return (
      <div className={(isHorizontal ? "flex-row" : "flex-col") + " flex h-full w-full min-h-0 min-w-0 overflow-hidden"}>
        <div
          className="min-h-0 min-w-0 overflow-hidden"
          style={{ flexBasis: `${node.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
        >
          {renderNode(node.first)}
        </div>
        <button
          onMouseDown={(event) => startResize(node, event)}
          className={
            (isHorizontal ? "cursor-col-resize" : "cursor-row-resize") +
            " shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
          }
          style={isHorizontal ? { width: "var(--panel-splitter-size)" } : { height: "var(--panel-splitter-size)" }}
          title="拖动调整面板大小"
          aria-label="拖动调整面板大小"
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {renderNode(node.second)}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      {renderNode(maximizedPanel || layout)}
    </div>
  )
}
