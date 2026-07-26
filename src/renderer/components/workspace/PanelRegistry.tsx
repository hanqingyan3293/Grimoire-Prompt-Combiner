import React from "react"
import { Sidebar } from "../layout/Sidebar"
import { MainContent } from "../layout/MainContent"
import { RightPanel } from "../layout/RightPanel"
import { PresetsPanel } from "../presets/PresetsPanel"
import { HistoryPanel } from "../history/HistoryPanel"
import { ImagesPanel } from "../images/ImagesPanel"
import { ChatLayout } from "../ai/ChatLayout"
import { AIVisionPanel } from "../ai/AIVisionPanel"
import { QuickSettingsPanel } from "../layout/QuickUtilityPopover"
import type { PanelDefinition, PanelType } from "./panelTypes"

export const PANEL_DEFINITIONS: Record<PanelType, PanelDefinition> = {
  "tag-sidebar": {
    type: "tag-sidebar",
    title: "标签侧栏",
    description: "当前标签库和收藏入口",
    enabled: true,
  },
  "prompt-workbench": {
    type: "prompt-workbench",
    title: "提示词工作区",
    description: "标签卡片、正负面提示词和输出",
    enabled: true,
  },
  "utility-sidebar": {
    type: "utility-sidebar",
    title: "工具侧栏",
    description: "预设、历史、图片和 AI 快捷面板",
    enabled: true,
  },
  "tag-tree": { type: "tag-tree", title: "标签树", description: "标签库树形浏览", enabled: false },
  favorites: { type: "favorites", title: "收藏", description: "收藏的子类和标签", enabled: false },
  "tag-cards": { type: "tag-cards", title: "标签卡片", description: "标签卡片选择区", enabled: false },
  "prompt-editor": { type: "prompt-editor", title: "提示词编辑", description: "正负面提示词编辑区", enabled: false },
  output: { type: "output", title: "输出", description: "最终提示词输出区", enabled: false },
  presets: { type: "presets", title: "预设", description: "提示词预设", enabled: true },
  history: { type: "history", title: "历史", description: "提示词历史记录", enabled: true },
  images: { type: "images", title: "图片", description: "参考图片", enabled: true },
  "ai-chat": { type: "ai-chat", title: "AI 聊天", description: "AI 对话面板", enabled: true },
  "ai-vision": { type: "ai-vision", title: "AI 识图", description: "图片识别和标签建议", enabled: true },
  settings: { type: "settings", title: "设置", description: "快捷主题、字体和界面密度设置", enabled: true },
  errors: { type: "errors", title: "错误", description: "错误日志", enabled: false },
}

export const ENABLED_PANEL_OPTIONS = Object.values(PANEL_DEFINITIONS).filter(panel => panel.enabled)

export function renderPanel(type: PanelType): React.ReactNode {
  switch (type) {
    case "tag-sidebar":
      return <Sidebar />
    case "prompt-workbench":
      return <MainContent />
    case "utility-sidebar":
      return <RightPanel />
    case "presets":
      return <ScrollablePanel><PresetsPanel /></ScrollablePanel>
    case "history":
      return <ScrollablePanel><HistoryPanel /></ScrollablePanel>
    case "images":
      return <ScrollablePanel><ImagesPanel /></ScrollablePanel>
    case "ai-chat":
      return <ChatLayout />
    case "ai-vision":
      return <AIVisionPanel />
    case "settings":
      return <ScrollablePanel><QuickSettingsPanel variant="embedded" /></ScrollablePanel>
    default:
      return (
        <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
          面板尚未接入
        </div>
      )
  }
}

function ScrollablePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-auto bg-[var(--color-bg-secondary)]">
      {children}
    </div>
  )
}
