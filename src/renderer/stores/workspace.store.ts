import { create } from "zustand"
import type { PanelType } from "../components/workspace/panelTypes"

export interface WorkspaceSlot {
  id: string
  type: PanelType
  className: string
}

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
  setActiveWorkspace: (id: string) => void
  resetWorkspace: () => void
  getActiveWorkspace: () => WorkspaceDefinition
}

const STORAGE_KEY = "grimoire.activeWorkspace"

function getInitialWorkspaceId() {
  if (typeof window === "undefined") return "compose"
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return WORKSPACES.some(w => w.id === saved) ? saved! : "compose"
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspaceId: getInitialWorkspaceId(),
  setActiveWorkspace: (id) => {
    if (!WORKSPACES.some(w => w.id === id)) return
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id)
    set({ activeWorkspaceId: id })
  },
  resetWorkspace: () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY)
    set({ activeWorkspaceId: "compose" })
  },
  getActiveWorkspace: () => {
    const id = get().activeWorkspaceId
    return WORKSPACES.find(w => w.id === id) || WORKSPACES[0]
  },
}))

