import { create } from "zustand"
import type { PanelType } from "../components/workspace/panelTypes"

export interface WorkspaceSlot {
  id: string
  type: PanelType
  className: string
}

export type SplitDirection = "horizontal" | "vertical"
export type SplitPlacement = "before" | "after"
export type MergeSide = "left" | "right" | "up" | "down"

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
    }
  | {
      kind: "split"
      id: string
      direction: SplitDirection
      ratio: number
      first: WorkspaceLayoutNode
      second: WorkspaceLayoutNode
    }

type WorkspaceLayouts = Record<string, WorkspaceLayoutNode>
type MaximizedPanels = Record<string, string | null>
type VersionedLayoutsStorage = { version: number; layouts: WorkspaceLayouts }

export interface WorkspaceDefinition {
  id: string
  title: string
  slots: WorkspaceSlot[]
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
      { id: "ai-chat", type: "ai-chat", className: "flex-1" },
      { id: "right-sidebar", type: "utility-sidebar", className: "w-[320px] min-w-[320px]" },
    ],
  },
  {
    id: "vision",
    title: "识图",
    slots: [
      { id: "left-sidebar", type: "tag-sidebar", className: "w-[260px] min-w-[260px]" },
      { id: "ai-vision", type: "ai-vision", className: "flex-1" },
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
      { id: "presets", type: "presets", className: "w-[320px] min-w-[320px]" },
    ],
  },
]

interface WorkspaceState {
  activeWorkspaceId: string
  layouts: WorkspaceLayouts
  maximizedPanels: MaximizedPanels
  setActiveWorkspace: (id: string) => void
  setPanelType: (workspaceId: string, panelId: string, type: PanelType) => void
  splitPanel: (workspaceId: string, panelId: string, direction: SplitDirection, type?: PanelType, placement?: SplitPlacement, ratio?: number) => void
  mergePanelByRects: (workspaceId: string, panelId: string, targetPanelId: string, side: MergeSide, rects: WorkspacePanelRect[]) => boolean
  closePanel: (workspaceId: string, panelId: string) => void
  setSplitRatio: (workspaceId: string, splitId: string, ratio: number) => void
  setMaximizedPanel: (workspaceId: string, panelId: string | null) => void
  resetWorkspace: () => void
  resetAllWorkspaces: () => void
  copyWorkspaceLayout: (sourceWorkspaceId: string, targetWorkspaceId: string) => void
  getLayout: (workspaceId: string) => WorkspaceLayoutNode
  getMaximizedPanelId: (workspaceId: string) => string | null
  findPanel: (workspaceId: string, panelId: string) => Extract<WorkspaceLayoutNode, { kind: "panel" }> | null
}

const STORAGE_KEY = "grimoire.activeWorkspace"
const LAYOUTS_STORAGE_KEY = "grimoire.workspaceLayouts"
const MAXIMIZED_STORAGE_KEY = "grimoire.workspaceMaximizedPanels"
const LAYOUTS_STORAGE_VERSION = 2
const FALLBACK_PANEL_TYPE: PanelType = "utility-sidebar"
const VALID_PANEL_TYPES = new Set<PanelType>([
  "tag-sidebar",
  "prompt-workbench",
  "utility-sidebar",
  "presets",
  "history",
  "images",
  "ai-assistant",
  "ai-chat",
  "ai-vision",
  "settings",
])

const createId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10)

function getInitialWorkspaceId() {
  if (typeof window === "undefined") return "compose"
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return WORKSPACES.some(w => w.id === saved) ? saved! : "compose"
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

function getInitialLayouts(): WorkspaceLayouts {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(LAYOUTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as WorkspaceLayouts | VersionedLayoutsStorage
    const rawLayouts = "layouts" in parsed ? parsed.layouts : parsed
    if (!rawLayouts || typeof rawLayouts !== "object") return {}
    const layouts: WorkspaceLayouts = {}
    for (const workspace of WORKSPACES) {
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

function sanitizeLayoutNode(node: unknown): WorkspaceLayoutNode | null {
  if (!node || typeof node !== "object") return null
  const value = node as Partial<WorkspaceLayoutNode>
  if (value.kind === "panel") {
    return {
      kind: "panel",
      id: typeof value.id === "string" && value.id ? value.id : createId("panel_"),
      type: VALID_PANEL_TYPES.has(value.type as PanelType) ? value.type as PanelType : FALLBACK_PANEL_TYPE,
    }
  }
  if (value.kind === "split") {
    const first = sanitizeLayoutNode(value.first)
    const second = sanitizeLayoutNode(value.second)
    if (!first && !second) return null
    if (!first) return second
    if (!second) return first
    return {
      kind: "split",
      id: typeof value.id === "string" && value.id ? value.id : createId("split_"),
      direction: value.direction === "vertical" ? "vertical" : "horizontal",
      ratio: clampRatio(typeof value.ratio === "number" ? value.ratio : 0.5),
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
  if (node.kind === "panel") return node
  return {
    ...node,
    ratio: clampRatio(Number.isFinite(node.ratio) ? node.ratio : 0.5),
    first: normalizeLayoutNode(node.first),
    second: normalizeLayoutNode(node.second),
  }
}

export function findPanelNode(
  node: WorkspaceLayoutNode,
  panelId: string
): Extract<WorkspaceLayoutNode, { kind: "panel" }> | null {
  if (node.kind === "panel") return node.id === panelId ? node : null
  return findPanelNode(node.first, panelId) || findPanelNode(node.second, panelId)
}

function clampRatio(ratio: number) {
  return Math.min(0.88, Math.max(0.12, ratio))
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspaceId: getInitialWorkspaceId(),
  layouts: getInitialLayouts(),
  maximizedPanels: getInitialMaximizedPanels(),
  setActiveWorkspace: (id) => {
    if (!WORKSPACES.some(w => w.id === id)) return
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id)
    set({ activeWorkspaceId: id })
  },
  setPanelType: (workspaceId, panelId, type) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = normalizeLayoutNode(updateLayoutNode(layout, panelId, node =>
      node.kind === "panel" ? { ...node, type } : node
    ))
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
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
  resetWorkspace: () => {
    const { activeWorkspaceId, layouts, maximizedPanels } = get()
    const nextLayouts = { ...layouts }
    const nextMaximized = { ...maximizedPanels }
    delete nextLayouts[activeWorkspaceId]
    delete nextMaximized[activeWorkspaceId]
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  resetAllWorkspaces: () => {
    saveLayouts({})
    saveMaximizedPanels({})
    set({ layouts: {}, maximizedPanels: {} })
  },
  copyWorkspaceLayout: (sourceWorkspaceId, targetWorkspaceId) => {
    if (!WORKSPACES.some(w => w.id === sourceWorkspaceId) || !WORKSPACES.some(w => w.id === targetWorkspaceId)) return
    const sourceLayout = get().getLayout(sourceWorkspaceId)
    const copiedLayout = normalizeLayoutNode(JSON.parse(JSON.stringify(sourceLayout)) as WorkspaceLayoutNode)
    const nextLayouts = { ...get().layouts, [targetWorkspaceId]: copiedLayout }
    const nextMaximized = { ...get().maximizedPanels, [targetWorkspaceId]: null }
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  getLayout: (workspaceId) => get().layouts[workspaceId] || getDefaultLayout(workspaceId),
  getMaximizedPanelId: (workspaceId) => get().maximizedPanels[workspaceId] || null,
  findPanel: (workspaceId, panelId) => findPanelNode(get().getLayout(workspaceId), panelId),
}))
