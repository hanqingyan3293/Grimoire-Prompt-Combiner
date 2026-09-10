import type { PresetData } from './types'

export type PromptAssetSource = 'asset' | 'history' | 'preset' | 'favorite'
export type PromptAssetSourceFilter = 'all' | PromptAssetSource

export interface PromptAssetItem {
  id: string
  sourceRef: string
  source: PromptAssetSource
  name: string
  prompt: string
  detail: string
  group?: string
  categoryIds?: string[]
  createdAt: string
  nsfw: boolean
  variantCount: number
  presetData?: PresetData
  tagId?: string
}

export interface PromptAssetCategory {
  id: string
  parentId: string | null
  name: string
  sourceScope: PromptAssetSource
  sortOrder: number
  isBuiltin: boolean
}

export interface PromptAssetQuery {
  query?: string
  source?: PromptAssetSourceFilter
  limit?: number
  offset?: number
}

export interface PromptAssetPage {
  items: PromptAssetItem[]
  total: number
  limit: number
  offset: number
}
