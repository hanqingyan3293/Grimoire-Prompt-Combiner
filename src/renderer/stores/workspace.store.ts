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

type WorkspaceSlotOverrides = Record<string, Record<string, PanelType>>

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
  setActiveWorkspace: (id: string) => void
  setPanelWidths: (workspaceId: string, widths: WorkspacePanelWidths) => void
  setSlotPanelType: (workspaceId: string, slotId: string, type: PanelType) => void
  resetWorkspace: () => void
  getActiveWorkspace: () => WorkspaceDefinition
  getPanelWidths: (workspaceId: string) => WorkspacePanelWidths
}

const STORAGE_KEY = "grimoire.activeWorkspace"
const WIDTHS_STORAGE_KEY = "grimoire.workspaceWidths"
const OVERRIDES_STORAGE_KEY = "grimoire.workspaceSlotOverrides"
const DEFAULT_WIDTHS: WorkspacePanelWidths = { left: 260, right: 320 }

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

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspaceId: getInitialWorkspaceId(),
  panelWidths: getInitialWidths(),
  slotOverrides: getInitialOverrides(),
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
  resetWorkspace: () => {
    const { activeWorkspaceId, panelWidths, slotOverrides } = get()
    const nextWidths = { ...panelWidths }
    const nextOverrides = { ...slotOverrides }
    delete nextWidths[activeWorkspaceId]
    delete nextOverrides[activeWorkspaceId]
    saveWidths(nextWidths)
    saveOverrides(nextOverrides)
    set({ panelWidths: nextWidths, slotOverrides: nextOverrides })
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
}))
