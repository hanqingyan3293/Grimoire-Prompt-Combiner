/**
 * Source-compatible AI usage read models.
 *
 * Token and cost fields are nullable on purpose. Grimoire stores only measured token
 * counts and has no pricing data, so an unknown aggregate is `null` rather than a
 * fabricated zero. Counts remain numbers because the usage row exists.
 */

export const CHERRY_USAGE_CURRENCIES = ['USD', 'CNY'] as const
export type CherryUsageCurrency = (typeof CHERRY_USAGE_CURRENCIES)[number]

export type CherryUsageGroupBy = 'provider' | 'apiKey' | 'model' | 'source'
export type CherryUsageMetric = 'tokens' | 'requests' | 'cost'
export type CherryUsageSortBy = 'createdAt' | 'totalTokens' | 'cost' | 'timeFirstTokenMs' | 'tokensPerSecond'
export type CherryUsageSortOrder = 'asc' | 'desc'
export type CherryUsageMessageKind = 'chat' | 'agent-session'
export type CherryUsageRecordKind = 'invocation' | 'legacy-aggregate'
export type CherryUsageAttribution = 'explicit' | 'matched' | 'auth' | 'unknown'
export type CherryUsageAuthMethod = 'oauth' | 'external-cli' | 'iam-aws' | 'api-key-aws' | 'iam-gcp' | 'iam-azure'
export type CherryUsageModality = 'language' | 'embedding' | 'image' | 'rerank'
export type CherryUsageSourceType = 'assistant' | 'agent' | 'mini-app'

export interface CherryUsageEntry {
  id: string
  requestId: string
  recordKind: CherryUsageRecordKind
  requestCount: number
  messageKind: CherryUsageMessageKind | null
  messageId: string | null
  providerId: string | null
  providerName: string | null
  sourceType: CherryUsageSourceType | null
  sourceId: string | null
  sourceName: string | null
  sourceIcon: string | null
  modelId: string | null
  modelName: string | null
  modality: CherryUsageModality
  apiKeyId: string | null
  apiKeyLabel: string | null
  apiKeyMasked: string | null
  apiKeyAttribution: CherryUsageAttribution
  authMethod: CherryUsageAuthMethod | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  noCacheTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  imageCount: number | null
  cost: number | null
  costCurrency: CherryUsageCurrency | null
  costSource: 'provider' | 'computed' | null
  costBreakdown: Record<string, number> | null
  pricingSnapshot: Record<string, unknown> | null
  timeFirstTokenMs: number | null
  timeCompletionMs: number | null
  timeThinkingMs: number | null
  createdAt: string
}

export interface CherryUsageListQuery {
  cursor?: string
  limit: number
  sortBy: CherryUsageSortBy
  sortOrder: CherryUsageSortOrder
  from?: number
  to?: number
  messageKind?: CherryUsageMessageKind
  messageId?: string
  costCurrency?: CherryUsageCurrency
}

export interface CherryUsageListResponse {
  items: CherryUsageEntry[]
  total: number
  nextCursor?: string
}

export interface CherryUsageStatsMetrics {
  costCurrency: CherryUsageCurrency | null
  totalCost: number | null
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalTokens: number | null
  totalNoCacheTokens: number | null
  totalCacheReadTokens: number | null
  totalCacheWriteTokens: number | null
  recordCount: number
  requestCount: number
  estimatedRequestCount: number
  unpricedRequestCount: number
}

export type CherryUsageStatsGroupIdentity =
  | { groupBy: 'provider'; providerId: string | null; providerName: string | null }
  | {
      groupBy: 'apiKey'
      providerId: string | null
      providerName: string | null
      apiKeyId: string | null
      apiKeyLabel: string | null
      apiKeyMasked: string | null
      apiKeyAttribution: CherryUsageAttribution
      authMethod: CherryUsageAuthMethod | null
    }
  | { groupBy: 'model'; providerId: string | null; providerName: string | null; modelId: string | null }
  | {
      groupBy: 'source'
      sourceType: CherryUsageSourceType | null
      sourceId: string | null
      sourceName: string | null
      sourceIcon: string | null
    }

export type CherryUsageStatsBucket = CherryUsageStatsGroupIdentity & CherryUsageStatsMetrics

export interface CherryUsageStatsResponse {
  buckets: CherryUsageStatsBucket[]
  totals: CherryUsageStatsMetrics
  other: CherryUsageStatsMetrics
}

export interface CherryUsageStatsQuery {
  groupBy: CherryUsageGroupBy
  metric: CherryUsageMetric
  currency?: CherryUsageCurrency
  limit: number
  from: number
  to: number
}

export interface CherryUsageTimelineBucket {
  date: string
  costCurrency: CherryUsageCurrency | null
  totalCost: number | null
  totalTokens: number | null
  totalNoCacheTokens: number | null
  totalCacheReadTokens: number | null
  totalCacheWriteTokens: number | null
  recordCount: number
  requestCount: number
  estimatedRequestCount: number
  unpricedRequestCount: number
  providerId?: string | null
  providerName?: string | null
  sourceType?: CherryUsageSourceType | null
  sourceId?: string | null
  sourceName?: string | null
  sourceIcon?: string | null
  apiKeyId?: string | null
  apiKeyLabel?: string | null
  apiKeyMasked?: string | null
  apiKeyAttribution?: CherryUsageAttribution
  authMethod?: CherryUsageAuthMethod | null
  modelId?: string | null
  isOther?: true
}

export interface CherryUsageTimelineResponse {
  buckets: CherryUsageTimelineBucket[]
  costTotals: Array<{ currency: CherryUsageCurrency; total: number }>
  dailyCosts: Array<{ currency: CherryUsageCurrency; total: number; date: string }>
}

export interface CherryUsageTimelineQuery {
  groupBy?: CherryUsageGroupBy
  metric: CherryUsageMetric
  currency?: CherryUsageCurrency
  limit: number
  from: number
  to: number
}
