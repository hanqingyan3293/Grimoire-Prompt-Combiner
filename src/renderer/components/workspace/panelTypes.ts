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
  | "ai-assistant"
  | "ai-chat"
  | "ai-vision"
  | "agent-sessions"
  | "mcp"
  | "settings"
  | "errors"
  | "tasks"
  | "wd14"
  | "comfyui"
  | "canvas"
  | "prompt-assets"
  | "tag-asset-manager"

export interface PanelDefinition {
  type: PanelType
  title: string
  description: string
  enabled: boolean
}
