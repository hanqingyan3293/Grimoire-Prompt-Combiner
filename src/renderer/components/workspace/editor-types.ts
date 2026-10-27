import type { PanelType } from "./panelTypes"

export type EditorRegionKind =
  | "header"
  | "toolbar"
  | "main"
  | "sidebar"
  | "asset"
  | "agent"
  | "task"
  | "inspector"
  | "footer"

export interface EditorRegionDefinition {
  id: string
  kind: EditorRegionKind
  title?: string
  defaultVisible?: boolean
}

export interface EditorStateKeyContext {
  workspaceId: string
  editorId: string
  type: PanelType
}

export interface EditorDefinition {
  type: PanelType
  title: string
  description: string
  category: string
  icon?: string
  defaultSize: { width?: number; height?: number }
  supportsSplit: boolean
  supportsTab: boolean
  supportsFloat: boolean
  supportsPopout: boolean
  supportsMultiple: boolean
  stateKeyFactory: (context: EditorStateKeyContext) => string
  regions: readonly EditorRegionDefinition[]
}

