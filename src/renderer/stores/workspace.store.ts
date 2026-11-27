import { create } from "zustand"
import { PANEL_TYPES, type PanelType } from "../components/workspace/panelTypes"
import { normalizeWorkspaceDocument, workspaceDocumentFromLegacy, workspaceDocumentToLegacy, type WorkspaceDocument, type WorkspaceDocumentOptions } from "../components/workspace/workspace-document"

export interface WorkspaceSlot {
  id: string
  type: PanelType
  className: string
}

export type SplitDirection = "horizontal" | "vertical"
export type SplitPlacement = "before" | "after"
export type MergeSide = "left" | "right" | "up" | "down"

export interface WorkspaceTab {
  id: string
  type: PanelType
  mode?: "chat" | "vision" | "drawing" | "canvas" | "sessions" | "mcp" | "logs"
}

export interface WorkspacePanelRect {
  id: string
  type: PanelType
  left: number
  top: number
  right: number
  bottom: number
}

export type WorkspaceLayoutNode =
  | {
      kind: "panel"
      id: string
      type: PanelType
      tabs?: WorkspaceTab[]
      activeTabId?: string
    }
  | {
      kind: "split"
      id: string
      direction: SplitDirection
      ratio: number
      first: WorkspaceLayoutNode
      second: WorkspaceLayoutNode
    }

export type WorkspaceLayouts = Record<string, WorkspaceLayoutNode>
export type MaximizedPanels = Record<string, string | null>
export type FloatingPanels = Record<string, string[]>
export type FloatingPosition = { x: number; y: number; zIndex: number; width?: number; height?: number }
export type FloatingPositions = Record<string, Record<string, FloatingPosition>>
export type PopoutPanels = Record<string, string[]>
export type PopoutBounds = Record<string, Record<string, { x: number; y: number; width: number; height: number; maximized?: boolean }>>
type VersionedLayoutsStorage = { version: number; layouts: WorkspaceLayouts }
type VersionedWorkspacesStorage = { version: number; workspaces: WorkspaceDefinition[] }
type VersionedLayoutPresetsStorage = { version: number; presets: WorkspaceLayoutPreset[] }

export interface WorkspaceLayoutPreset {
  id: string
  name: string
  layout: WorkspaceLayoutNode
  createdAt: string
}

export interface WorkspaceDefinition {
  id: string
  title: string
  slots: WorkspaceSlot[]
}

export type WorkspacePersistenceDocument = {
  version: 1 | 2
  activeWorkspaceId: string
  workspaces: WorkspaceDefinition[]
  layouts: WorkspaceLayouts
  maximizedPanels: MaximizedPanels
  floatingPanels: FloatingPanels
  floatingPositions: FloatingPositions
  popoutPanels: PopoutPanels
  popoutBounds: PopoutBounds
  layoutPresets: WorkspaceLayoutPreset[]
  semanticDocuments?: Record<string, WorkspaceDocument>
}

export const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: "compose",
    title: "创作",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[260px] min-w-[260px]" },
      { id: "main-workbench", type: "prompt-workbench", className: "flex-1" },
      { id: "right-sidebar", type: "utility-sidebar", className: "w-[320px] min-w-[320px]" },
    ],
  },
  {
    id: "ai",
    title: "AI",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[260px] min-w-[260px]" },
      { id: "agent-workspace", type: "agent", className: "flex-1" },
      { id: "right-sidebar", type: "utility-sidebar", className: "w-[320px] min-w-[320px]" },
    ],
  },
  {
    id: "vision",
    title: "识图",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[260px] min-w-[260px]" },
      { id: "agent-workspace", type: "agent", className: "flex-1" },
      { id: "right-sidebar", type: "utility-sidebar", className: "w-[320px] min-w-[320px]" },
    ],
  },
  {
    id: "reference",
    title: "图片参考",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[260px] min-w-[260px]" },
      { id: "images", type: "images", className: "flex-1" },
      { id: "history", type: "history", className: "w-[320px] min-w-[320px]" },
    ],
  },
  {
    id: "library",
    title: "标签管理",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[320px] min-w-[320px]" },
      { id: "main-workbench", type: "prompt-workbench", className: "flex-1" },
      { id: "prompt-assets", type: "prompt-assets", className: "w-[320px] min-w-[320px]" },
    ],
  },
  {
    id: "tag-assets",
    title: "标签与资产",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[280px] min-w-[280px]" },
      { id: "tag-asset-manager", type: "tag-asset-manager", className: "flex-1" },
      { id: "right-sidebar", type: "prompt-assets", className: "w-[360px] min-w-[320px]" },
    ],
  },
]

interface WorkspaceState {
  hydrated: boolean
  restoringPopouts: PopoutPanels
  persistenceRevision: number
  persistenceError: string | null
  activeWorkspaceId: string
  workspaces: WorkspaceDefinition[]
  layouts: WorkspaceLayouts
  maximizedPanels: MaximizedPanels
  floatingPanels: FloatingPanels
  floatingPositions: FloatingPositions
  popoutPanels: PopoutPanels
  popoutBounds: PopoutBounds
  layoutPresets: WorkspaceLayoutPreset[]
  setActiveWorkspace: (id: string) => void
  createWorkspace: () => void
  duplicateWorkspace: (sourceWorkspaceId?: string) => void
  deleteWorkspace: (workspaceId?: string) => void
  renameWorkspace: (id: string, title: string) => void
  setPanelType: (workspaceId: string, panelId: string, type: PanelType) => void
  addTab: (workspaceId: string, panelId: string, type: PanelType) => string | null
  setActiveTab: (workspaceId: string, panelId: string, tabId: string) => void
  closeTab: (workspaceId: string, panelId: string, tabId: string) => void
  moveTab: (workspaceId: string, sourcePanelId: string, targetPanelId: string, tabId: string) => boolean
  splitPanel: (workspaceId: string, panelId: string, direction: SplitDirection, type?: PanelType, placement?: SplitPlacement, ratio?: number) => void
  mergePanelByRects: (workspaceId: string, panelId: string, targetPanelId: string, side: MergeSide, rects: WorkspacePanelRect[]) => boolean
  closePanel: (workspaceId: string, panelId: string) => void
  setSplitRatio: (workspaceId: string, splitId: string, ratio: number) => void
  setMaximizedPanel: (workspaceId: string, panelId: string | null) => void
  setFloatingPanel: (workspaceId: string, panelId: string, floating: boolean) => void
  setFloatingPanelPosition: (workspaceId: string, panelId: string, position: { x: number; y: number }) => void
  setFloatingPanelSize: (workspaceId: string, panelId: string, size: { width: number; height: number }) => void
  focusFloatingPanel: (workspaceId: string, panelId: string) => void
  setPopoutPanel: (workspaceId: string, panelId: string, open: boolean) => void
  setPopoutBounds: (workspaceId: string, panelId: string, bounds: { x: number; y: number; width: number; height: number; maximized?: boolean }) => void
  resetWorkspace: () => void
  resetAllWorkspaces: () => void
  copyWorkspaceLayout: (sourceWorkspaceId: string, targetWorkspaceId: string) => void
  saveCurrentWorkspaceLayout: () => void
  exportCurrentWorkspace: () => Promise<boolean>
  importWorkspace: () => Promise<boolean>
  saveCurrentLayoutPreset: (name: string) => void
  applyLayoutPresetToCurrentWorkspace: (presetId: string) => void
  deleteLayoutPreset: (presetId: string) => void
  getLayout: (workspaceId: string) => WorkspaceLayoutNode
  getWorkspaceDocument: (workspaceId?: string) => WorkspaceDocument
  applyWorkspaceDocument: (document: WorkspaceDocument) => void
  applyPersistenceDocument: (revision: number, document: unknown) => void
  setPersistenceRevision: (revision: number) => void
  setPersistenceError: (error: string | null) => void
  getMaximizedPanelId: (workspaceId: string) => string | null
  findPanel: (workspaceId: string, panelId: string) => Extract<WorkspaceLayoutNode, { kind: "panel" }> | null
}

