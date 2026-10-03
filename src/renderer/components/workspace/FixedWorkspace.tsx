import React, { useMemo, useRef, useState } from "react"
import { PanelShell, type CornerMergeSide } from "./PanelShell"
import { ENABLED_PANEL_OPTIONS, PANEL_DEFINITIONS, PANEL_OPTION_GROUPS, renderPanel } from "./PanelRegistry"
import { findPanelNode, useWorkspaceStore } from "../../stores/workspace.store"
import { normalizePanelTabs, type MergeSide, type WorkspaceLayoutNode, type WorkspacePanelRect } from "../../stores/workspace.store"

type MergePreview = {
  panelId: string
  rect: {
    left: number
    top: number
    width: number
    height: number
  }
} | null

export function FixedWorkspace() {
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const layouts = useWorkspaceStore(s => s.layouts)
  const maximizedPanels = useWorkspaceStore(s => s.maximizedPanels)
  const floatingPanels = useWorkspaceStore(s => s.floatingPanels)
  const floatingPositions = useWorkspaceStore(s => s.floatingPositions)
  const setPanelType = useWorkspaceStore(s => s.setPanelType)
  const addTab = useWorkspaceStore(s => s.addTab)
  const setActiveTab = useWorkspaceStore(s => s.setActiveTab)
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const moveTab = useWorkspaceStore(s => s.moveTab)
  const splitPanel = useWorkspaceStore(s => s.splitPanel)
  const mergePanelByRects = useWorkspaceStore(s => s.mergePanelByRects)
  const closePanel = useWorkspaceStore(s => s.closePanel)
  const setSplitRatio = useWorkspaceStore(s => s.setSplitRatio)
  const setMaximizedPanel = useWorkspaceStore(s => s.setMaximizedPanel)
  const setFloatingPanel = useWorkspaceStore(s => s.setFloatingPanel)
  const setFloatingPanelPosition = useWorkspaceStore(s => s.setFloatingPanelPosition)
  const focusFloatingPanel = useWorkspaceStore(s => s.focusFloatingPanel)
  const containerRef = useRef<HTMLDivElement>(null)
  const [mergePreview, setMergePreview] = useState<MergePreview>(null)
  const workspace = useMemo(
    () => workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0],
    [activeWorkspaceId, workspaces]
  )
  const layout = useMemo(
    () => workspace ? layouts[workspace.id] || useWorkspaceStore.getState().getLayout(workspace.id) : null,
    [layouts, workspace]
  )
  const maximizedPanelId = workspace ? maximizedPanels[workspace.id] || null : null
  const maximizedPanel = useMemo(
    () => maximizedPanelId && layout ? findPanelNode(layout, maximizedPanelId) : null,
    [layout, maximizedPanelId]
  )
  const panelCount = useMemo(() => layout ? countPanelNodes(layout) : 0, [layout])

  const startResize = (node: Extract<WorkspaceLayoutNode, { kind: "split" }>, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const splitter = event.currentTarget
    splitter.setPointerCapture?.(event.pointerId)
    const container = (splitter.parentElement || containerRef.current) as HTMLElement | null
    if (!container) return

    const rect = container.getBoundingClientRect()
    let frame = 0
    let latestEvent: PointerEvent | null = null
    const onMove = (moveEvent: PointerEvent) => {
      latestEvent = moveEvent
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!latestEvent || !workspace) return
        const current = latestEvent
        const ratio = node.direction === "horizontal"
          ? (current.clientX - rect.left) / rect.width
          : (current.clientY - rect.top) / rect.height
        setSplitRatio(workspace.id, node.id, ratio)
      })
      return
    }

    const cleanupResize = () => {
      document.body.style.cursor = ""
      document.documentElement.classList.remove("is-resizing-horizontal", "is-resizing-vertical")
      document.body.style.userSelect = ""
      if (frame) cancelAnimationFrame(frame)
      try { splitter.releasePointerCapture?.(event.pointerId) } catch {}
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", cleanupResize)
      window.removeEventListener("pointercancel", cleanupResize)
      window.removeEventListener("blur", cleanupResize)
      document.removeEventListener("mouseleave", cleanupResize)
    }

    document.body.style.cursor = node.direction === "horizontal" ? "col-resize" : "row-resize"
    document.documentElement.classList.add(node.direction === "horizontal" ? "is-resizing-horizontal" : "is-resizing-vertical")
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", cleanupResize)
    window.addEventListener("pointercancel", cleanupResize)
    window.addEventListener("blur", cleanupResize)
    document.addEventListener("mouseleave", cleanupResize)
  }

  const updateMergePreview = (panelId: string, side: CornerMergeSide | null) => {
    if (!side) {
      setMergePreview(null)
      return
    }
    setMergePreview(getRectMergePreview(collectPanelRects(containerRef.current), panelId, side))
  }

  const mergePanelFromDrag = (panelId: string, side: CornerMergeSide) => {
    if (!workspace) return false
    const rects = collectPanelRects(containerRef.current)
    const targetPanelId = findRectMergeTarget(rects, panelId, side)
    if (!targetPanelId) return false
    return mergePanelByRects(workspace.id, panelId, targetPanelId, side as MergeSide, rects)
  }

  const startFloatingDrag = (panelId: string, event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const panel = event.currentTarget.closest("[data-panel-id]") as HTMLElement | null
    if (!container || !panel) return
    event.preventDefault()
    event.stopPropagation()
    const containerRect = container.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const current = floatingPositions[workspace.id]?.[panelId] || { x: panelRect.left - containerRect.left, y: panelRect.top - containerRect.top, zIndex: 1 }
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = current.x
    const startTop = current.y
    focusFloatingPanel(workspace.id, panelId)
    const update = (moveEvent: PointerEvent) => {
      const maxX = Math.max(0, containerRect.width - panelRect.width)
      const maxY = Math.max(0, containerRect.height - panelRect.height)
      setFloatingPanelPosition(workspace.id, panelId, {
        x: Math.min(maxX, Math.max(0, startLeft + moveEvent.clientX - startX)),
        y: Math.min(maxY, Math.max(0, startTop + moveEvent.clientY - startY)),
      })
    }
    const cleanup = () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      window.removeEventListener("pointermove", update)
      window.removeEventListener("pointerup", cleanup)
      window.removeEventListener("pointercancel", cleanup)
      window.removeEventListener("blur", cleanup)
    }
    document.body.style.userSelect = "none"
    document.body.style.cursor = "move"
    window.addEventListener("pointermove", update)
    window.addEventListener("pointerup", cleanup)
    window.addEventListener("pointercancel", cleanup)
    window.addEventListener("blur", cleanup)
  }

  const renderNode = (node: WorkspaceLayoutNode, renderFloating = false): React.ReactNode => {
    if (node.kind === "panel") {
      if (!renderFloating && (floatingPanels[workspace.id] || []).includes(node.id)) return <div className="h-full w-full" aria-hidden="true" />
      const tabs = normalizePanelTabs(node)
      const activeTabId = node.activeTabId || tabs[0].id
      const activeType = tabs.find(tab => tab.id === activeTabId)?.type || node.type
      const definition = PANEL_DEFINITIONS[activeType]
      return (
        <PanelShell
          id={node.id}
          type={activeType}
          title={definition.title}
          style={{ width: "100%", height: "100%" }}
          showHeader
          panelOptions={ENABLED_PANEL_OPTIONS}
          panelOptionGroups={PANEL_OPTION_GROUPS}
          onTypeChange={(type) => setPanelType(workspace.id, node.id, type)}
          onAddTab={(type) => addTab(workspace.id, node.id, type)}
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={(tabId) => setActiveTab(workspace.id, node.id, tabId)}
          onTabClose={(tabId) => closeTab(workspace.id, node.id, tabId)}
          onTabDrop={(sourcePanelId, tabId) => { moveTab(workspace.id, sourcePanelId, node.id, tabId) }}
          onAddPanel={(type, direction, placement, ratio) => splitPanel(workspace.id, node.id, direction, type, placement, ratio)}
          onCornerMergePreview={updateMergePreview}
          onCornerMergeDrop={mergePanelFromDrag}
          onSplit={(direction) => splitPanel(workspace.id, node.id, direction)}
          onMaximize={() => setMaximizedPanel(workspace.id, maximizedPanelId === node.id ? null : node.id)}
          onFloat={() => setFloatingPanel(workspace.id, node.id, !(floatingPanels[workspace.id] || []).includes(node.id))}
          onFloatingDragStart={(event) => startFloatingDrag(node.id, event)}
          onPopout={() => void window.api.workspace.openPopout({ popoutId: workspace.id + ':' + node.id, panelType: activeType, title: definition.title })}
          floating={(floatingPanels[workspace.id] || []).includes(node.id)}
          onClose={() => closePanel(workspace.id, node.id)}
          maximized={maximizedPanelId === node.id}
          closeDisabled={panelCount <= 1}
          mergeHighlighted={mergePreview?.panelId === node.id}
          mergePreviewRect={mergePreview?.panelId === node.id ? mergePreview.rect : null}
        >
          {renderPanel(activeType)}
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
        <div
          onPointerDown={(event) => startResize(node, event)}
          role="separator"
          aria-orientation={isHorizontal ? "vertical" : "horizontal"}
          className={
            (isHorizontal ? "cursor-col-resize" : "cursor-row-resize") +
            " ui-workspace-splitter shrink-0 bg-[var(--color-bg-tertiary)] outline outline-1 outline-[var(--color-border-strong)] hover:bg-[var(--color-accent)] hover:outline-[var(--color-accent)] transition-colors"
          }
          style={isHorizontal
            ? { width: "var(--panel-splitter-size)", cursor: "col-resize" }
            : { height: "var(--panel-splitter-size)", cursor: "row-resize" }}
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
    <div ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden p-[3px]">
      {layout && renderNode(maximizedPanel || layout)}
      {workspace && (floatingPanels[workspace.id] || []).map(panelId => {
        const panel = layout ? findPanelNode(layout, panelId) : null
        if (!panel) return null
        const position = floatingPositions[workspace.id]?.[panelId]
        return <div key={panelId} className="absolute z-[80] h-[min(680px,calc(100%-40px))] w-[min(520px,calc(100%-40px))] shadow-2xl" style={position ? { left: position.x, top: position.y, zIndex: position.zIndex } : { right: 20, top: 20, zIndex: 80 }} onPointerDown={() => focusFloatingPanel(workspace.id, panelId)}>
          {renderNode(panel, true)}
        </div>
      })}
    </div>
  )
}

function countPanelNodes(node: WorkspaceLayoutNode): number {
  if (node.kind === "panel") return 1
  return countPanelNodes(node.first) + countPanelNodes(node.second)
}

function collectPanelRects(container: HTMLElement | null): WorkspacePanelRect[] {
  if (!container) return []
  const containerRect = container.getBoundingClientRect()
  if (containerRect.width <= 0 || containerRect.height <= 0) return []

  return Array.from(container.querySelectorAll<HTMLElement>("[data-panel-id]")).map(element => {
    const rect = element.getBoundingClientRect()
    return {
      id: element.dataset.panelId || "",
      type: element.dataset.panelType as WorkspacePanelRect["type"],
      left: (rect.left - containerRect.left) / containerRect.width,
      top: (rect.top - containerRect.top) / containerRect.height,
      right: (rect.right - containerRect.left) / containerRect.width,
      bottom: (rect.bottom - containerRect.top) / containerRect.height,
    }
  }).filter(rect => rect.id && rect.type)
}

function findRectMergeTarget(rects: WorkspacePanelRect[], panelId: string, side: CornerMergeSide): string | null {
  return getRectMergePreview(rects, panelId, side)?.panelId ?? null
}

function getRectMergePreview(rects: WorkspacePanelRect[], panelId: string, side: CornerMergeSide): MergePreview {
  const source = rects.find(rect => rect.id === panelId)
  if (!source) return null

  const epsilon = 0.012
  let best: { id: string; overlap: number } | null = null

  for (const target of rects) {
    if (target.id === source.id) continue

    let touches = false
    let canCropTarget = false
    let overlap = 0

    if (side === "left" || side === "right") {
      touches = side === "right"
        ? Math.abs(source.right - target.left) <= epsilon
        : Math.abs(source.left - target.right) <= epsilon
      canCropTarget = source.top >= target.top - epsilon && source.bottom <= target.bottom + epsilon
      overlap = Math.min(source.bottom, target.bottom) - Math.max(source.top, target.top)
    } else {
      touches = side === "down"
        ? Math.abs(source.bottom - target.top) <= epsilon
        : Math.abs(source.top - target.bottom) <= epsilon
      canCropTarget = source.left >= target.left - epsilon && source.right <= target.right + epsilon
      overlap = Math.min(source.right, target.right) - Math.max(source.left, target.left)
    }

    if (touches && canCropTarget && overlap > epsilon && (!best || overlap > best.overlap)) {
      best = { id: target.id, overlap }
    }
  }

  if (!best) return null
  const target = rects.find(rect => rect.id === best.id)
  if (!target) return null

  if (side === "left" || side === "right") {
    const top = clampUnit((source.top - target.top) / (target.bottom - target.top))
    const bottom = clampUnit((source.bottom - target.top) / (target.bottom - target.top))
    return {
      panelId: target.id,
      rect: {
        left: 0,
        top,
        width: 1,
        height: Math.max(0, bottom - top),
      },
    }
  }

  const left = clampUnit((source.left - target.left) / (target.right - target.left))
  const right = clampUnit((source.right - target.left) / (target.right - target.left))
  return {
    panelId: target.id,
    rect: {
      left,
      top: 0,
      width: Math.max(0, right - left),
      height: 1,
    },
  }
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value))
}
