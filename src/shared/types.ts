// ============================================================
// Grimoire v7 — Shared Types
// ============================================================

/** Tag Group (标签库组) */
export interface TagGroup {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

/** Tag structure */
export interface Tag {
  id: string
  subcategory_id: string
  en: string
  zh: string
  sort_order: number
  source: "builtin" | "custom"
  created_at: string
}

/** Subcategory structure */
export interface Subcategory {
  id: string
  category_id: string
  en: string
  zh: string
  sort_order: number
  tags: Tag[]
}

/** Category structure */
export interface Category {
  id: string
  en: string
  zh: string
  sort_order: number
  subcategories: Subcategory[]
}

/** Panel tag (with weight) */
export interface PanelTag {
  tag: Tag
  weight: number
  category: string
  subcategory: string
}

/** Prompt state */
export interface PromptState {
  positive: PanelTag[]
  negative: PanelTag[]
}

/** Undo/Redo entry */
export interface UndoRedoEntry {
  positive: PanelTag[]
  negative: PanelTag[]
  timestamp: number
}

/** Preset */
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

/** History item */
export interface HistoryItem {
  id: string
  prompt: string
  positive_count: number
  negative_count: number
  created_at: string
}

/** Image reference */
export interface ImageRef {
  id: number
  file_path: string
  storage_mode: 'managed' | 'external'
  asset_hash: string | null
  mime_type: string | null
  file_size: number | null
  original_name: string | null
  available: boolean
  created_at: string
}

/** Chat message */
export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  model: string
  created_at: string
}

/** AI tag suggestion */
export interface TagSuggestion {
  en: string
  zh: string
  confidence: number
  category?: string
}

/** App settings */
export interface AppSettings {
  api_endpoint: string
  api_model: string
  theme: string
  appearance_mode: "system" | "light" | "dark"
  language: "zh" | "en"
  custom_accent: string
  custom_bg_primary: string
  custom_bg_secondary: string
  custom_bg_tertiary: string
  custom_border: string
  ui_scale: string
  ui_density: string
  max_undo_steps: number
  random_min: string
  random_max: string
}

/** Favorite tag */
export interface FavoriteTag {
  fav_id: number
  id: string; en: string; zh: string
  subcategory_id: string; source: string
  sub_zh: string; cat_zh: string
}

/** Favorite subcategory */
export interface FavoriteSub {
  fav_id: number
  id: string; zh: string
  category_id: string; cat_zh: string
  tag_count: number
}

/** Error log */
export interface ErrorLog {
  id: number
  message: string
  stack: string
  context: string
  created_at: string
}

/** IPC channel names */