const STORAGE_KEY = "grimoire.activeWorkspace"
const WORKSPACES_STORAGE_KEY = "grimoire.workspaces"
const LAYOUTS_STORAGE_KEY = "grimoire.workspaceLayouts"
const MAXIMIZED_STORAGE_KEY = "grimoire.workspaceMaximizedPanels"
const FLOATING_STORAGE_KEY = "grimoire.workspaceFloatingPanels"
const FLOATING_POSITIONS_STORAGE_KEY = "grimoire.workspaceFloatingPositions"
const POPOUT_STORAGE_KEY = "grimoire.workspacePopoutPanels"
const POPOUT_BOUNDS_STORAGE_KEY = "grimoire.workspacePopoutBounds"
const LAYOUT_PRESETS_STORAGE_KEY = "grimoire.workspaceLayoutPresets"
const WORKSPACES_STORAGE_VERSION = 1
const LAYOUTS_STORAGE_VERSION = 2
const LAYOUT_PRESETS_STORAGE_VERSION = 2
const MIN_SPLIT_RATIO = 0.12
const MAX_SPLIT_RATIO = 0.88
const MAX_LAYOUT_DEPTH = 32
const FALLBACK_PANEL_TYPE: PanelType = "utility-sidebar"
// Derived from the registry, not hand-written. The previous hardcoded list silently turned any
// newly registered panel into `utility-sidebar` on reload — adding 提示词工作台 to the registry was
// enough to reproduce it, and nothing logged why.
const VALID_PANEL_TYPES = new Set<PanelType>(PANEL_TYPES)
export function isPersistablePanelType(value: unknown): value is PanelType {
  return typeof value === 'string' && VALID_PANEL_TYPES.has(value as PanelType)
}

const LEGACY_PANEL_ALIASES: Record<string, PanelType> = {
  "ai-assistant": "agent",
  "ai-chat": "agent",
  "ai-vision": "agent",
  "agent-sessions": "agent",
  mcp: "agent",
  presets: "prompt-assets",
  // 批量标签工具已并入标签与资产面板（2026-11-26），旧布局里的该页签落到台账页。
  "tag-batch": "tag-asset-manager",
}

export function legacyPanelMode(value: unknown): WorkspaceTab["mode"] {
  switch (value) {
    case "ai-vision": return "vision"
    case "ai-chat": return "chat"
    case "ai-assistant": return "chat"
    case "agent-sessions": return "sessions"
    case "mcp": return "mcp"
    case "logs": return "logs"
    default: return undefined
  }
}

export function normalizePersistedPanelType(value: unknown): PanelType | null {
  if (typeof value !== "string") return null
  return LEGACY_PANEL_ALIASES[value] || (isPersistablePanelType(value) ? value : null)
}

const createId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10)

function getInitialWorkspaces(): WorkspaceDefinition[] {
  if (typeof window === "undefined") return WORKSPACES
  try {
    const raw = window.localStorage.getItem(WORKSPACES_STORAGE_KEY)
    if (!raw) return WORKSPACES
    const parsed = JSON.parse(raw) as VersionedWorkspacesStorage | WorkspaceDefinition[]
    const rawWorkspaces = Array.isArray(parsed) ? parsed : parsed.workspaces
    if (!Array.isArray(rawWorkspaces)) return WORKSPACES
    const workspaces = rawWorkspaces
      .map(sanitizeWorkspaceDefinition)
      .filter(Boolean) as WorkspaceDefinition[]
    const merged = mergeDefaultWorkspaces(workspaces)
    saveWorkspaces(merged)
    return merged
  } catch {
    return WORKSPACES
  }
}

function sanitizeWorkspaceDefinition(workspace: unknown): WorkspaceDefinition | null {
  if (!workspace || typeof workspace !== "object") return null
  const value = workspace as Partial<WorkspaceDefinition>
  if (typeof value.id !== "string" || !value.id) return null
  const fallback = WORKSPACES.find(item => item.id === value.id)?.slots || WORKSPACES[0].slots
  const slots = Array.isArray(value.slots)
    ? value.slots.map(slot => {
      if (!slot || typeof slot !== "object") return null
      const candidate = slot as Partial<WorkspaceSlot>
      if (typeof candidate.id !== "string" || typeof candidate.type !== "string" || !isPersistablePanelType(candidate.type)) return null
      return {
        id: candidate.id,
        type: candidate.type,
        className: typeof candidate.className === "string" && candidate.className ? candidate.className : "flex-1",
      }
    }).filter(Boolean) as WorkspaceSlot[]
    : []
  return {
    id: value.id,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "未命名布局",
    slots: slots.length > 0 ? slots : fallback,
  }
}

function mergeDefaultWorkspaces(savedWorkspaces: WorkspaceDefinition[]) {
  const savedById = new Map(savedWorkspaces.map(workspace => [workspace.id, workspace]))
  const defaults = WORKSPACES.map(workspace => ({
    ...workspace,
    title: savedById.get(workspace.id)?.title || workspace.title,
  }))
  const custom = savedWorkspaces.filter(workspace => !WORKSPACES.some(item => item.id === workspace.id))
  return [...defaults, ...custom]
}

function saveWorkspaces(workspaces: WorkspaceDefinition[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify({
    version: WORKSPACES_STORAGE_VERSION,
    workspaces,
  } satisfies VersionedWorkspacesStorage))
}

function getInitialWorkspaceId(workspaces: WorkspaceDefinition[]) {
  if (typeof window === "undefined") return "compose"
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return workspaces.some(w => w.id === saved) ? saved! : "compose"
}

function createDefaultLayout(workspace: WorkspaceDefinition): WorkspaceLayoutNode {
  const [left, center, right] = workspace.slots
  return {
    kind: "split",
    id: `${workspace.id}-root`,
    direction: "horizontal",
    ratio: 0.22,
    first: { kind: "panel", id: left.id, type: left.type },
    second: {
      kind: "split",
      id: `${workspace.id}-right-split`,
      direction: "horizontal",
      ratio: 0.72,
      first: { kind: "panel", id: center.id, type: center.type },
      second: { kind: "panel", id: right.id, type: right.type },
    },
  }
}

export function getDefaultLayout(workspaceId: string): WorkspaceLayoutNode {
  const workspace = WORKSPACES.find(w => w.id === workspaceId) || WORKSPACES[0]
  return createDefaultLayout(workspace)
}

function getInitialLayouts(workspaces: WorkspaceDefinition[]): WorkspaceLayouts {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(LAYOUTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as WorkspaceLayouts | VersionedLayoutsStorage
    const rawLayouts: WorkspaceLayouts = Object.prototype.hasOwnProperty.call(parsed, "layouts")
      ? (parsed as VersionedLayoutsStorage).layouts
      : parsed as WorkspaceLayouts
    if (!rawLayouts || typeof rawLayouts !== "object") return {}
    const layouts: WorkspaceLayouts = {}
    for (const workspace of workspaces) {
      const layout = rawLayouts[workspace.id]
      const sanitized = sanitizeLayoutNode(layout)
      if (sanitized) layouts[workspace.id] = sanitized
    }
    saveLayouts(layouts)
    return layouts
  } catch {
    return {}
  }
}

