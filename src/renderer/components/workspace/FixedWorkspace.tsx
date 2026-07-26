import React, { useMemo, useRef, useState } from "react"
import { PanelShell, type CornerMergeSide } from "./PanelShell"
import { ENABLED_PANEL_OPTIONS, PANEL_DEFINITIONS, PANEL_OPTION_GROUPS, renderPanel } from "./PanelRegistry"
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
  const [mergePreviewPanelId, setMergePreviewPanelId] = useState<string | null>(null)
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
  const panelCount = useMemo(() => countPanelNodes(layout), [layout])

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

    const cleanupResize = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", cleanupResize)
      window.removeEventListener("blur", cleanupResize)
      document.removeEventListener("mouseleave", cleanupResize)
    }

    document.body.style.cursor = node.direction === "horizontal" ? "col-resize" : "row-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", cleanupResize)
    window.addEventListener("blur", cleanupResize)
    document.addEventListener("mouseleave", cleanupResize)
  }

  const updateMergePreview = (panelId: string, side: CornerMergeSide | null) => {
    if (!side) {
      setMergePreviewPanelId(null)
      return
    }
    setMergePreviewPanelId(findAdjacentPanelId(containerRef.current, panelId, side))
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
          panelOptionGroups={PANEL_OPTION_GROUPS}
          onTypeChange={(type) => setPanelType(workspace.id, node.id, type)}
          onAddPanel={(type, direction, placement, ratio) => splitPanel(workspace.id, node.id, direction, type, placement, ratio)}
          onCornerMergePreview={updateMergePreview}
          onSplit={(direction) => splitPanel(workspace.id, node.id, direction)}
          onMaximize={() => setMaximizedPanel(workspace.id, maximizedPanelId === node.id ? null : node.id)}
          onClose={() => closePanel(workspace.id, node.id)}
          maximized={maximizedPanelId === node.id}
          closeDisabled={panelCount <= 1}
          mergeHighlighted={mergePreviewPanelId === node.id}
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

function countPanelNodes(node: WorkspaceLayoutNode): number {
  if (node.kind === "panel") return 1
  return countPanelNodes(node.first) + countPanelNodes(node.second)
}

function findAdjacentPanelId(container: HTMLElement | null, panelId: string, side: CornerMergeSide): string | null {
  if (!container) return null

  const panelElements = Array.from(container.querySelectorAll<HTMLElement>("[data-panel-id]"))
  const current = panelElements.find(element => element.dataset.panelId === panelId)
  if (!current) return null

  const rect = current.getBoundingClientRect()
  const tolerance = 8
  const minOverlap = 8
  let best: { id: string; distance: number } | null = null

  for (const element of panelElements) {
    const id = element.dataset.panelId
    if (!id || id === panelId) continue

    const other = element.getBoundingClientRect()
    const horizontalOverlap = Math.min(rect.right, other.right) - Math.max(rect.left, other.left)
    const verticalOverlap = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top)
    let distance = Number.POSITIVE_INFINITY
    let touchesSide = false

    if (side === "left") {
      distance = Math.abs(other.right - rect.left)
      touchesSide = other.right <= rect.left + tolerance && verticalOverlap > minOverlap
    } else if (side === "right") {
      distance = Math.abs(other.left - rect.right)
      touchesSide = other.left >= rect.right - tolerance && verticalOverlap > minOverlap
    } else if (side === "up") {
      distance = Math.abs(other.bottom - rect.top)
      touchesSide = other.bottom <= rect.top + tolerance && horizontalOverlap > minOverlap
    } else {
      distance = Math.abs(other.top - rect.bottom)
      touchesSide = other.top >= rect.bottom - tolerance && horizontalOverlap > minOverlap
    }

    if (touchesSide && (!best || distance < best.distance)) {
      best = { id, distance }
    }
  }

  return best?.id ?? null
}
