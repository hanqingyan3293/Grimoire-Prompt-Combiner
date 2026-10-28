// Single source of truth for panel types (M6 UI). The union used to be written here while the
// store kept a SECOND hardcoded list; a panel registered in one place and missing from the other
// was silently rewritten to `utility-sidebar` on reload. Now the store validates against this list.
export const PANEL_TYPES = [
  "tag-sidebar",
  "prompt-workbench",
  "utility-sidebar",
  "tag-tree",
  "favorites",
  "tag-cards",
  "prompt-editor",
  "output",
  "presets",
  "history",
  "images",
  "ai-assistant",
  "ai-chat",
  "ai-vision",
  "agent",
  "agent-sessions",
  "mcp",
  "settings",
  "errors",
  "logs",
  "provider-manager",
  "model-manager",
  "tasks",
  "wd14",
  "comfyui",
  "canvas",
  "prompt-assets",
  "tag-asset-manager",
  "tag-batch",
  "gallery-search",
  "novelai-workbench",
  "novelai-assets",
] as const

export type PanelType = (typeof PANEL_TYPES)[number]

export interface PanelDefinition {
  type: PanelType
  title: string
  description: string
  enabled: boolean
}