function saveLayouts(layouts: WorkspaceLayouts) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LAYOUTS_STORAGE_KEY, JSON.stringify({
    version: LAYOUTS_STORAGE_VERSION,
    layouts,
  } satisfies VersionedLayoutsStorage))
}

function createUniqueLayoutId(prefix: string, usedIds: Set<string>) {
  let id = createId(prefix)
  while (usedIds.has(id)) id = createId(prefix)
  usedIds.add(id)
  return id
}

function sanitizeLayoutId(id: unknown, prefix: string, usedIds: Set<string>) {
  if (typeof id === "string") {
    const trimmed = id.trim()
    if (trimmed && !usedIds.has(trimmed)) {
      usedIds.add(trimmed)
      return trimmed
    }
  }
  return createUniqueLayoutId(prefix, usedIds)
}

function sanitizeLayoutNode(
  node: unknown,
  usedIds = new Set<string>(),
  depth = 0,
  usedEditorIds = new Set<string>()
): WorkspaceLayoutNode | null {
  if (depth > MAX_LAYOUT_DEPTH) return null
  if (!node || typeof node !== "object") return null
  const value = node as Partial<WorkspaceLayoutNode>
  if (value.kind === "panel") {
    const panelId = sanitizeLayoutId(value.id, "panel_", usedIds)
    const panelType = normalizePersistedPanelType(value.type) || FALLBACK_PANEL_TYPE
    const rawTabs = Array.isArray(value.tabs) && value.tabs.length ? value.tabs : [{ id: panelId, type: value.type }]
    const tabs = rawTabs.map((rawTab, index) => {
      const tab = rawTab && typeof rawTab === "object" ? rawTab as Partial<WorkspaceTab> : {}
      const originalType = typeof tab.type === "string" ? tab.type : panelType
      return {
        id: sanitizeLayoutId(tab.id, index === 0 ? panelId : "tab_", usedEditorIds),
        type: normalizePersistedPanelType(originalType) || panelType,
        ...(legacyPanelMode(originalType) ? { mode: legacyPanelMode(originalType) } : {}),
      }
    })
    return {
      kind: "panel",
      id: panelId,
      type: panelType,
      ...(tabs.length ? { tabs, activeTabId: typeof value.activeTabId === "string" && tabs.some(tab => tab.id === value.activeTabId) ? value.activeTabId : tabs[0].id } : {}),
    }
  }
  if (value.kind === "split") {
    const first = sanitizeLayoutNode(value.first, usedIds, depth + 1, usedEditorIds)
    const second = sanitizeLayoutNode(value.second, usedIds, depth + 1, usedEditorIds)
    if (!first && !second) return null
    if (!first) return second
    if (!second) return first
    return {
      kind: "split",
      id: sanitizeLayoutId(value.id, "split_", usedIds),
      direction: value.direction === "vertical" ? "vertical" : "horizontal",
      ratio: clampRatio(value.ratio),
      first,
      second,
    }
  }
  return null
}

function getInitialMaximizedPanels(): MaximizedPanels {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(MAXIMIZED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as MaximizedPanels
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveMaximizedPanels(maximizedPanels: MaximizedPanels) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MAXIMIZED_STORAGE_KEY, JSON.stringify(maximizedPanels))
}

function getInitialFloatingPanels(): FloatingPanels {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(FLOATING_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as FloatingPanels : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch { return {} }
}

function saveFloatingPanels(floatingPanels: FloatingPanels) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(floatingPanels))
}

function getInitialFloatingPositions(): FloatingPositions {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(FLOATING_POSITIONS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as FloatingPositions : {}
    return sanitizeFloatingPositions(parsed)
  } catch { return {} }
}

function saveFloatingPositions(positions: FloatingPositions) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(FLOATING_POSITIONS_STORAGE_KEY, JSON.stringify(positions))
}

function getInitialPopoutPanels(): PopoutPanels {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(POPOUT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as PopoutPanels : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch { return {} }
}

function savePopoutPanels(popoutPanels: PopoutPanels) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(POPOUT_STORAGE_KEY, JSON.stringify(popoutPanels))
}

function getInitialPopoutBounds(): PopoutBounds {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(POPOUT_BOUNDS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as PopoutBounds : {}
    return sanitizePopoutBounds(parsed)
  } catch { return {} }
}

function savePopoutBounds(popoutBounds: PopoutBounds) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(POPOUT_BOUNDS_STORAGE_KEY, JSON.stringify(popoutBounds))
}

