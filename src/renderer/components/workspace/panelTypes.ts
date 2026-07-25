export type PanelType =
  | "tag-sidebar"
  | "prompt-workbench"
  | "utility-sidebar"
  | "tag-tree"
  | "favorites"
  | "tag-cards"
  | "prompt-editor"
  | "output"
  | "presets"
  | "history"
  | "images"
  | "ai-chat"
  | "ai-vision"
  | "settings"
  | "errors"

export interface PanelDefinition {
  type: PanelType
  title: string
  description: string
  enabled: boolean
}

