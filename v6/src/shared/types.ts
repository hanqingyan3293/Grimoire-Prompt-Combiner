// ============================================================
// 魔导书 v5 — 共享类型定义
// ============================================================

/** 标签结构 */
export interface Tag {
  id: string
  subcategory_id: string
  en: string
  zh: string
  sort_order: number
  source: 'builtin' | 'custom'
  created_at: string
}

/** 子类结构 */
export interface Subcategory {
  id: string
  category_id: string
  name: string
  sort_order: number
  tags: Tag[]
  created_at: string
}

/** 大类结构 */
export interface Category {
  id: string
  name: string
  sort_order: number
  subcategories: Subcategory[]
  created_at: string
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
  tags: string[]
  weights: Record<string, number>
  negative_tags: string[]
  negative_weights: Record<string, number>
}

/** 历史记录 */
export interface HistoryItem {
  id: string
  prompt: string
  data: string
  created_at: string
}

/** 快照 */
export interface Snapshot {
  id: string
  name: string
  data: string
  created_at: string
}

/** 收藏 */
export interface Favorite {
  id: number
  tag_id: string
  created_at: string
}

/** 标签使用频次 */
export interface TagUsage {
  tag_id: string
  count: number
  last_used: string | null
}

/** 图片参考 */
export interface ImageRef {
  id: number
  file_path: string
  metadata: string | null
  created_at: string
}

/** 用户设置 */
export type Settings = Record<string, string>

/** 迁移状态 */
export interface MigrationStatus {
  version: number
  migrated_at: string
  source_version: string
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
  qualityWords: boolean
}

/** 撤销/重做栈项 */
export interface UndoRedoEntry {
  positive: PanelTag[]
  negative: PanelTag[]
  timestamp: number
}

/** AI 视觉接口（预留） */
export interface VisionProvider {
  name: string
  analyze(imageBase64: string): Promise<TagSuggestion[]>
  describe(imageBase64: string): Promise<string>
}

export interface TagSuggestion {
  en: string
  zh: string
  confidence: number
  category?: string
}
