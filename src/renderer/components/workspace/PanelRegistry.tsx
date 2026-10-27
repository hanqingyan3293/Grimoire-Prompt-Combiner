import React, { Suspense, lazy } from "react"
import { LoaderCircle } from 'lucide-react'
import { Sidebar } from "../layout/Sidebar"
import { MainContent } from "../layout/MainContent"
import { RightPanel } from "../layout/RightPanel"
import { PresetsPanel } from "../presets/PresetsPanel"
import { HistoryPanel } from "../history/HistoryPanel"
import { ImagesPanel } from "../images/ImagesPanel"
import { QuickSettingsPanel } from "../layout/QuickUtilityPopover"
import { AgentWorkspacePanel } from "../ai/AgentWorkspacePanel"
import type { PanelDefinition, PanelType } from "./panelTypes"
import type { EditorDefinition, EditorRegionDefinition } from "./editor-types"
import { TagAssetManagerPanel } from "../tags/TagAssetManagerPanel"
import { TagBatchToolsPanel } from "../tags/TagBatchToolsPanel"
import { GallerySearchPanel } from "../gallery/GallerySearchPanel"
import { WorkspaceLogsPanel, WorkspaceModelManagerPanel, WorkspaceProviderManagerPanel } from "./WorkspaceSystemPanels"

const TasksPanel = lazy(() => import('../tasks/TasksPanel').then(module => ({ default: module.TasksPanel })))
const WD14Panel = lazy(() => import('../wd14/WD14Panel').then(module => ({ default: module.WD14Panel })))
const ComfyUIPanel = lazy(() => import('../comfy/ComfyUIPanel').then(module => ({ default: module.ComfyUIPanel })))
const CanvasPanel = lazy(() => import('../canvas/CanvasVendorPanel').then(module => ({ default: module.CanvasVendorPanel })))
const PromptAssetsPanel = lazy(() => import('../prompt-assets/PromptAssetsPanel').then(module => ({ default: module.PromptAssetsPanel })))
// The full settings surface as a panel (M1.5): same component the settings window uses,
// in embedded mode, so there is one implementation instead of a "quick settings" subset.
const SettingsPanel = lazy(() => import('../settings/SettingsWindow').then(module => ({ default: module.SettingsWindow })))

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
  presets: { type: "presets", title: "预设（兼容）", description: "已并入提示词资产", enabled: false },
  history: { type: "history", title: "历史", description: "提示词历史记录", enabled: true },
  images: { type: "images", title: "图片", description: "参考图片", enabled: true },
  agent: { type: "agent", title: "Agent 工作台", description: "对话、识图、绘图、画布、Session、MCP 和日志", enabled: true },
  "ai-assistant": { type: "ai-assistant", title: "AI 助手（兼容）", description: "旧版 AI 助手入口", enabled: false },
  "ai-chat": { type: "ai-chat", title: "AI 聊天（兼容）", description: "旧版 AI 聊天入口", enabled: false },
  "ai-vision": { type: "ai-vision", title: "AI 识图（兼容）", description: "旧版 AI 识图入口", enabled: false },
  "agent-sessions": { type: "agent-sessions", title: "Agent 会话（兼容）", description: "旧版 Agent 会话入口", enabled: false },
  mcp: { type: "mcp", title: "MCP 管理（兼容）", description: "旧版 MCP 管理入口", enabled: false },
  settings: { type: "settings", title: "设置", description: "快捷主题、字体和界面密度设置", enabled: true },
  errors: { type: "errors", title: "错误", description: "错误日志", enabled: false },
  logs: { type: "logs", title: "日志（兼容）", description: "统一 Agent 内的诊断日志", enabled: false },
  "provider-manager": { type: "provider-manager", title: "供应商（兼容）", description: "设置中的 Provider 管理", enabled: false },
  "model-manager": { type: "model-manager", title: "模型（兼容）", description: "设置中的模型管理", enabled: false },
  tasks: { type: "tasks", title: "任务队列", description: "后台反推和生成任务", enabled: true },
  wd14: { type: "wd14", title: "WD14 反推", description: "本地图片标签反推", enabled: true },
  comfyui: { type: "comfyui", title: "ComfyUI", description: "工作流、模型和生成任务", enabled: true },
  canvas: { type: "canvas", title: "无限画布", description: "图片、提示词和任务画布", enabled: true },
  "prompt-assets": { type: "prompt-assets", title: "提示词资产", description: "统一搜索资产、历史、预设和收藏", enabled: true },
  "tag-asset-manager": { type: "tag-asset-manager", title: "标签与资产", description: "标签关系、候选确认和资产标注", enabled: true },
  "tag-batch": { type: "tag-batch", title: "标签批量工具", description: "按筛选批量添加、删除、替换资产标签", enabled: true },
  "gallery-search": { type: "gallery-search", title: "图库搜索", description: "筛选轨、虚拟网格、检查器与保存搜索", enabled: true },
}

export const ENABLED_PANEL_OPTIONS = Object.values(PANEL_DEFINITIONS).filter(panel => panel.enabled)
export const PANEL_OPTION_GROUPS: { title: string; types: PanelType[] }[] = [
  { title: "核心", types: ["tag-sidebar", "prompt-workbench", "utility-sidebar"] },
  { title: "素材", types: ["prompt-assets", "tag-asset-manager", "tag-batch", "gallery-search", "presets", "history", "images"] },
  { title: "AI", types: ["agent"] },
  { title: "创作工具", types: ["canvas", "wd14", "comfyui", "tasks"] },
  { title: "设置", types: ["settings"] },
]

