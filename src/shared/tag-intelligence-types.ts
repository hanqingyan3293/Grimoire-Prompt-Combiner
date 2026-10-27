export type TagRelationType = 'alias' | 'implication' | 'related' | 'parent' | 'child' | 'contradiction' | 'co-occurrence'
export type TagSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'mapped' | 'ignored'
export type TagSuggestionSource = 'wd14' | 'ai-vision' | 'parsed' | 'manual' | 'imported' | 'inferred'
export type AssetTagSource = TagSuggestionSource
export type AssetTagStatus = 'suggested' | 'accepted' | 'rejected'
export type AssetTagPolarity = 'positive' | 'negative' | 'neutral'

export interface TagMetadata {
  tagId: string
  namespace: string
  normalizedKey: string
  description: string
  color: string
  isActive: boolean
  source: string
}

export interface TagAlias {
  id: string
  tagId: string
  alias: string
  normalizedAlias: string
  language: string
  source: string
  isBuiltin: boolean
}

export interface TagRelation {
  id: string
  sourceTagId: string
  targetTagId: string
  relationType: TagRelationType
  confidence: number
  source: string
  enabled: boolean
}

export interface AssetTagLink {
  id: string
  assetType: string
  assetKey: string
  tagId: string
  polarity: AssetTagPolarity
  weight: number
  confidence: number
  source: AssetTagSource
  status: AssetTagStatus
  createdAt: string
}

export interface TagSuggestion {
  id: string
  assetType: string
  assetKey: string
  rawValue: string
  normalizedValue: string
  tagId: string | null
  namespace: string
  confidence: number
  source: TagSuggestionSource
  status: TagSuggestionStatus
  metadata: Record<string, unknown>
  resolvedAt: string | null
}

export interface TagSearchResult {
  tag: { id: string; subcategory_id: string; en: string; zh: string; sort_order: number; source: string; created_at: string }
  matchedBy: 'canonical' | 'alias' | 'relation' | 'fuzzy'
  score: number
  relation?: TagRelation
  usageCount: number
  /** 消歧义上下文（TagStudio 语义）：同名标签来自不同子类时的分类归属。 */
  subcategory?: { subcategoryZh: string; subcategoryEn: string; categoryZh: string; categoryEn: string }
}