/** Provider metadata safe to expose to the renderer. Secrets stay in the main process. */
export interface Provider {
  id: string
  name: string
  access_mode: "login" | "api"
  protocol: "chat_completions" | "responses"
  base_url: string
  has_api_key: boolean
  has_auth_config: boolean
  default_model: string
  test_model: string
  context_size: number | null
  models: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Provider values accepted from the renderer. Secret values are write-only. */
export interface ProviderSaveInput {
  id?: string
  name?: string
  access_mode?: "login" | "api"
  protocol?: "chat_completions" | "responses"
  base_url?: string
  api_key?: string
  default_model?: string
  test_model?: string
  context_size?: number | null
  models?: string[]
  config_toml?: string
  auth_json?: string
}

/** 上游模型信息 */
export interface AIModelInfo {
  id: string
  object: string
  owned_by?: string
}
export const IPC_CHANNELS = {
  // Tags
  TAGS_GET_ALL: "tags:getAll",
  TAGS_CREATE: "tags:create",
  TAGS_UPDATE: "tags:update",
  TAGS_DELETE: "tags:delete",
  TAGS_IMPORT: "tags:import",
  TAGS_RESET: "tags:reset",

  // Category / Subcategory
  CATEGORY_CREATE: "category:create",
  CATEGORY_UPDATE: "category:update",
  CATEGORY_DELETE: "category:delete",
  SUBCATEGORY_CREATE: "subcategory:create",
  SUBCATEGORY_UPDATE: "subcategory:update",
  SUBCATEGORY_DELETE: "subcategory:delete",

  // Presets
  PRESETS_LIST: "presets:list",
  PRESETS_SAVE: "presets:save",
  PRESETS_DELETE: "presets:delete",

  // History
  HISTORY_LIST: "history:list",
  HISTORY_ADD: "history:add",
  HISTORY_CLEAR: "history:clear",

  // Prompt assets
  PROMPT_ASSETS_LIST: "promptAssets:list",
  PROMPT_ASSETS_CREATE: "promptAssets:create",
  PROMPT_ASSETS_DELETE: "promptAssets:delete",

  // Settings
  SETTINGS_GET_ALL: "settings:getAll",
  SETTINGS_SET: "settings:set",
  OPEN_EXTERNAL: "system:openExternal",

  // Images
  IMAGES_LIST: "images:list",
  IMAGES_ADD: "images:add",
  IMAGES_DELETE: "images:delete",
  IMAGES_IMPORT_DATA: "images:importData",
  IMAGES_READ_DATA: "images:readData",

  // AI
  AI_CHAT: "ai:chat",
  AI_VISION: "ai:vision",
  AI_CHAT_HISTORY: "ai:chatHistory",

  // Error logs
  ERROR_LOG: "error:log",
  ERROR_GET_ALL: "error:getAll",

  // Database
  DB_EXPORT: "db:export",
  DB_IMPORT: "db:import",

  // File dialog
  DIALOG_SAVE_TEXT: "dialog:saveText",
  DIALOG_OPEN_TEXT: "dialog:openText",

  // Providers
  PROVIDERS_LIST: "providers:list",
  PROVIDERS_SAVE: "providers:save",
  PROVIDERS_DELETE: "providers:delete",
  PROVIDERS_SET_ACTIVE: "providers:setActive",
  PROVIDERS_FETCH_MODELS: "providers:fetchModels",
  PROVIDERS_TEST: "providers:test",

  // Tag Groups
  TAG_GROUPS_LIST: "tagGroups:list",
  TAG_GROUPS_CREATE: "tagGroups:create",
  TAG_GROUPS_DELETE: "tagGroups:delete",
  TAG_GROUPS_RENAME: "tagGroups:rename",
  TAG_GROUPS_COPY: "tagGroups:copy",
  TAG_GROUPS_IMPORT: "tagGroups:import",
  TAG_GROUPS_EXPORT: "tagGroups:export",
  TAG_GROUPS_SET_ACTIVE: "tagGroups:setActive",

  // Favorites
  FAV_TAG_LIST: "fav:tagList",
  FAV_TAG_ADD: "fav:tagAdd",
  FAV_TAG_REMOVE: "fav:tagRemove",
  FAV_TAG_CHECK: "fav:tagCheck",
  FAV_SUB_LIST: "fav:subList",
  FAV_SUB_ADD: "fav:subAdd",
  FAV_SUB_REMOVE: "fav:subRemove",
  FAV_SUB_CHECK: "fav:subCheck",

  // Migrations
  MIGRATION_SELECT_FRIEND_PROMPTS: "migration:selectFriendPrompts",
  MIGRATION_IMPORT_FRIEND_PROMPTS: "migration:importFriendPrompts",

  // Tasks
  TASKS_CREATE: "tasks:create",
  TASKS_LIST: "tasks:list",
  TASKS_GET: "tasks:get",
  TASKS_CANCEL: "tasks:cancel",
  TASKS_RETRY: "tasks:retry",
  TASKS_SUBSCRIBE: "tasks:subscribe",

  // WD14
  WD14_STATUS: "wd14:status",
  WD14_MODELS: "wd14:models",
  WD14_SWITCH_MODEL: "wd14:switchModel",
  WD14_CREATE_TASK: "wd14:createTask",
  WD14_DIAGNOSTICS: "wd14:diagnostics",
  WD14_SELECT_MODEL_DIRECTORY: "wd14:selectModelDirectory",
  WD14_SELECT_PYTHON_PATH: "wd14:selectPythonPath",

  // ComfyUI
  COMFY_STATUS: "comfy:status",
  COMFY_MODELS: "comfy:models",
  COMFY_WORKFLOWS_LIST: "comfy:workflows:list",
  COMFY_WORKFLOW_IMPORT: "comfy:workflows:import",
  COMFY_WORKFLOW_DELETE: "comfy:workflows:delete",
  COMFY_CREATE_TASK: "comfy:createTask",
  COMFY_QUICK_GENERATE: "comfy:quickGenerate",

  // Canvas
  CANVAS_LIST: "canvas:list",
  CANVAS_GET: "canvas:get",
  CANVAS_CREATE: "canvas:create",
  CANVAS_SAVE: "canvas:save",
  CANVAS_DELETE: "canvas:delete",
  CANVAS_EXPORT_PACKAGE: "canvas:exportPackage",
  CANVAS_IMPORT_PACKAGE: "canvas:importPackage",

  // Vendored infinite-canvas projects
  CANVAS_VENDOR_LIST: "canvasVendor:list",
  CANVAS_VENDOR_GET: "canvasVendor:get",
  CANVAS_VENDOR_CREATE: "canvasVendor:create",
  CANVAS_VENDOR_SAVE: "canvasVendor:save",
  CANVAS_VENDOR_DELETE: "canvasVendor:delete",
  PROMPT_ASSET_CATEGORIES_LIST: "promptAssetCategories:list",
  PROMPT_ASSET_CATEGORIES_CREATE: "promptAssetCategories:create",
  PROMPT_ASSET_CATEGORIES_RENAME: "promptAssetCategories:rename",
  PROMPT_ASSET_CATEGORIES_DELETE: "promptAssetCategories:delete",
  PROMPT_ASSET_CATEGORIES_ASSIGN: "promptAssetCategories:assign",
  PROMPT_ASSET_CATEGORIES_MOVE: "promptAssetCategories:move",
} as const

/** Default tag weight */
export const DEFAULT_WEIGHT = 1.0

/** Weight range */
export const WEIGHT_MIN = 0.1
export const WEIGHT_MAX = 2.0

/** Max undo steps */
export const MAX_UNDO_STEPS = 50