const REGION_PRESETS: Partial<Record<PanelType, readonly EditorRegionDefinition[]>> = {
  canvas: [
    { id: "header", kind: "header", title: "画布标题栏" },
    { id: "toolbar", kind: "toolbar", title: "画布工具栏" },
    { id: "asset", kind: "asset", title: "资产区" },
    { id: "main", kind: "main", title: "画布" },
    { id: "agent", kind: "agent", title: "Agent" },
    { id: "task", kind: "task", title: "任务" },
    { id: "inspector", kind: "inspector", title: "检查器" },
  ],
  "prompt-workbench": [
    { id: "header", kind: "header", title: "提示词工具栏" },
    { id: "main", kind: "main", title: "提示词编辑区" },
    { id: "inspector", kind: "inspector", title: "提示词检查器" },
  ],
  images: [
    { id: "toolbar", kind: "toolbar", title: "图库工具栏" },
    { id: "main", kind: "main", title: "媒体图库" },
    { id: "inspector", kind: "inspector", title: "媒体详情" },
  ],
  "ai-chat": [
    { id: "header", kind: "header", title: "会话栏" },
    { id: "main", kind: "main", title: "聊天" },
    { id: "sidebar", kind: "sidebar", title: "会话列表" },
  ],
  agent: [
    { id: "sessions", kind: "sidebar", title: "Session 列表" },
    { id: "main", kind: "main", title: "Agent 主工作区" },
    { id: "context", kind: "inspector", title: "上下文、工具与权限" },
  ],
  "agent-sessions": [
    { id: "sidebar", kind: "sidebar", title: "Session 列表" },
    { id: "main", kind: "main", title: "Agent 会话" },
    { id: "task", kind: "task", title: "工具与权限" },
    { id: "footer", kind: "footer", title: "运行状态" },
  ],
  mcp: [
    { id: "sidebar", kind: "sidebar", title: "MCP Server" },
    { id: "main", kind: "main", title: "工具和连接" },
    { id: "footer", kind: "footer", title: "连接状态" },
  ],
  wd14: [
    { id: "toolbar", kind: "toolbar", title: "反推工具栏" },
    { id: "main", kind: "main", title: "反推结果" },
    { id: "inspector", kind: "inspector", title: "候选标签" },
  ],
  "gallery-search": [
    { id: "toolbar", kind: "toolbar", title: "图库工具栏" },
    { id: "main", kind: "main", title: "图库网格" },
    { id: "inspector", kind: "inspector", title: "资产检查器" },
  ],
}

function categoryForPanel(type: PanelType) {
  if (["tag-sidebar", "tag-tree", "favorites", "tag-cards"].includes(type)) return "标签"
  if (["prompt-workbench", "prompt-editor", "output", "prompt-assets", "presets", "history"].includes(type)) return "提示词"
  if (["images", "ai-vision", "wd14", "comfyui"].includes(type)) return "媒体与创作"
  if (["canvas", "tasks"].includes(type)) return "工作区"
  if (["agent", "ai-assistant", "ai-chat", "agent-sessions", "mcp"].includes(type)) return "AI"
  if (["settings", "errors"].includes(type)) return "系统"
  return "其他"
}

export const EDITOR_DEFINITIONS: Record<PanelType, EditorDefinition> = Object.fromEntries(
  (Object.values(PANEL_DEFINITIONS) as PanelDefinition[]).map(panel => [panel.type, {
    ...panel,
    category: categoryForPanel(panel.type),
    defaultSize: { width: 520, height: 680 },
    supportsSplit: true,
    supportsTab: true,
    supportsFloat: true,
    supportsPopout: true,
    supportsMultiple: !["tag-sidebar", "utility-sidebar"].includes(panel.type),
    stateKeyFactory: ({ workspaceId, editorId, type }) => workspaceId + ":" + editorId + ":" + type,
    regions: REGION_PRESETS[panel.type] || [{ id: "main", kind: "main", title: panel.title }],
  } satisfies EditorDefinition])
) as unknown as Record<PanelType, EditorDefinition>

export function getEditorDefinition(type: PanelType): EditorDefinition {
  return EDITOR_DEFINITIONS[type] || EDITOR_DEFINITIONS["utility-sidebar"]
}

export function renderPanel(type: PanelType, options?: { agentMode?: "chat" | "vision" | "drawing" | "canvas" | "sessions" | "mcp" | "logs" }): React.ReactNode {
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
      return <AgentWorkspacePanel variant="workspace" initialMode={options?.agentMode} />
    case "ai-chat":
      return <AgentWorkspacePanel variant="workspace" initialMode={options?.agentMode} />
    case "ai-vision":
      return <AgentWorkspacePanel variant="workspace" initialMode={options?.agentMode} />
    case "agent-sessions":
      return <AgentWorkspacePanel variant="workspace" initialMode={options?.agentMode} />
    case "mcp":
      return <AgentWorkspacePanel variant="workspace" initialMode={options?.agentMode} />
    case "agent":
      return <AgentWorkspacePanel variant="workspace" initialMode={options?.agentMode} />
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
    case "tag-asset-manager":
      return <LazyPanel><TagAssetManagerPanel /></LazyPanel>
    case "tag-batch":
      return <TagBatchToolsPanel />
    case "gallery-search":
      return <GallerySearchPanel />
    case "settings":
      return <LazyPanel><SettingsPanel embedded /></LazyPanel>
    case "logs":
      return <WorkspaceLogsPanel />
    case "provider-manager":
      return <WorkspaceProviderManagerPanel />
    case "model-manager":
      return <WorkspaceModelManagerPanel />
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
