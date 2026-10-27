import type {
  WorkspaceArea,
  WorkspaceAreaNode,
  WorkspaceDocument,
  WorkspaceEditorInstance,
  WorkspaceFloatingGroup,
  WorkspacePopout,
  WorkspaceTabGroup,
} from "../components/workspace/workspace-document"
import type { PanelType } from "../components/workspace/panelTypes"

export type WorkspaceSplitDirection = "horizontal" | "vertical"

export interface WorkspaceEngine {
  createArea(document: WorkspaceDocument, editor: WorkspaceEditorInstance): WorkspaceDocument
  splitArea(document: WorkspaceDocument, areaId: string, direction: WorkspaceSplitDirection, editor: WorkspaceEditorInstance, before?: boolean): WorkspaceDocument
  mergeArea(document: WorkspaceDocument, areaId: string, targetAreaId: string): WorkspaceDocument
  addEditor(document: WorkspaceDocument, areaId: string, editor: WorkspaceEditorInstance): WorkspaceDocument
  removeEditor(document: WorkspaceDocument, editorId: string): WorkspaceDocument
  moveEditor(document: WorkspaceDocument, editorId: string, targetAreaId: string): WorkspaceDocument
  moveTab(document: WorkspaceDocument, editorId: string, targetAreaId: string): WorkspaceDocument
  floatEditor(document: WorkspaceDocument, editorId: string, bounds?: Partial<WorkspaceFloatingGroup>): WorkspaceDocument
  dockEditor(document: WorkspaceDocument, editorId: string, targetAreaId?: string): WorkspaceDocument
  popoutEditor(document: WorkspaceDocument, editorId: string, bounds?: Partial<WorkspacePopout>): WorkspaceDocument
  maximizeEditor(document: WorkspaceDocument, editorId: string): WorkspaceDocument
  restoreEditor(document: WorkspaceDocument, editorId?: string): WorkspaceDocument
  serialize(document: WorkspaceDocument): WorkspaceDocument
  restore(document: unknown): WorkspaceDocument
}

const MIN_RATIO = 0.12
const MAX_RATIO = 0.88
const createId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clampRatio(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, number)) : 0.5
}

function findAreaNode(node: WorkspaceAreaNode, areaId: string): WorkspaceAreaNode | null {
  if (node.kind === "area") return node.areaId === areaId ? node : null
  return findAreaNode(node.first, areaId) || findAreaNode(node.second, areaId)
}

function replaceNode(node: WorkspaceAreaNode, targetId: string, replacement: WorkspaceAreaNode): WorkspaceAreaNode {
  if (node.id === targetId) return replacement
  if (node.kind === "area") return node
  return { ...node, first: replaceNode(node.first, targetId, replacement), second: replaceNode(node.second, targetId, replacement) }
}

