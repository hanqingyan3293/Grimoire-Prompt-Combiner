import React, { Suspense, lazy } from "react"
import { LoaderCircle } from 'lucide-react'
import { Sidebar } from "../layout/Sidebar"
import { MainContent } from "../layout/MainContent"
import { RightPanel } from "../layout/RightPanel"
import { PresetsPanel } from "../presets/PresetsPanel"
import { HistoryPanel } from "../history/HistoryPanel"
import { ImagesPanel } from "../images/ImagesPanel"
import { QuickAIPanel, QuickSettingsPanel } from "../layout/QuickUtilityPopover"
import type { PanelDefinition, PanelType } from "./panelTypes"

const ChatLayout = lazy(() => import('../ai/ChatLayout').then(module => ({ default: module.ChatLayout })))
const AIVisionPanel = lazy(() => import('../ai/AIVisionPanel').then(module => ({ default: module.AIVisionPanel })))
const TasksPanel = lazy(() => import('../tasks/TasksPanel').then(module => ({ default: module.TasksPanel })))
const WD14Panel = lazy(() => import('../wd14/WD14Panel').then(module => ({ default: module.WD14Panel })))
const ComfyUIPanel = lazy(() => import('../comfy/ComfyUIPanel').then(module => ({ default: module.ComfyUIPanel })))
const CanvasPanel = lazy(() => import('../canvas/CanvasVendorPanel').then(module => ({ default: module.CanvasVendorPanel })))
const PromptAssetsPanel = lazy(() => import('../prompt-assets/PromptAssetsPanel').then(module => ({ default: module.PromptAssetsPanel })))

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
  "ai-assistant": { type: "ai-assistant", title: "AI 助手", description: "聊天和识图聚合面板", enabled: true },
  "ai-chat": { type: "ai-chat", title: "AI 聊天", description: "AI 对话面板", enabled: true },
  "ai-vision": { type: "ai-vision", title: "AI 识图", description: "图片识别和标签建议", enabled: true },
  settings: { type: "settings", title: "设置", description: "快捷主题、字体和界面密度设置", enabled: true },
  errors: { type: "errors", title: "错误", description: "错误日志", enabled: false },
  tasks: { type: "tasks", title: "任务队列", description: "后台反推和生成任务", enabled: true },
  wd14: { type: "wd14", title: "WD14 反推", description: "本地图片标签反推", enabled: true },
  comfyui: { type: "comfyui", title: "ComfyUI", description: "工作流、模型和生成任务", enabled: true },
  canvas: { type: "canvas", title: "无限画布", description: "图片、提示词和任务画布", enabled: true },
  "prompt-assets": { type: "prompt-assets", title: "提示词资产", description: "统一搜索迁移资产、历史、预设和收藏", enabled: true },
}

export const ENABLED_PANEL_OPTIONS = Object.values(PANEL_DEFINITIONS).filter(panel => panel.enabled)
export const PANEL_OPTION_GROUPS: { title: string; types: PanelType[] }[] = [
  { title: "核心", types: ["tag-sidebar", "prompt-workbench", "utility-sidebar"] },
  { title: "素材", types: ["prompt-assets", "presets", "history", "images"] },
  { title: "AI", types: ["ai-assistant", "ai-chat", "ai-vision"] },
  { title: "创作工具", types: ["canvas", "wd14", "comfyui", "tasks"] },
  { title: "设置", types: ["settings"] },
]

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
    case "ai-assistant":
      return <QuickAIPanel variant="embedded" />
    case "ai-chat":
      return <LazyPanel><ChatLayout /></LazyPanel>
    case "ai-vision":
      return <LazyPanel><AIVisionPanel /></LazyPanel>
    case "wd14":
      return <LazyPanel><WD14Panel /></LazyPanel>
    case "tasks":
      return <LazyPanel><TasksPanel /></LazyPanel>
    case "comfyui":
      return <LazyPanel><ComfyUIPanel /></LazyPanel>
    case "canvas":
      return <LazyPanel><CanvasPanel /></LazyPanel>
    case "prompt-assets":
      return <LazyPanel><PromptAssetsPanel /></LazyPanel>
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

function LazyPanel({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]"><LoaderCircle size={17} className="animate-spin" aria-hidden="true" /><span>正在载入面板</span></div>}>{children}</Suspense>
}

function ScrollablePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-auto bg-[var(--color-bg-secondary)]">
      {children}
    </div>
  )
}