function finiteOr(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function sanitizeFloatingPositions(raw: unknown): FloatingPositions {
  if (!raw || typeof raw !== "object") return {}
  const result: FloatingPositions = {}
  for (const [workspaceId, workspaceValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!workspaceValue || typeof workspaceValue !== "object") continue
    const positions: Record<string, FloatingPosition> = {}
    for (const [panelId, panelValue] of Object.entries(workspaceValue as Record<string, unknown>)) {
      if (!panelValue || typeof panelValue !== "object") continue
      const value = panelValue as Record<string, unknown>
      positions[panelId] = {
        x: Math.max(-2000, Math.min(20000, Math.round(finiteOr(value.x, 20)))),
        y: Math.max(-2000, Math.min(20000, Math.round(finiteOr(value.y, 20)))),
        zIndex: Math.max(1, Math.min(100000, Math.round(finiteOr(value.zIndex, 1)))),
        width: Math.max(320, Math.min(2400, Math.round(finiteOr(value.width, 520)))),
        height: Math.max(240, Math.min(1800, Math.round(finiteOr(value.height, 680)))),
      }
    }
    result[workspaceId] = positions
  }
  return result
}

function sanitizePopoutBounds(raw: unknown): PopoutBounds {
  if (!raw || typeof raw !== "object") return {}
  const result: PopoutBounds = {}
  for (const [workspaceId, workspaceValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!workspaceValue || typeof workspaceValue !== "object") continue
    const bounds: PopoutBounds[string] = {}
    for (const [panelId, panelValue] of Object.entries(workspaceValue as Record<string, unknown>)) {
      if (!panelValue || typeof panelValue !== "object") continue
      const value = panelValue as Record<string, unknown>
      bounds[panelId] = {
        x: Math.max(-2000, Math.min(20000, Math.round(finiteOr(value.x, 80)))),
        y: Math.max(-2000, Math.min(20000, Math.round(finiteOr(value.y, 80)))),
        width: Math.max(560, Math.min(3000, Math.round(finiteOr(value.width, 1100)))),
        height: Math.max(360, Math.min(2200, Math.round(finiteOr(value.height, 760)))),
        maximized: value.maximized === true,
      }
    }
    result[workspaceId] = bounds
  }
  return result
}

function getInitialLayoutPresets(): WorkspaceLayoutPreset[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(LAYOUT_PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as VersionedLayoutPresetsStorage | Array<WorkspaceLayoutPreset & { workspaceId?: string }>
    const rawPresets = Array.isArray(parsed) ? parsed : parsed.presets
    if (!Array.isArray(rawPresets)) return []
    const presets = rawPresets
      .map(preset => {
        const sanitized = sanitizeLayoutNode(preset?.layout)
        if (!sanitized) return null
        return {
          id: typeof preset.id === "string" && preset.id ? preset.id : createId("layout_"),
          name: typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : "未命名布局",
          layout: normalizeLayoutNode(sanitized),
          createdAt: typeof preset.createdAt === "string" && preset.createdAt ? preset.createdAt : new Date().toISOString(),
        } satisfies WorkspaceLayoutPreset
      })
      .filter(Boolean) as WorkspaceLayoutPreset[]
    saveLayoutPresets(presets)
    return presets
  } catch {
    return []
  }
}

function saveLayoutPresets(presets: WorkspaceLayoutPreset[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify({
    version: LAYOUT_PRESETS_STORAGE_VERSION,
    presets,
  } satisfies VersionedLayoutPresetsStorage))
}

function updateLayoutNode(
  node: WorkspaceLayoutNode,
  targetId: string,
  updater: (node: WorkspaceLayoutNode) => WorkspaceLayoutNode
): WorkspaceLayoutNode {
  if (node.id === targetId) return updater(node)
  if (node.kind === "panel") return node
  return {
    ...node,
    first: updateLayoutNode(node.first, targetId, updater),
    second: updateLayoutNode(node.second, targetId, updater),
  }
}

function removePanelNode(node: WorkspaceLayoutNode, panelId: string): WorkspaceLayoutNode | null {
  if (node.kind === "panel") {
    return node.id === panelId ? null : node
  }
  const first = removePanelNode(node.first, panelId)
  const second = removePanelNode(node.second, panelId)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

function mergePanelRects(
  panelId: string,
  targetPanelId: string,
  side: MergeSide,
  rects: WorkspacePanelRect[]
): WorkspacePanelRect[] | null {
  const source = rects.find(rect => rect.id === panelId)
  const target = rects.find(rect => rect.id === targetPanelId)
  if (!source || !target || source.id === target.id) return null

  const epsilon = 0.015
  const nextRects = rects.filter(rect => rect.id !== source.id && rect.id !== target.id)
  const targetPieces: WorkspacePanelRect[] = []
  const addPiece = (piece: WorkspacePanelRect) => {
    if (piece.right - piece.left > epsilon && piece.bottom - piece.top > epsilon) targetPieces.push(piece)
  }

  if (side === "left" || side === "right") {
    const touch = side === "right" ? Math.abs(source.right - target.left) : Math.abs(source.left - target.right)
    if (touch > epsilon || source.top < target.top - epsilon || source.bottom > target.bottom + epsilon) return null
    const mergedSource: WorkspacePanelRect = {
      ...source,
      left: side === "left" ? target.left : source.left,
      right: side === "right" ? target.right : source.right,
    }
    addPiece({ ...target, id: target.id, top: target.top, bottom: source.top })
    addPiece({ ...target, id: createId("panel_"), top: source.bottom, bottom: target.bottom })
    return [...nextRects, mergedSource, ...targetPieces]
  }

  const touch = side === "down" ? Math.abs(source.bottom - target.top) : Math.abs(source.top - target.bottom)
  if (touch > epsilon || source.left < target.left - epsilon || source.right > target.right + epsilon) return null
  const mergedSource: WorkspacePanelRect = {
    ...source,
    top: side === "up" ? target.top : source.top,
    bottom: side === "down" ? target.bottom : source.bottom,
  }
  addPiece({ ...target, id: target.id, left: target.left, right: source.left })
  addPiece({ ...target, id: createId("panel_"), left: source.right, right: target.right })
  return [...nextRects, mergedSource, ...targetPieces]
}

function buildLayoutFromRects(rects: WorkspacePanelRect[]): WorkspaceLayoutNode | null {
  return buildLayoutInBounds(rects, { left: 0, top: 0, right: 1, bottom: 1 })
}

function buildLayoutInBounds(
  rects: WorkspacePanelRect[],
  bounds: Pick<WorkspacePanelRect, "left" | "top" | "right" | "bottom">
): WorkspaceLayoutNode | null {
  const epsilon = 0.006
  if (rects.length === 0) return null
  if (rects.length === 1) return { kind: "panel", id: rects[0].id, type: rects[0].type }

  const xCuts = uniqueSorted(rects.flatMap(rect => [rect.left, rect.right]))
    .filter(x => x > bounds.left + epsilon && x < bounds.right - epsilon)
  for (const x of xCuts) {
    if (rects.some(rect => rect.left < x - epsilon && rect.right > x + epsilon)) continue
    const firstRects = rects.filter(rect => rect.right <= x + epsilon)
    const secondRects = rects.filter(rect => rect.left >= x - epsilon)
    if (firstRects.length === 0 || secondRects.length === 0 || firstRects.length + secondRects.length !== rects.length) continue
    const first = buildLayoutInBounds(firstRects, { ...bounds, right: x })
    const second = buildLayoutInBounds(secondRects, { ...bounds, left: x })
    if (first && second) {
      return {
        kind: "split",
        id: createId("split_"),
        direction: "horizontal",
        ratio: clampRatio((x - bounds.left) / (bounds.right - bounds.left)),
        first,
        second,
      }
    }
  }

  const yCuts = uniqueSorted(rects.flatMap(rect => [rect.top, rect.bottom]))
    .filter(y => y > bounds.top + epsilon && y < bounds.bottom - epsilon)
  for (const y of yCuts) {
    if (rects.some(rect => rect.top < y - epsilon && rect.bottom > y + epsilon)) continue
    const firstRects = rects.filter(rect => rect.bottom <= y + epsilon)
    const secondRects = rects.filter(rect => rect.top >= y - epsilon)
    if (firstRects.length === 0 || secondRects.length === 0 || firstRects.length + secondRects.length !== rects.length) continue
    const first = buildLayoutInBounds(firstRects, { ...bounds, bottom: y })
    const second = buildLayoutInBounds(secondRects, { ...bounds, top: y })
    if (first && second) {
      return {
        kind: "split",
        id: createId("split_"),
        direction: "vertical",
        ratio: clampRatio((y - bounds.top) / (bounds.bottom - bounds.top)),
        first,
        second,
      }
    }
  }

  return null
}

function uniqueSorted(values: number[]) {
  const epsilon = 0.003
  return values
    .map(value => Math.min(1, Math.max(0, value)))
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > epsilon)
}

function normalizeLayoutNode(node: WorkspaceLayoutNode): WorkspaceLayoutNode {
  if (node.kind === "panel") {
    const tabs = normalizePanelTabs(node)
    return {
      ...node,
      tabs,
      activeTabId: node.activeTabId && tabs.some(tab => tab.id === node.activeTabId) ? node.activeTabId : tabs[0]?.id,
      type: tabs.find(tab => tab.id === (node.activeTabId || tabs[0]?.id))?.type || node.type,
    }
  }
  return {
    ...node,
    ratio: clampRatio(node.ratio),
    first: normalizeLayoutNode(node.first),
    second: normalizeLayoutNode(node.second),
  }
}

export function normalizePanelTabs(node: Extract<WorkspaceLayoutNode, { kind: "panel" }>): WorkspaceTab[] {
  const tabs = Array.isArray(node.tabs) && node.tabs.length ? node.tabs : [{ id: node.id, type: node.type }]
  return tabs.map(tab => ({
    id: typeof tab.id === "string" && tab.id ? tab.id : node.id,
    type: normalizePersistedPanelType(tab.type) || node.type,
    ...(tab.mode ? { mode: tab.mode } : {}),
  }))
}

function removeTabFromLayout(node: WorkspaceLayoutNode, panelId: string, tabId: string): WorkspaceLayoutNode {
  if (node.kind === "panel") {
    if (node.id !== panelId) return node
    const tabs = normalizePanelTabs(node)
    if (tabs.length <= 1) return node
    const remaining = tabs.filter(tab => tab.id !== tabId)
    const nextActive = remaining.find(tab => tab.id === node.activeTabId) || remaining[0]
    return { ...node, tabs: remaining, activeTabId: nextActive.id, type: nextActive.type }
  }
  return { ...node, first: removeTabFromLayout(node.first, panelId, tabId), second: removeTabFromLayout(node.second, panelId, tabId) }
}

export function findPanelNode(
  node: WorkspaceLayoutNode,
  panelId: string
): Extract<WorkspaceLayoutNode, { kind: "panel" }> | null {
  if (node.kind === "panel") return node.id === panelId ? node : null
  return findPanelNode(node.first, panelId) || findPanelNode(node.second, panelId)
}

function clampRatio(ratio: unknown, fallback = 0.5) {
  const value = typeof ratio === "number" ? ratio : Number(ratio)
  if (!Number.isFinite(value)) return fallback
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value))
}

