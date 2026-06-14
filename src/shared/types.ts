// ============================================================
// 魔导书 Grimoire v7 — 共享类型定义
// ============================================================

/** 标签结构 */
export interface Tag {
  id: string
  subcategory_id: string
  en: string
  zh: string
  sort_order: number
  source: "builtin" | "custom"
  created_at: string
}

/** 子类结构 */
export interface Subcategory {
  id: string
  category_id: string
  en: string
  zh: string
  sort_order: number
  tags: Tag[]
}

/** 大类结构 */
export interface Category {
  id: string
  en: string
  zh: string
  sort_order: number
  subcategories: Subcategory[]
}

/** 左侧面板展示的标签（带权重） */
export interface PanelTag {
  tag: Tag
  weight: number
  category: string
  subcategory: string
}

/** 当前提示词状态 */
export interface PromptState {
  positive: PanelTag[]
  negative: PanelTag[]
}

/** 撤销/重做栈项 */
export interface UndoRedoEntry {
  positive: PanelTag[]
  negative: PanelTag[]
  timestamp: number
}

/** 预设 */
export interface Preset {
  id: string
  name: string
  data: PresetData
  created_at: string
  updated_at: string
}

export interface PresetData {
  positive: { tag_id: string; weight: number }[]
  negative: { tag_id: string; weight: number }[]
}

/** 历史记录 */
export interface HistoryItem {
  id: string
  prompt: string
  positive_count: number
  negative_count: number
  created_at: string
}

/** 图片参考 */
export interface ImageRef {
  id: number
  file_path: string
  created_at: string
}

/** 聊天消息 */
export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  model: string
  created_at: string
}

/** AI 标签建议 */
export interface TagSuggestion {
  en: string
  zh: string
  confidence: number
  category?: string
}

/** 用户设置 */
export interface AppSettings {
  api_key: string
  api_endpoint: string
  api_model: string
  theme: string
  language: "zh" | "en"
  custom_accent: string
  ui_scale: string
  max_undo_steps: number
  random_min: string
  random_max: string
}

/** 错误日志 */
export interface ErrorLog {
  id: number
  message: string
  stack: string
  context: string
  created_at: string
}

/** IPC 通道名称常量 */
export const IPC_CHANNELS = {
  // 标签
  TAGS_GET_ALL: "tags:getAll",
  TAGS_CREATE: "tags:create",
  TAGS_UPDATE: "tags:update",
  TAGS_DELETE: "tags:delete",
  TAGS_IMPORT: "tags:import",
  // 大类/子类管理
  CATEGORY_CREATE: "category:create",
  CATEGORY_UPDATE: "category:update",
  CATEGORY_DELETE: "category:delete",
  SUBCATEGORY_CREATE: "subcategory:create",
  SUBCATEGORY_UPDATE: "subcategory:update",
  SUBCATEGORY_DELETE: "subcategory:delete",

  // 预设
  PRESETS_LIST: "presets:list",
  PRESETS_SAVE: "presets:save",
  PRESETS_DELETE: "presets:delete",

  // 历史
  HISTORY_LIST: "history:list",
  HISTORY_ADD: "history:add",
  HISTORY_CLEAR: "history:clear",

  // 设置
  SETTINGS_GET_ALL: "settings:getAll",
  SETTINGS_SET: "settings:set",

  // 图片
  IMAGES_LIST: "images:list",
  IMAGES_ADD: "images:add",
  IMAGES_DELETE: "images:delete",

  // AI
  AI_CHAT: "ai:chat",
  AI_VISION: "ai:vision",
  AI_CHAT_HISTORY: "ai:chatHistory",

  // 错误日志
  ERROR_LOG: "error:log",
  ERROR_GET_ALL: "error:getAll",

  // 数据库
  DB_EXPORT: "db:export",
  DB_IMPORT: "db:import",
} as const

/** 默认标签权重 */
export const DEFAULT_WEIGHT = 1.0

/** 权重范围 */
export const WEIGHT_MIN = 0.1
export const WEIGHT_MAX = 2.0

/** 最大撤销步数 */
export const MAX_UNDO_STEPS = 50
