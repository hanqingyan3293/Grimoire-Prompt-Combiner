import type { PanelType } from "./panelTypes"

export type WorkspaceEditorInstance = {
  id: string
  type: PanelType
  title?: string
  stateKey?: string
}

export type WorkspaceArea = {
  id: string
  editorIds: string[]
  activeEditorId: string | null
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
  maximized: boolean
}

export type WorkspaceDocument = {
  version: 1
  workspaceId: string
  root: WorkspaceAreaNode
  areas: Record<string, WorkspaceArea>
  editors: Record<string, WorkspaceEditorInstance>
  floatingGroups: WorkspaceFloatingGroup[]
  activeAreaId: string | null
  activeEditorId: string | null
}

export type LegacyWorkspaceLayoutNode =
  | { kind: "panel"; id: string; type: PanelType }
  | { kind: "split"; id: string; direction: "horizontal" | "vertical"; ratio: number; first: LegacyWorkspaceLayoutNode; second: LegacyWorkspaceLayoutNode }

export function workspaceDocumentFromLegacy(workspaceId: string, layout: LegacyWorkspaceLayoutNode): WorkspaceDocument {
  const areas: Record<string, WorkspaceArea> = {}
  const editors: Record<string, WorkspaceEditorInstance> = {}
  let activeAreaId: string | null = null
  let activeEditorId: string | null = null

  const visit = (node: LegacyWorkspaceLayoutNode): WorkspaceAreaNode => {
    if (node.kind === "panel") {
      const areaId = "area_" + node.id
      areas[areaId] = { id: areaId, editorIds: [node.id], activeEditorId: node.id }
      editors[node.id] = { id: node.id, type: node.type, stateKey: workspaceId + ":" + node.id }
      activeAreaId ||= areaId
      activeEditorId ||= node.id
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

  return {
    version: 1,
    workspaceId,
    root: visit(layout),
    areas,
    editors,
    floatingGroups: [],
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
    const editorId = area?.activeEditorId || area?.editorIds[0]
    const editor = editorId ? document.editors[editorId] : undefined
    return {
      kind: "panel",
      id: editor?.id || node.areaId,
      type: editor?.type || "utility-sidebar",
    }
  }
  return visit(document.root)
}

export function normalizeWorkspaceDocument(document: WorkspaceDocument): WorkspaceDocument {
  const areas = { ...document.areas }
  const editors = { ...document.editors }
  for (const area of Object.values(areas)) {
    area.editorIds = area.editorIds.filter((id) => Boolean(editors[id]))
    area.activeEditorId = area.activeEditorId && editors[area.activeEditorId] ? area.activeEditorId : area.editorIds[0] || null
  }
  return {
    ...document,
    areas,
    editors,
    floatingGroups: document.floatingGroups || [],
    activeAreaId: document.activeAreaId && areas[document.activeAreaId] ? document.activeAreaId : Object.keys(areas)[0] || null,
    activeEditorId: document.activeEditorId && editors[document.activeEditorId] ? document.activeEditorId : Object.keys(editors)[0] || null,
  }
}

function clampRatio(value: unknown) {
  const ratio = Number(value)
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(0.88, Math.max(0.12, ratio))
}