const INITIAL_WORKSPACES = getInitialWorkspaces()

export function createWorkspacePersistenceDocument(state = useWorkspaceStore.getState()): WorkspacePersistenceDocument {
  const semanticDocuments: Record<string, WorkspaceDocument> = {}
  for (const workspace of state.workspaces) {
    const positions = state.floatingPositions[workspace.id] || {}
    const options: WorkspaceDocumentOptions = {
      floatingPanels: state.floatingPanels[workspace.id] || [],
      floatingPositions: positions,
      popoutPanels: state.popoutPanels[workspace.id] || [],
      popoutBounds: state.popoutBounds[workspace.id] || {},
      maximizedPanelId: state.maximizedPanels[workspace.id] || null,
      presets: state.layoutPresets.map(preset => ({ id: preset.id, name: preset.name, root: workspaceDocumentFromLegacy(workspace.id, preset.layout).root, createdAt: preset.createdAt })),
    }
    semanticDocuments[workspace.id] = workspaceDocumentFromLegacy(workspace.id, state.getLayout(workspace.id), options)
  }
  return {
    version: 2,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces,
    layouts: state.layouts,
    maximizedPanels: state.maximizedPanels,
    floatingPanels: state.floatingPanels,
    floatingPositions: state.floatingPositions,
    popoutPanels: state.popoutPanels,
    popoutBounds: state.popoutBounds,
    layoutPresets: state.layoutPresets,
    semanticDocuments,
  }
}

function sanitizePersistenceDocument(raw: unknown): WorkspacePersistenceDocument {
  const value = raw && typeof raw === "object" ? raw as Partial<WorkspacePersistenceDocument> : {}
  const workspaces = mergeDefaultWorkspaces((Array.isArray(value.workspaces) ? value.workspaces : [])
    .map(sanitizeWorkspaceDefinition).filter(Boolean) as WorkspaceDefinition[])
  const layouts: WorkspaceLayouts = {}
  const rawLayouts = value.layouts && typeof value.layouts === "object" ? value.layouts : {}
  const semanticDocuments = value.semanticDocuments && typeof value.semanticDocuments === "object" ? value.semanticDocuments : {}
  for (const workspace of workspaces) {
    let rawLayout = (rawLayouts as WorkspaceLayouts)[workspace.id]
    if (!rawLayout && semanticDocuments[workspace.id] && typeof semanticDocuments[workspace.id] === "object") {
      try { rawLayout = workspaceDocumentToLegacy(normalizeWorkspaceDocument(semanticDocuments[workspace.id] as WorkspaceDocument)) as WorkspaceLayoutNode } catch {}
    }
    const sanitized = sanitizeLayoutNode(rawLayout)
    if (sanitized) layouts[workspace.id] = normalizedLegacyNode(sanitized)
  }
  const activeWorkspaceId = workspaces.some(item => item.id === value.activeWorkspaceId) ? value.activeWorkspaceId! : workspaces[0].id
  const maximizedPanels = value.maximizedPanels && typeof value.maximizedPanels === "object" ? value.maximizedPanels : {}
  const floatingPanels = value.floatingPanels && typeof value.floatingPanels === "object" ? value.floatingPanels : {}
  const floatingPositions = sanitizeFloatingPositions(value.floatingPositions)
  const popoutPanels = value.popoutPanels && typeof value.popoutPanels === "object" ? value.popoutPanels : {}
  const popoutBounds = sanitizePopoutBounds(value.popoutBounds)
  const layoutPresets = Array.isArray(value.layoutPresets) ? value.layoutPresets.map(preset => {
    const layout = sanitizeLayoutNode(preset?.layout)
    if (!layout) return null
    return {
      id: typeof preset.id === "string" && preset.id ? preset.id : createId("layout_"),
      name: typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : "未命名布局",
      layout: normalizedLegacyNode(layout),
      createdAt: typeof preset.createdAt === "string" ? preset.createdAt : new Date().toISOString(),
    }
  }).filter(Boolean) as WorkspaceLayoutPreset[] : []
  return { version: 2, activeWorkspaceId, workspaces, layouts, maximizedPanels, floatingPanels, floatingPositions, popoutPanels, popoutBounds, layoutPresets }
}

