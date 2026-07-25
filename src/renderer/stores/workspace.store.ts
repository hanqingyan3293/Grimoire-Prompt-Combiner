import { create } from "zustand"
import type { PanelType } from "../components/workspace/panelTypes"

export interface WorkspaceSlot {
  id: string
  type: PanelType
  className: string
}

export interface WorkspacePanelWidths {
  left: number
  right: number
}

export type SplitDirection = "horizontal" | "vertical"

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

type WorkspaceSlotOverrides = Record<string, Record<string, PanelType>>
type WorkspaceLayouts = Record<string, WorkspaceLayoutNode>
type MaximizedPanels = Record<string, string | null>

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
  panelWidths: Record<string, WorkspacePanelWidths>
  slotOverrides: WorkspaceSlotOverrides
  layouts: WorkspaceLayouts
  maximizedPanels: MaximizedPanels
  setActiveWorkspace: (id: string) => void
  setPanelWidths: (workspaceId: string, widths: WorkspacePanelWidths) => void
  setSlotPanelType: (workspaceId: string, slotId: string, type: PanelType) => void
  setPanelType: (workspaceId: string, panelId: string, type: PanelType) => void
  splitPanel: (workspaceId: string, panelId: string, direction: SplitDirection) => void
  closePanel: (workspaceId: string, panelId: string) => void
  setSplitRatio: (workspaceId: string, splitId: string, ratio: number) => void
  setMaximizedPanel: (workspaceId: string, panelId: string | null) => void
  resetWorkspace: () => void
  getActiveWorkspace: () => WorkspaceDefinition
  getPanelWidths: (workspaceId: string) => WorkspacePanelWidths
  getLayout: (workspaceId: string) => WorkspaceLayoutNode
  getMaximizedPanelId: (workspaceId: string) => string | null
  findPanel: (workspaceId: string, panelId: string) => Extract<WorkspaceLayoutNode, { kind: "panel" }> | null
}

const STORAGE_KEY = "grimoire.activeWorkspace"
const WIDTHS_STORAGE_KEY = "grimoire.workspaceWidths"
const OVERRIDES_STORAGE_KEY = "grimoire.workspaceSlotOverrides"
const LAYOUTS_STORAGE_KEY = "grimoire.workspaceLayouts"
const MAXIMIZED_STORAGE_KEY = "grimoire.workspaceMaximizedPanels"
const DEFAULT_WIDTHS: WorkspacePanelWidths = { left: 260, right: 320 }

const createId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 10)

function getInitialWorkspaceId() {
  if (typeof window === "undefined") return "compose"
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return WORKSPACES.some(w => w.id === saved) ? saved! : "compose"
}

function getInitialWidths(): Record<string, WorkspacePanelWidths> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(WIDTHS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, WorkspacePanelWidths>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveWidths(widths: Record<string, WorkspacePanelWidths>) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(widths))
}

function getInitialOverrides(): WorkspaceSlotOverrides {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(OVERRIDES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as WorkspaceSlotOverrides
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveOverrides(overrides: WorkspaceSlotOverrides) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides))
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

function getDefaultLayout(workspaceId: string): WorkspaceLayoutNode {
  const workspace = WORKSPACES.find(w => w.id === workspaceId) || WORKSPACES[0]
  return createDefaultLayout(workspace)
}

function getInitialLayouts(): WorkspaceLayouts {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(LAYOUTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as WorkspaceLayouts
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveLayouts(layouts: WorkspaceLayouts) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LAYOUTS_STORAGE_KEY, JSON.stringify(layouts))
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

function findPanelNode(
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
  panelWidths: getInitialWidths(),
  slotOverrides: getInitialOverrides(),
  layouts: getInitialLayouts(),
  maximizedPanels: getInitialMaximizedPanels(),
  setActiveWorkspace: (id) => {
    if (!WORKSPACES.some(w => w.id === id)) return
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id)
    set({ activeWorkspaceId: id })
  },
  setPanelWidths: (workspaceId, widths) => {
    const next = { ...get().panelWidths, [workspaceId]: widths }
    saveWidths(next)
    set({ panelWidths: next })
  },
  setSlotPanelType: (workspaceId, slotId, type) => {
    const next = {
      ...get().slotOverrides,
      [workspaceId]: {
        ...(get().slotOverrides[workspaceId] || {}),
        [slotId]: type,
      },
    }
    saveOverrides(next)
    set({ slotOverrides: next })
  },
  setPanelType: (workspaceId, panelId, type) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = updateLayoutNode(layout, panelId, node =>
      node.kind === "panel" ? { ...node, type } : node
    )
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next })
  },
  splitPanel: (workspaceId, panelId, direction) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = updateLayoutNode(layout, panelId, node => {
      if (node.kind !== "panel") return node
      return {
        kind: "split",
        id: createId("split_"),
        direction,
        ratio: 0.5,
        first: node,
        second: {
          kind: "panel",
          id: createId("panel_"),
          type: node.type,
        },
      }
    })
    const next = { ...get().layouts, [workspaceId]: nextLayout }
    saveLayouts(next)
    set({ layouts: next, maximizedPanels: { ...get().maximizedPanels, [workspaceId]: null } })
    saveMaximizedPanels({ ...get().maximizedPanels, [workspaceId]: null })
  },
  closePanel: (workspaceId, panelId) => {
    const layout = get().getLayout(workspaceId)
    if (layout.kind === "panel" && layout.id === panelId) return
    const nextLayout = removePanelNode(layout, panelId)
    if (!nextLayout) return
    const nextLayouts = { ...get().layouts, [workspaceId]: nextLayout }
    const nextMaximized = { ...get().maximizedPanels }
    if (nextMaximized[workspaceId] === panelId) nextMaximized[workspaceId] = null
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  setSplitRatio: (workspaceId, splitId, ratio) => {
    const layout = get().getLayout(workspaceId)
    const nextLayout = updateLayoutNode(layout, splitId, node =>
      node.kind === "split" ? { ...node, ratio: clampRatio(ratio) } : node
    )
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
    const { activeWorkspaceId, panelWidths, slotOverrides, layouts, maximizedPanels } = get()
    const nextWidths = { ...panelWidths }
    const nextOverrides = { ...slotOverrides }
    const nextLayouts = { ...layouts }
    const nextMaximized = { ...maximizedPanels }
    delete nextWidths[activeWorkspaceId]
    delete nextOverrides[activeWorkspaceId]
    delete nextLayouts[activeWorkspaceId]
    delete nextMaximized[activeWorkspaceId]
    saveWidths(nextWidths)
    saveOverrides(nextOverrides)
    saveLayouts(nextLayouts)
    saveMaximizedPanels(nextMaximized)
    set({ panelWidths: nextWidths, slotOverrides: nextOverrides, layouts: nextLayouts, maximizedPanels: nextMaximized })
  },
  getActiveWorkspace: () => {
    const id = get().activeWorkspaceId
    const base = WORKSPACES.find(w => w.id === id) || WORKSPACES[0]
    const overrides = get().slotOverrides[base.id] || {}
    return {
      ...base,
      slots: base.slots.map(slot => ({
        ...slot,
        type: overrides[slot.id] || slot.type,
      })),
    }
  },
  getPanelWidths: (workspaceId) => get().panelWidths[workspaceId] || DEFAULT_WIDTHS,
  getLayout: (workspaceId) => get().layouts[workspaceId] || getDefaultLayout(workspaceId),
  getMaximizedPanelId: (workspaceId) => get().maximizedPanels[workspaceId] || null,
  findPanel: (workspaceId, panelId) => findPanelNode(get().getLayout(workspaceId), panelId),
}))