function removeAreaNode(node: WorkspaceAreaNode, areaId: string): WorkspaceAreaNode | null {
  if (node.kind === "area") return node.areaId === areaId ? null : node
  const first = removeAreaNode(node.first, areaId)
  const second = removeAreaNode(node.second, areaId)
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

function updateTabGroup(document: WorkspaceDocument, area: WorkspaceArea): WorkspaceDocument {
  const tabGroupId = area.tabGroupId || "tabs_" + area.id
  const tabGroup: WorkspaceTabGroup = {
    id: tabGroupId,
    areaId: area.id,
    editorIds: [...area.editorIds],
    activeEditorId: area.activeEditorId,
  }
  return {
    ...document,
    tabGroups: { ...document.tabGroups, [tabGroupId]: tabGroup },
    areas: { ...document.areas, [area.id]: { ...area, tabGroupId } },
  }
}

function detachFromArea(document: WorkspaceDocument, editorId: string): WorkspaceDocument {
  const area = Object.values(document.areas).find(item => item.editorIds.includes(editorId))
  if (!area) return document
  const editorIds = area.editorIds.filter(id => id !== editorId)
  const activeEditorId = area.activeEditorId === editorId ? editorIds[0] || null : area.activeEditorId
  return updateTabGroup(
    { ...document, areas: { ...document.areas, [area.id]: { ...area, editorIds, activeEditorId } } },
    { ...area, editorIds, activeEditorId },
  )
}

function detachFloating(document: WorkspaceDocument, editorId: string): WorkspaceDocument {
  const floatingGroups = document.floatingGroups
    .map(group => group.editorIds.includes(editorId)
      ? { ...group, editorIds: group.editorIds.filter(id => id !== editorId), activeEditorId: group.activeEditorId === editorId ? null : group.activeEditorId }
      : group)
    .filter(group => group.editorIds.length > 0)
  return { ...document, floatingGroups }
}

function detachPopout(document: WorkspaceDocument, editorId: string): WorkspaceDocument {
  const popouts = document.popouts
    .map(popout => popout.editorIds.includes(editorId)
      ? { ...popout, editorIds: popout.editorIds.filter(id => id !== editorId), activeEditorId: popout.activeEditorId === editorId ? null : popout.activeEditorId }
      : popout)
    .filter(popout => popout.editorIds.length > 0)
  return { ...document, popouts }
}

function updateEditor(document: WorkspaceDocument, editorId: string, updater: (editor: WorkspaceEditorInstance) => WorkspaceEditorInstance) {
  const editor = document.editors[editorId]
  if (!editor) return document
  return { ...document, editors: { ...document.editors, [editorId]: updater(editor) } }
}

export class LegacyWorkspaceEngine implements WorkspaceEngine {
  createArea(document: WorkspaceDocument, editor: WorkspaceEditorInstance): WorkspaceDocument {
    const areaId = "area_" + editor.id
    const tabGroupId = "tabs_" + areaId
    const regionId = "region_" + areaId + "_main"
    const area: WorkspaceArea = { id: areaId, panelId: editor.id, editorIds: [editor.id], activeEditorId: editor.id, tabGroupId, regionIds: [regionId] }
    const nextEditor = { ...editor, areaId, tabGroupId, regionId }
    return {
      ...document,
      areas: { ...document.areas, [areaId]: area },
      editors: { ...document.editors, [editor.id]: nextEditor },
      tabGroups: { ...document.tabGroups, [tabGroupId]: { id: tabGroupId, areaId, editorIds: [editor.id], activeEditorId: editor.id } },
      regions: { ...document.regions, [regionId]: { id: regionId, areaId, kind: "main", editorId: editor.id } },
      activeAreaId: areaId,
      activeEditorId: editor.id,
    }
  }

  splitArea(document: WorkspaceDocument, areaId: string, direction: WorkspaceSplitDirection, editor: WorkspaceEditorInstance, before = false): WorkspaceDocument {
    const areaNode = findAreaNode(document.root, areaId)
    if (!areaNode || areaNode.kind !== "area") return document
    const created = this.createArea(document, editor)
    const newAreaId = created.activeAreaId || "area_" + editor.id
    const newNode: WorkspaceAreaNode = { kind: "area", id: "area_node_" + newAreaId, areaId: newAreaId }
    const split: WorkspaceAreaNode = {
      kind: "split",
      id: createId("split_"),
      direction,
      ratio: 0.5,
      first: before ? newNode : areaNode,
      second: before ? areaNode : newNode,
    }
    return { ...created, root: replaceNode(created.root, areaNode.id, split) }
  }

  mergeArea(document: WorkspaceDocument, areaId: string, targetAreaId: string) {
    if (areaId === targetAreaId || !document.areas[areaId] || !document.areas[targetAreaId]) return document
    const source = document.areas[areaId]
    const target = document.areas[targetAreaId]
    const nextTarget = { ...target, editorIds: [...target.editorIds, ...source.editorIds], activeEditorId: source.activeEditorId || target.activeEditorId }
    const root = removeAreaNode(document.root, areaId) || document.root
    const editors = { ...document.editors }
    for (const id of source.editorIds) editors[id] = { ...editors[id], areaId: targetAreaId, tabGroupId: nextTarget.tabGroupId }
    const areas = { ...document.areas, [targetAreaId]: nextTarget }
    delete areas[areaId]
    return updateTabGroup({ ...document, root, areas, editors }, nextTarget)
  }

  addEditor(document: WorkspaceDocument, areaId: string, editor: WorkspaceEditorInstance) {
    const area = document.areas[areaId]
    if (!area) return document
    const nextArea = { ...area, editorIds: [...area.editorIds, editor.id], activeEditorId: editor.id }
    return updateTabGroup({ ...document, areas: { ...document.areas, [areaId]: nextArea }, editors: { ...document.editors, [editor.id]: { ...editor, areaId, tabGroupId: area.tabGroupId } } }, nextArea)
  }

  removeEditor(document: WorkspaceDocument, editorId: string) {
    const editor = document.editors[editorId]
    if (!editor) return document
    let next = detachFromArea(document, editorId)
    next = detachFloating(next, editorId)
    next = detachPopout(next, editorId)
    const editors = { ...next.editors }
    delete editors[editorId]
    const regions = Object.fromEntries(Object.entries(next.regions).filter(([, region]) => region.editorId !== editorId))
    const areas = { ...next.areas }
    const area = editor.areaId ? areas[editor.areaId] : undefined
    if (area && area.editorIds.length === 0) {
      delete areas[area.id]
      next = { ...next, root: removeAreaNode(next.root, area.id) || next.root }
    }
    return { ...next, areas, editors, regions, activeEditorId: next.activeEditorId === editorId ? Object.keys(editors)[0] || null : next.activeEditorId }
  }

  moveEditor(document: WorkspaceDocument, editorId: string, targetAreaId: string) {
    const editor = document.editors[editorId]
    const target = document.areas[targetAreaId]
    if (!editor || !target || editor.areaId === targetAreaId) return document
    let next = detachFromArea(document, editorId)
    next = detachFloating(next, editorId)
    next = detachPopout(next, editorId)
    const area = { ...target, editorIds: [...target.editorIds, editorId], activeEditorId: editorId }
    next = updateTabGroup({ ...next, areas: { ...next.areas, [targetAreaId]: area }, editors: { ...next.editors, [editorId]: { ...editor, areaId: targetAreaId, tabGroupId: area.tabGroupId, floatingGroupId: undefined, popoutId: undefined } } }, area)
    return { ...next, activeAreaId: targetAreaId, activeEditorId: editorId }
  }

  moveTab(document: WorkspaceDocument, editorId: string, targetAreaId: string) {
    return this.moveEditor(document, editorId, targetAreaId)
  }

  floatEditor(document: WorkspaceDocument, editorId: string, bounds: Partial<WorkspaceFloatingGroup> = {}) {
    const editor = document.editors[editorId]
    if (!editor) return document
    let next = detachFromArea(document, editorId)
    next = detachPopout(next, editorId)
    const existing = next.floatingGroups.find(group => group.id === bounds.id || group.editorIds.includes(editorId))
    const group: WorkspaceFloatingGroup = existing
      ? { ...existing, ...bounds, editorIds: Array.from(new Set(existing.editorIds.concat(editorId))), activeEditorId: editorId }
      : { id: bounds.id || "float_" + editorId, editorIds: [editorId], activeEditorId: editorId, x: bounds.x ?? 20, y: bounds.y ?? 20, width: bounds.width ?? 520, height: bounds.height ?? 680, zIndex: bounds.zIndex ?? 1, maximized: bounds.maximized ?? false }
    return { ...next, floatingGroups: next.floatingGroups.filter(item => item.id !== group.id).concat(group), editors: { ...next.editors, [editorId]: { ...editor, floatingGroupId: group.id, popoutId: undefined } }, activeEditorId: editorId }
  }

  dockEditor(document: WorkspaceDocument, editorId: string, targetAreaId?: string) {
    const target = targetAreaId || document.activeAreaId || Object.keys(document.areas)[0]
    return target ? this.moveEditor(document, editorId, target) : document
  }

  popoutEditor(document: WorkspaceDocument, editorId: string, bounds: Partial<WorkspacePopout> = {}) {
    const editor = document.editors[editorId]
    if (!editor) return document
    let next = detachFromArea(document, editorId)
    next = detachFloating(next, editorId)
    const existing = next.popouts.find(item => item.id === bounds.id || item.editorIds.includes(editorId))
    const popout: WorkspacePopout = existing
      ? { ...existing, ...bounds, editorIds: Array.from(new Set(existing.editorIds.concat(editorId))), activeEditorId: editorId, open: true }
      : { id: bounds.id || "popout_" + editorId, editorIds: [editorId], activeEditorId: editorId, open: true, x: bounds.x ?? 80, y: bounds.y ?? 80, width: bounds.width ?? 1100, height: bounds.height ?? 760, maximized: bounds.maximized ?? false }
    return { ...next, popouts: next.popouts.filter(item => item.id !== popout.id).concat(popout), editors: { ...next.editors, [editorId]: { ...editor, popoutId: popout.id, floatingGroupId: undefined } }, activeEditorId: editorId }
  }

  maximizeEditor(document: WorkspaceDocument, editorId: string) {
    return updateEditor(document, editorId, editor => ({ ...editor, maximized: true }))
  }

  restoreEditor(document: WorkspaceDocument, editorId?: string) {
    const editors = Object.fromEntries(Object.entries(document.editors).map(([id, editor]) => [id, editorId && id !== editorId ? editor : { ...editor, maximized: false }]))
    return { ...document, editors }
  }

  serialize(document: WorkspaceDocument) {
    return clone(document)
  }

  restore(document: unknown) {
    if (!document || typeof document !== "object") throw new Error("Workspace 文档无效")
    return clone(document as WorkspaceDocument)
  }
}

export function createWorkspaceEngine(): WorkspaceEngine {
  return new LegacyWorkspaceEngine()
}

export function workspaceEditorStateKey(workspaceId: string, editorId: string, type: PanelType) {
  return workspaceId + ":" + editorId + ":" + type
}

