import type { PanelType } from "./panelTypes"

export type WorkspaceEditorInstance = {
  id: string
  type: PanelType
  title?: string
  stateKey?: string
  areaId?: string
  tabGroupId?: string
  regionId?: string
  floatingGroupId?: string
  popoutId?: string
  maximized?: boolean
}

export type WorkspaceArea = {
  id: string
  panelId: string
  editorIds: string[]
  activeEditorId: string | null
  tabGroupId: string
  regionIds: string[]
}

export type WorkspaceAreaNode =
  | { kind: "area"; id: string; areaId: string }
  | { kind: "split"; id: string; direction: "horizontal" | "vertical"; ratio: number; first: WorkspaceAreaNode; second: WorkspaceAreaNode }

export type WorkspaceFloatingGroup = {
  id: string
  editorIds: string[]
  activeEditorId: string | null
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  maximized: boolean
}

export type WorkspaceTabGroup = {
  id: string
  areaId: string
  editorIds: string[]
  activeEditorId: string | null
}

export type WorkspaceRegion = {
  id: string
  areaId: string
  kind: "header" | "toolbar" | "main" | "sidebar" | "asset" | "agent" | "task" | "inspector" | "footer"
  editorId?: string
}

export type WorkspacePopout = {
  id: string
  editorIds: string[]
  activeEditorId: string | null
  open: boolean
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export type WorkspacePreset = {
  id: string
  name: string
  root: WorkspaceAreaNode
  createdAt: string
}

export type WorkspaceDocument = {
  version: 1
  workspaceId: string
  root: WorkspaceAreaNode
  areas: Record<string, WorkspaceArea>
  editors: Record<string, WorkspaceEditorInstance>
  tabGroups: Record<string, WorkspaceTabGroup>
  regions: Record<string, WorkspaceRegion>
  floatingGroups: WorkspaceFloatingGroup[]
  popouts: WorkspacePopout[]
  presets: WorkspacePreset[]
  activeAreaId: string | null
  activeEditorId: string | null
}

export type LegacyWorkspaceLayoutNode =
  | { kind: "panel"; id: string; type: PanelType; tabs?: Array<{ id: string; type: PanelType; mode?: "chat" | "vision" | "drawing" | "canvas" | "sessions" | "mcp" | "logs" }>; activeTabId?: string }
  | { kind: "split"; id: string; direction: "horizontal" | "vertical"; ratio: number; first: LegacyWorkspaceLayoutNode; second: LegacyWorkspaceLayoutNode }

export interface WorkspaceDocumentOptions {
  floatingPanels?: string[]
  floatingPositions?: Record<string, { x: number; y: number; width?: number; height?: number; zIndex?: number }>
  popoutPanels?: string[]
  popoutBounds?: Record<string, { x: number; y: number; width: number; height: number; maximized?: boolean }>
  maximizedPanelId?: string | null
  presets?: WorkspacePreset[]
}

export function workspaceDocumentFromLegacy(workspaceId: string, layout: LegacyWorkspaceLayoutNode, options: WorkspaceDocumentOptions = {}): WorkspaceDocument {
  const areas: Record<string, WorkspaceArea> = {}
  const editors: Record<string, WorkspaceEditorInstance> = {}
  const tabGroups: Record<string, WorkspaceTabGroup> = {}
  const regions: Record<string, WorkspaceRegion> = {}
  let activeAreaId: string | null = null
  let activeEditorId: string | null = null

  const visit = (node: LegacyWorkspaceLayoutNode): WorkspaceAreaNode => {
    if (node.kind === "panel") {
      const areaId = "area_" + node.id
      const regionId = "region_" + areaId + "_main"
      const rawTabs = Array.isArray(node.tabs) && node.tabs.length ? node.tabs : [{ id: node.id, type: node.type }]
      const tabs = rawTabs.filter(tab => tab && typeof tab.id === "string" && typeof tab.type === "string")
      const editorIds = tabs.map(tab => tab.id)
      const activeTabId = typeof node.activeTabId === "string" && editorIds.includes(node.activeTabId) ? node.activeTabId : editorIds[0]
      const tabGroupId = "tabs_" + areaId
      areas[areaId] = { id: areaId, panelId: node.id, editorIds, activeEditorId: activeTabId, tabGroupId, regionIds: [regionId] }
      tabGroups[tabGroupId] = { id: tabGroupId, areaId, editorIds: [...editorIds], activeEditorId: activeTabId }
      regions[regionId] = { id: regionId, areaId, kind: "main", editorId: activeTabId }
      for (const tab of tabs) {
        editors[tab.id] = {
          id: tab.id,
          type: tab.type,
          stateKey: workspaceId + ":" + tab.id + ":" + tab.type,
          areaId,
          tabGroupId,
          regionId,
          maximized: options.maximizedPanelId === node.id || options.maximizedPanelId === tab.id,
        }
      }
      activeAreaId ||= areaId
      activeEditorId ||= activeTabId
      return { kind: "area", id: "area_node_" + node.id, areaId }
    }
    return {
      kind: "split",
      id: node.id,
      direction: node.direction,
      ratio: clampRatio(node.ratio),
      first: visit(node.first),
      second: visit(node.second),
    }
  }

  const floatingGroups: WorkspaceFloatingGroup[] = (options.floatingPanels || []).map(panelId => {
    const area = areas["area_" + panelId]
    const position = options.floatingPositions?.[panelId]
    const editorIds = area?.editorIds || [panelId]
    return {
      id: "float_" + panelId,
      editorIds: [...editorIds],
      activeEditorId: area?.activeEditorId || editorIds[0] || null,
      x: position?.x ?? 20,
      y: position?.y ?? 20,
      width: position?.width ?? 520,
      height: position?.height ?? 680,
      zIndex: position?.zIndex ?? 1,
      maximized: false,
    }
  })
  const popouts: WorkspacePopout[] = (options.popoutPanels || []).map(panelId => {
    const area = areas["area_" + panelId]
    const bounds = options.popoutBounds?.[panelId]
    const editorIds = area?.editorIds || [panelId]
    return {
      id: workspaceId + ":" + panelId,
      editorIds: [...editorIds],
      activeEditorId: area?.activeEditorId || editorIds[0] || null,
      open: true,
      x: bounds?.x ?? 80,
      y: bounds?.y ?? 80,
      width: bounds?.width ?? 1100,
      height: bounds?.height ?? 760,
      maximized: bounds?.maximized ?? false,
    }
  })

  return {
    version: 1,
    workspaceId,
    root: visit(layout),
    areas,
    editors,
    tabGroups,
    regions,
    floatingGroups,
    popouts,
    presets: options.presets || [],
    activeAreaId,
    activeEditorId,
  }
}

export function workspaceDocumentToLegacy(document: WorkspaceDocument): LegacyWorkspaceLayoutNode {
  const visit = (node: WorkspaceAreaNode): LegacyWorkspaceLayoutNode => {
    if (node.kind === "split") {
      return {
        kind: "split",
        id: node.id,
        direction: node.direction,
        ratio: clampRatio(node.ratio),
        first: visit(node.first),
        second: visit(node.second),
      }
    }
    const area = document.areas[node.areaId]
    const editorIds = area?.editorIds || []
    const editorId = area?.activeEditorId || editorIds[0]
    const editor = editorId ? document.editors[editorId] : undefined
    return {
      kind: "panel",
      id: area?.panelId || editor?.id || node.areaId,
      type: editor?.type || "utility-sidebar",
      tabs: editorIds.map(id => ({ id, type: document.editors[id]?.type || "utility-sidebar" })),
      activeTabId: editorId,
    }
  }
  return visit(document.root)
}

export function normalizeWorkspaceDocument(document: WorkspaceDocument): WorkspaceDocument {
  const areas = { ...document.areas }
  const editors = { ...document.editors }
  const tabGroups = { ...(document.tabGroups || {}) }
  const regions = { ...(document.regions || {}) }
  for (const area of Object.values(areas)) {
    area.editorIds = area.editorIds.filter((id) => Boolean(editors[id]))
    area.activeEditorId = area.activeEditorId && editors[area.activeEditorId] ? area.activeEditorId : area.editorIds[0] || null
    area.panelId = area.panelId || area.id
    area.tabGroupId = area.tabGroupId || "tabs_" + area.id
    area.regionIds = Array.isArray(area.regionIds) ? area.regionIds : []
    tabGroups[area.tabGroupId] = {
      id: area.tabGroupId,
      areaId: area.id,
      editorIds: [...area.editorIds],
      activeEditorId: area.activeEditorId,
    }
  }
  return {
    ...document,
    areas,
    editors,
    tabGroups,
    regions,
    floatingGroups: document.floatingGroups || [],
    popouts: document.popouts || [],
    presets: document.presets || [],
    activeAreaId: document.activeAreaId && areas[document.activeAreaId] ? document.activeAreaId : Object.keys(areas)[0] || null,
    activeEditorId: document.activeEditorId && editors[document.activeEditorId] ? document.activeEditorId : Object.keys(editors)[0] || null,
  }
}

function clampRatio(value: unknown) {
  const ratio = Number(value)
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(0.88, Math.max(0.12, ratio))
}