function normalizedLegacyNode(node: WorkspaceLayoutNode): WorkspaceLayoutNode {
  return normalizeLayoutNode(node)
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  hydrated: false,
  restoringPopouts: {},
  persistenceRevision: 0,
  persistenceError: null,
  activeWorkspaceId: getInitialWorkspaceId(INITIAL_WORKSPACES),
  workspaces: INITIAL_WORKSPACES,
  layouts: getInitialLayouts(INITIAL_WORKSPACES),
  maximizedPanels: getInitialMaximizedPanels(),
  floatingPanels: getInitialFloatingPanels(),
  floatingPositions: getInitialFloatingPositions(),
  popoutPanels: getInitialPopoutPanels(),
  popoutBounds: getInitialPopoutBounds(),
  layoutPresets: getInitialLayoutPresets(),
  setActiveWorkspace: (id) => {
    if (!get().workspaces.some(w => w.id === id)) return
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id)
    set({ activeWorkspaceId: id })
  },
  createWorkspace: () => {
    const workspaceId = createId("workspace_")
    const customCount = get().workspaces.filter(workspace => workspace.id.startsWith("workspace_")).length
    const workspace: WorkspaceDefinition = {
      id: workspaceId,
      title: `布局 ${customCount + 1}`,
      slots: WORKSPACES[0].slots,
    }
    const nextWorkspaces = [...get().workspaces, workspace]
    const nextLayouts = {
      ...get().layouts,
      [workspaceId]: createDefaultLayout(workspace),
    }
    saveWorkspaces(nextWorkspaces)
    saveLayouts(nextLayouts)
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, workspaceId)
    set({ workspaces: nextWorkspaces, layouts: nextLayouts, activeWorkspaceId: workspaceId })
  },
  duplicateWorkspace: (sourceWorkspaceId) => {
    const sourceId = sourceWorkspaceId || get().activeWorkspaceId
    const source = get().workspaces.find(workspace => workspace.id === sourceId)
    if (!source) return
    const workspaceId = createId("workspace_")
    const customCount = get().workspaces.filter(workspace => workspace.id.startsWith("workspace_")).length
    const workspace: WorkspaceDefinition = { ...source, id: workspaceId, title: source.title + " 副本 " + (customCount + 1) }
    const nextWorkspaces = [...get().workspaces, workspace]
    const nextLayouts = { ...get().layouts, [workspaceId]: normalizeLayoutNode(JSON.parse(JSON.stringify(get().getLayout(sourceId))) as WorkspaceLayoutNode) }
    const nextMaximized = { ...get().maximizedPanels, [workspaceId]: null }
    const nextFloating = { ...get().floatingPanels, [workspaceId]: [] }
    const nextPopouts = { ...get().popoutPanels, [workspaceId]: [] }
    const nextBounds = { ...get().popoutBounds, [workspaceId]: {} }
    saveWorkspaces(nextWorkspaces); saveLayouts(nextLayouts); saveMaximizedPanels(nextMaximized); saveFloatingPanels(nextFloating); savePopoutPanels(nextPopouts); savePopoutBounds(nextBounds)
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, workspaceId)
    set({ workspaces: nextWorkspaces, layouts: nextLayouts, maximizedPanels: nextMaximized, floatingPanels: nextFloating, popoutPanels: nextPopouts, popoutBounds: nextBounds, activeWorkspaceId: workspaceId })
  },
  deleteWorkspace: (workspaceId) => {
    const id = workspaceId || get().activeWorkspaceId
    if (!id.startsWith("workspace_")) return
    const nextWorkspaces = get().workspaces.filter(workspace => workspace.id !== id)
    if (nextWorkspaces.length === 0) return
    const nextLayouts = { ...get().layouts }; delete nextLayouts[id]
    const nextMaximized = { ...get().maximizedPanels }; delete nextMaximized[id]
    const nextFloating = { ...get().floatingPanels }; delete nextFloating[id]
    const nextPositions = { ...get().floatingPositions }; delete nextPositions[id]
    const nextPopouts = { ...get().popoutPanels }; delete nextPopouts[id]
    const nextBounds = { ...get().popoutBounds }; delete nextBounds[id]
    const activeWorkspaceId = id === get().activeWorkspaceId ? (nextWorkspaces.find(workspace => workspace.id === "compose")?.id || nextWorkspaces[0].id) : get().activeWorkspaceId
    saveWorkspaces(nextWorkspaces); saveLayouts(nextLayouts); saveMaximizedPanels(nextMaximized); saveFloatingPanels(nextFloating); saveFloatingPositions(nextPositions); savePopoutPanels(nextPopouts); savePopoutBounds(nextBounds)
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, activeWorkspaceId)
    set({ workspaces: nextWorkspaces, layouts: nextLayouts, maximizedPanels: nextMaximized, floatingPanels: nextFloating, floatingPositions: nextPositions, popoutPanels: nextPopouts, popoutBounds: nextBounds, activeWorkspaceId })
  },
  renameWorkspace: (id, title) => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    const nextWorkspaces = get().workspaces.map(workspace =>
      workspace.id === id ? { ...workspace, title: trimmedTitle } : workspace
    )
    saveWorkspaces(nextWorkspaces)
    set({ workspaces: nextWorkspaces })
  },
  setPanelType: (workspaceId, panelId, type) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = normalizeLayoutNode(updateLayoutNode(layout, panelId, node =>
      node.kind === "panel"
        ? { ...node, type, tabs: normalizePanelTabs(node).map(tab => tab.id === (node.activeTabId || node.id) ? { ...tab, type } : tab) }
        : node
    ))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
  },
  addTab: (workspaceId, panelId, type) => {
    const layout = get().getLayout(workspaceId)
    let tabId: string | null = null
    const nextLayout = normalizeLayoutNode(updateLayoutNode(layout, panelId, node => {
      if (node.kind !== "panel") return node
      tabId = createId("tab_")
      const tabs = normalizePanelTabs(node)
      return { ...node, tabs: [...tabs, { id: tabId, type }], activeTabId: tabId, type }
    }))
    if (!tabId) return null
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
    return tabId
  },
  setActiveTab: (workspaceId, panelId, tabId) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = normalizeLayoutNode(updateLayoutNode(layout, panelId, node => {
      if (node.kind !== "panel") return node
      const tabs = normalizePanelTabs(node)
      const active = tabs.find(tab => tab.id === tabId)
      return active ? { ...node, tabs, activeTabId: active.id, type: active.type } : node
    }))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
  },
  closeTab: (workspaceId, panelId, tabId) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = normalizeLayoutNode(removeTabFromLayout(layout, panelId, tabId))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
  },
  moveTab: (workspaceId, sourcePanelId, targetPanelId, tabId) => {
    if (sourcePanelId === targetPanelId) return false
    const layout = get().getLayout(workspaceId)
    const source = findPanelNode(layout, sourcePanelId)
    if (!source) return false
    const sourceTabs = normalizePanelTabs(source)
    const moved = sourceTabs.find(tab => tab.id === tabId)
    if (!moved || sourceTabs.length <= 1) return false
    const withoutSource = removeTabFromLayout(layout, sourcePanelId, tabId)
    const nextLayout = normalizeLayoutNode(updateLayoutNode(withoutSource, targetPanelId, node => {
      if (node.kind !== "panel") return node
      const tabs = normalizePanelTabs(node)
      return { ...node, tabs: [...tabs, moved], activeTabId: moved.id, type: moved.type }
    }))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
    return true
  },
  splitPanel: (workspaceId, panelId, direction, type, placement = "after", ratio = 0.5) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = normalizeLayoutNode(updateLayoutNode(layout, panelId, node => {
      if (node.kind !== "panel") return node
      const newPanel: WorkspaceLayoutNode = {
        kind: "panel",
        id: createId("panel_"),
        type: type || node.type,
      }
      return {
        kind: "split",
        id: createId("split_"),
        direction,
        ratio: clampRatio(ratio),
        first: placement === "before" ? newPanel : node,
        second: placement === "before" ? node : newPanel,
      }
    }))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next, maximizedPanels: { ...get().maximizedPanels, [workspaceId]: null } })
    saveMaximizedPanels({ ...get().maximizedPanels, [workspaceId]: null })
  },
  mergePanelByRects: (workspaceId, panelId, targetPanelId, side, rects) => {
    const nextRects = mergePanelRects(panelId, targetPanelId, side, rects)
    if (!nextRects) return false
    const nextLayout = buildLayoutFromRects(nextRects)
    if (!nextLayout) return false
    const nextLayouts = { ...get().layouts, [workspaceId]: normalizeLayoutNode(nextLayout) }
    const nextMaximized = { ...get().maximizedPanels, [workspaceId]: null }
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
    return true
  },
  closePanel: (workspaceId, panelId) => {
    const layout = get().getLayout(workspaceId)
    if (layout.kind === "panel" && layout.id === panelId) return
    const nextLayout = removePanelNode(layout, panelId)
    if (!nextLayout) return
    const nextLayouts = { ...get().layouts, [workspaceId]: normalizeLayoutNode(nextLayout) }
    const nextMaximized = { ...get().maximizedPanels }
    if (nextMaximized[workspaceId] === panelId) nextMaximized[workspaceId] = null
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  setSplitRatio: (workspaceId, splitId, ratio) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = normalizeLayoutNode(updateLayoutNode(layout, splitId, node =>
      node.kind === "split" ? { ...node, ratio: clampRatio(ratio) } : node
    ))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
  },
  setMaximizedPanel: (workspaceId, panelId) => {
    const next = { ...get().maximizedPanels, [workspaceId]: panelId }
    saveMaximizedPanels(next)
    set({ maximizedPanels: next })
  },
  setFloatingPanel: (workspaceId, panelId, floating) => {
    const current = get().floatingPanels[workspaceId] || []
    const nextIds = floating ? Array.from(new Set([...current, panelId])) : current.filter(id => id !== panelId)
    const next = { ...get().floatingPanels, [workspaceId]: nextIds }
    const currentPopouts = get().popoutPanels[workspaceId] || []
    const nextPopouts = floating ? currentPopouts.filter(id => id !== panelId) : currentPopouts
    saveFloatingPanels(next)
    savePopoutPanels({ ...get().popoutPanels, [workspaceId]: nextPopouts })
    set({ floatingPanels: next, popoutPanels: { ...get().popoutPanels, [workspaceId]: nextPopouts } })
  },
  setFloatingPanelPosition: (workspaceId, panelId, position) => {
    const current = get().floatingPositions[workspaceId] || {}
    const currentMax = Math.max(0, ...Object.values(current).map(item => item.zIndex || 0))
    const next = {
      ...get().floatingPositions,
      [workspaceId]: {
        ...current,
        [panelId]: { ...current[panelId], x: Math.round(position.x), y: Math.round(position.y), zIndex: currentMax + 1 },
      },
    }
    saveFloatingPositions(next)
    set({ floatingPositions: next })
  },
  setFloatingPanelSize: (workspaceId, panelId, size) => {
    const current = get().floatingPositions[workspaceId] || {}
    const existing = current[panelId] || { x: 20, y: 20, zIndex: 1 }
    const next = { ...get().floatingPositions, [workspaceId]: { ...current, [panelId]: { ...existing, width: Math.min(2400, Math.max(320, Math.round(size.width))), height: Math.min(1800, Math.max(240, Math.round(size.height))) } } }
    saveFloatingPositions(next)
    set({ floatingPositions: next })
  },
  focusFloatingPanel: (workspaceId, panelId) => {
    const current = get().floatingPositions[workspaceId] || {}
    const currentMax = Math.max(0, ...Object.values(current).map(item => item.zIndex || 0))
    const existing = current[panelId] || { x: 20, y: 20, zIndex: 0 }
    const next = { ...get().floatingPositions, [workspaceId]: { ...current, [panelId]: { ...existing, zIndex: currentMax + 1 } } }
    saveFloatingPositions(next)
    set({ floatingPositions: next })
  },
  setPopoutPanel: (workspaceId, panelId, open) => {
    const current = get().popoutPanels[workspaceId] || []
    const nextIds = open ? Array.from(new Set([...current, panelId])) : current.filter(id => id !== panelId)
    const next = { ...get().popoutPanels, [workspaceId]: nextIds }
    const currentFloating = get().floatingPanels[workspaceId] || []
    const nextFloating = open ? currentFloating.filter(id => id !== panelId) : currentFloating
    savePopoutPanels(next)
    saveFloatingPanels({ ...get().floatingPanels, [workspaceId]: nextFloating })
    set({ popoutPanels: next, floatingPanels: { ...get().floatingPanels, [workspaceId]: nextFloating } })
  },
  setPopoutBounds: (workspaceId, panelId, bounds) => {
    const next = { ...get().popoutBounds, [workspaceId]: { ...(get().popoutBounds[workspaceId] || {}), [panelId]: { ...bounds, x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.min(3000, Math.max(560, Math.round(bounds.width))), height: Math.min(2200, Math.max(360, Math.round(bounds.height))) } } }
    savePopoutBounds(next)
    set({ popoutBounds: next })
  },
  resetWorkspace: () => {
    const { activeWorkspaceId, layouts, maximizedPanels, floatingPanels, floatingPositions, popoutPanels, popoutBounds } = get()
    const nextLayouts = { ...layouts }
    const nextMaximized = { ...maximizedPanels }
    delete nextLayouts[activeWorkspaceId]
    delete nextMaximized[activeWorkspaceId]
    const nextFloating = { ...floatingPanels }; delete nextFloating[activeWorkspaceId]
    const nextPositions = { ...floatingPositions }; delete nextPositions[activeWorkspaceId]
    const nextPopouts = { ...popoutPanels }; delete nextPopouts[activeWorkspaceId]
    const nextBounds = { ...popoutBounds }; delete nextBounds[activeWorkspaceId]
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    saveFloatingPanels(nextFloating); saveFloatingPositions(nextPositions); savePopoutPanels(nextPopouts); savePopoutBounds(nextBounds)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized, floatingPanels: nextFloating, floatingPositions: nextPositions, popoutPanels: nextPopouts, popoutBounds: nextBounds })
  },
  resetAllWorkspaces: () => {
    saveLayouts({})
    saveMaximizedPanels({})
    saveFloatingPanels({}); saveFloatingPositions({}); savePopoutPanels({}); savePopoutBounds({})
    set({ layouts: {}, maximizedPanels: {}, floatingPanels: {}, floatingPositions: {}, popoutPanels: {}, popoutBounds: {} })
  },
  copyWorkspaceLayout: (sourceWorkspaceId, targetWorkspaceId) => {
    if (!get().workspaces.some(w => w.id === sourceWorkspaceId) || !get().workspaces.some(w => w.id === targetWorkspaceId)) return
    const sourceLayout = get().getLayout(sourceWorkspaceId)
    const copiedLayout = normalizeLayoutNode(JSON.parse(JSON.stringify(sourceLayout)) as WorkspaceLayoutNode)
    const nextLayouts = { ...get().layouts, [targetWorkspaceId]: copiedLayout }
    const nextMaximized = { ...get().maximizedPanels, [targetWorkspaceId]: null }
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  saveCurrentWorkspaceLayout: () => {
    const { activeWorkspaceId } = get()
    const nextLayouts = {
      ...get().layouts,
      [activeWorkspaceId]: normalizeLayoutNode(JSON.parse(JSON.stringify(get().getLayout(activeWorkspaceId))) as WorkspaceLayoutNode),
    }
    saveLayouts(nextLayouts)
    set({ layouts: nextLayouts })
  },
  exportCurrentWorkspace: async () => {
    if (typeof window === "undefined" || !window.api?.dialog) return false
    const state = get()
    const workspaceId = state.activeWorkspaceId
    const payload = {
      format: "grimoire-workspace-layout",
      version: 1,
      workspace: state.workspaces.find(workspace => workspace.id === workspaceId),
      layout: state.getLayout(workspaceId),
      floatingPanels: state.floatingPanels[workspaceId] || [],
      floatingPositions: state.floatingPositions[workspaceId] || {},
      popoutPanels: state.popoutPanels[workspaceId] || [],
      popoutBounds: state.popoutBounds[workspaceId] || {},
    }
    return window.api.dialog.save(JSON.stringify(payload, null, 2), "grimoire-workspace-layout.json")
  },
  importWorkspace: async () => {
    if (typeof window === "undefined" || !window.api?.dialog) return false
    const text = await window.api.dialog.open()
    if (!text) return false
    try {
      const value = JSON.parse(text) as { format?: string; workspace?: WorkspaceDefinition; layout?: unknown; floatingPanels?: string[]; floatingPositions?: FloatingPositions[string]; popoutPanels?: string[]; popoutBounds?: PopoutBounds[string] }
      const layout = sanitizeLayoutNode(value.layout)
      if (!layout) throw new Error("布局文件中没有有效的布局树")
      const source = value.workspace
      const workspaceId = createId("workspace_")
      const workspace: WorkspaceDefinition = { id: workspaceId, title: source?.title?.trim() ? source.title.trim() + " 导入" : "导入布局", slots: WORKSPACES[0].slots }
      const nextWorkspaces = [...get().workspaces, workspace]
      const nextLayouts = { ...get().layouts, [workspaceId]: normalizeLayoutNode(layout) }
      const nextFloating = { ...get().floatingPanels, [workspaceId]: Array.isArray(value.floatingPanels) ? value.floatingPanels : [] }
      const nextPositions = { ...get().floatingPositions, [workspaceId]: value.floatingPositions && typeof value.floatingPositions === "object" ? value.floatingPositions : {} }
      const nextPopouts = { ...get().popoutPanels, [workspaceId]: Array.isArray(value.popoutPanels) ? value.popoutPanels : [] }
      const nextBounds = { ...get().popoutBounds, [workspaceId]: value.popoutBounds && typeof value.popoutBounds === "object" ? value.popoutBounds : {} }
      saveWorkspaces(nextWorkspaces); saveLayouts(nextLayouts); saveFloatingPanels(nextFloating); saveFloatingPositions(nextPositions); savePopoutPanels(nextPopouts); savePopoutBounds(nextBounds)
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, workspaceId)
      set({ workspaces: nextWorkspaces, layouts: nextLayouts, floatingPanels: nextFloating, floatingPositions: nextPositions, popoutPanels: nextPopouts, popoutBounds: nextBounds, activeWorkspaceId: workspaceId })
      return true
    } catch (error) {
      window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message: "布局导入失败：" + (error instanceof Error ? error.message : String(error)), type: "error" } }))
      return false
    }
  },
  saveCurrentLayoutPreset: (name) => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const { activeWorkspaceId, layoutPresets } = get()
    const layout = normalizeLayoutNode(JSON.parse(JSON.stringify(get().getLayout(activeWorkspaceId))) as WorkspaceLayoutNode)
    const preset: WorkspaceLayoutPreset = {
      id: createId("layout_"),
      name: trimmedName,
      layout,
      createdAt: new Date().toISOString(),
    }
    const nextPresets = [preset, ...layoutPresets].slice(0, 30)
    saveLayoutPresets(nextPresets)
    set({ layoutPresets: nextPresets })
  },
  applyLayoutPresetToCurrentWorkspace: (presetId) => {
    const preset = get().layoutPresets.find(item => item.id === presetId)
    if (!preset) return
    const { activeWorkspaceId } = get()
    const nextLayouts = {
      ...get().layouts,
      [activeWorkspaceId]: normalizeLayoutNode(JSON.parse(JSON.stringify(preset.layout)) as WorkspaceLayoutNode),
    }
    const nextMaximized = { ...get().maximizedPanels, [activeWorkspaceId]: null }
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  deleteLayoutPreset: (presetId) => {
    const nextPresets = get().layoutPresets.filter(item => item.id !== presetId)
    saveLayoutPresets(nextPresets)
    set({ layoutPresets: nextPresets })
  },
  getLayout: (workspaceId) => {
    const workspace = get().workspaces.find(item => item.id === workspaceId)
    return get().layouts[workspaceId] || createDefaultLayout(workspace || WORKSPACES[0])
  },
  getWorkspaceDocument: (workspaceId) => {
    const id = workspaceId || get().activeWorkspaceId
    const state = get()
    return workspaceDocumentFromLegacy(id, state.getLayout(id), {
      floatingPanels: state.floatingPanels[id] || [],
      floatingPositions: state.floatingPositions[id] || {},
      popoutPanels: state.popoutPanels[id] || [],
      popoutBounds: state.popoutBounds[id] || {},
      maximizedPanelId: state.maximizedPanels[id] || null,
      presets: state.layoutPresets.map(preset => ({ id: preset.id, name: preset.name, root: workspaceDocumentFromLegacy(id, preset.layout).root, createdAt: preset.createdAt })),
    })
  },
  applyWorkspaceDocument: (document) => {
    const normalized = normalizeWorkspaceDocument(document)
    const workspaceId = normalized.workspaceId
    if (!get().workspaces.some(workspace => workspace.id === workspaceId)) return
    const layout = normalizeLayoutNode(workspaceDocumentToLegacy(normalized) as WorkspaceLayoutNode)
    const floatingIds = new Set<string>()
    const floatingPositions: Record<string, FloatingPosition> = {}
    for (const group of normalized.floatingGroups || []) {
      const panelIds = new Set<string>()
      for (const editorId of group.editorIds) {
        const areaId = normalized.editors[editorId]?.areaId
        const area = areaId ? normalized.areas[areaId] : undefined
        if (area?.panelId) panelIds.add(area.panelId)
      }
      for (const panelId of panelIds) {
        floatingIds.add(panelId)
        floatingPositions[panelId] = { x: group.x, y: group.y, width: group.width, height: group.height, zIndex: group.zIndex }
      }
    }
    const popoutIds = new Set<string>()
    const popoutBounds: PopoutBounds[string] = {}
    for (const popout of normalized.popouts || []) {
      for (const editorId of popout.editorIds) {
        const areaId = normalized.editors[editorId]?.areaId
        const area = areaId ? normalized.areas[areaId] : undefined
        if (area?.panelId) {
          popoutIds.add(area.panelId)
          popoutBounds[area.panelId] = { x: popout.x, y: popout.y, width: popout.width, height: popout.height, maximized: popout.maximized }
        }
      }
    }
    const maximizedEditor = Object.values(normalized.editors).find(editor => editor.maximized)
    const maximizedArea = maximizedEditor?.areaId ? normalized.areas[maximizedEditor.areaId] : undefined
    const nextLayouts = { ...get().layouts, [workspaceId]: layout }
    const nextMaximized = { ...get().maximizedPanels, [workspaceId]: maximizedArea?.panelId || null }
    const nextFloating = { ...get().floatingPanels, [workspaceId]: Array.from(floatingIds) }
    const nextPositions = { ...get().floatingPositions, [workspaceId]: floatingPositions }
    const nextPopouts = { ...get().popoutPanels, [workspaceId]: Array.from(popoutIds) }
    const nextBounds = { ...get().popoutBounds, [workspaceId]: popoutBounds }
    saveLayouts(nextLayouts); saveMaximizedPanels(nextMaximized); saveFloatingPanels(nextFloating); saveFloatingPositions(nextPositions); savePopoutPanels(nextPopouts); savePopoutBounds(nextBounds)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized, floatingPanels: nextFloating, floatingPositions: nextPositions, popoutPanels: nextPopouts, popoutBounds: nextBounds, activeWorkspaceId: workspaceId })
  },
  applyPersistenceDocument: (revision, document) => {
    const value = sanitizePersistenceDocument(document)
    saveWorkspaces(value.workspaces)
    saveLayouts(value.layouts)
    saveMaximizedPanels(value.maximizedPanels)
    saveFloatingPanels(value.floatingPanels)
    saveFloatingPositions(value.floatingPositions)
    savePopoutPanels(value.popoutPanels)
    savePopoutBounds(value.popoutBounds)
    saveLayoutPresets(value.layoutPresets)
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, value.activeWorkspaceId)
    set({ ...value, hydrated: true, persistenceRevision: revision, persistenceError: null })
  },
  setPersistenceRevision: (persistenceRevision) => set({ hydrated: true, persistenceRevision, persistenceError: null }),
  setPersistenceError: (persistenceError) => set({ persistenceError }),
  getMaximizedPanelId: (workspaceId) => get().maximizedPanels[workspaceId] || null,
  findPanel: (workspaceId, panelId) => findPanelNode(get().getLayout(workspaceId), panelId),
}))
