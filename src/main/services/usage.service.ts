import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import type {
  CherryUsageCurrency,
  CherryUsageEntry,
  CherryUsageGroupBy,
  CherryUsageListQuery,
  CherryUsageListResponse,
  CherryUsageMessageKind,
  CherryUsageMetric,
  CherryUsageSortBy,
  CherryUsageSortOrder,
  CherryUsageStatsBucket,
  CherryUsageStatsGroupIdentity,
  CherryUsageStatsMetrics,
  CherryUsageStatsQuery,
  CherryUsageStatsResponse,
  CherryUsageTimelineBucket,
  CherryUsageTimelineQuery,
  CherryUsageTimelineResponse
} from '../../shared/cherry-usage'

/**
 * Token accounting for model calls.
 *
 * Grimoire had no usage capture at all before this (`src/main/ai/` contained no token/usage
 * reference), so `/settings/usage` had nothing to read. The read half below adapts those
 * real rows to the source usage list/stats/timeline contracts.
 *
 * Null semantics matter here and are the reason every count is `number | null` rather than
 * `number`:
 *
 *  - a provider that does not report usage produces NO row at all (the runtime emits no
 *    `usage` event), rather than a row of zeros;
 *  - a provider that reports only one side stores NULL for the other, not 0.
 *
 * A fabricated 0 would render in the source's usage UI as a real measurement — "0 tokens
 * used" is a claim, and it would be false.
 */
export type UsageRecordInput = {
  sessionId?: string
  messageId?: string
  runtime: string
  protocol?: string
  providerId?: string
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
}

export type UsageRecord = {
  id: string
  sessionId: string | null
  messageId: string | null
  runtime: string
  protocol: string
  providerId: string
  modelId: string
  inputTokens: number | null
  outputTokens: number | null
  cachedTokens: number | null
  createdAt: string
}

/**
 * Persists one model call's token counts.
 *
 * Returns the stored record, or `null` when there is nothing to record — a call whose usage
 * the provider omitted entirely. Callers use the `null` to decide whether to broadcast, so a
 * usage-less provider does not announce a phantom zero reading.
 */
export function recordAiUsage(input: UsageRecordInput): UsageRecord | null {
  const inputTokens = normalizeCount(input.inputTokens)
  const outputTokens = normalizeCount(input.outputTokens)
  const cachedTokens = normalizeCount(input.cachedTokens)
  // All three absent means the provider told us nothing; there is no row to write.
  if (inputTokens === null && outputTokens === null && cachedTokens === null) return null

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  getDatabase().run(
    'INSERT INTO ai_usage_records (id,session_id,message_id,runtime,protocol,provider_id,model_id,input_tokens,output_tokens,cached_tokens,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [
      id,
      input.sessionId ?? null,
      input.messageId ?? null,
      input.runtime || '',
      input.protocol || '',
      input.providerId || '',
      input.modelId || '',
      inputTokens,
      outputTokens,
      cachedTokens,
      now
    ]
  )
  // `db.run` writes through but does not persist on its own — the same note as the prompt
  // asset writers. Without this the accounting would vanish on restart.
  saveDatabase()
  return {
    id,
    sessionId: input.sessionId ?? null,
    messageId: input.messageId ?? null,
    runtime: input.runtime || '',
    protocol: input.protocol || '',
    providerId: input.providerId || '',
    modelId: input.modelId || '',
    inputTokens,
    outputTokens,
    cachedTokens,
    createdAt: now
  }
}

/**
 * Coerces a reported count, treating anything that is not a finite number as absent.
 *
 * `Number(null)` and `Number('')` are both 0, so a blind coercion would turn a missing field
 * into a genuine-looking zero reading. Only finite numbers pass.
 */
function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

/** Totals over the current records, with `null` when no record carried that figure. */
export function summarizeAiUsage(): { calls: number; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null } {
  const row = getDatabase().exec(
    'SELECT count(*), sum(input_tokens), sum(output_tokens), sum(cached_tokens) FROM ai_usage_records'
  )[0]?.values?.[0] || []
  const calls = Number(row[0] || 0)
  // `sum()` over a column that is entirely NULL returns NULL, and the source UI shows "—"
  // for that rather than 0 — so the null is carried through instead of being flattened.
  return {
    calls,
    inputTokens: row[1] === null || row[1] === undefined ? null : Number(row[1]),
    outputTokens: row[2] === null || row[2] === undefined ? null : Number(row[2]),
    cachedTokens: row[3] === null || row[3] === undefined ? null : Number(row[3])
  }
}

/** Most recent records, newest first. */
export function listAiUsage(limit = 100): UsageRecord[] {
  const rows = getDatabase().exec(
    // `created_at` is millisecond text; two records written in the same millisecond would
    // otherwise fall back to a random UUID tiebreak and the list would not be newest-first.
    // rowid is the insertion order, so it is the honest tiebreak.
    'SELECT id,session_id,message_id,runtime,protocol,provider_id,model_id,input_tokens,output_tokens,cached_tokens,created_at FROM ai_usage_records ORDER BY created_at DESC, rowid DESC LIMIT ?',
    [Math.max(1, Math.min(1000, Math.trunc(limit)))]
  )[0]?.values || []
  return rows.map(row => ({
    id: String(row[0]),
    sessionId: row[1] === null || row[1] === undefined ? null : String(row[1]),
    messageId: row[2] === null || row[2] === undefined ? null : String(row[2]),
    runtime: String(row[3] || ''),
    protocol: String(row[4] || ''),
    providerId: String(row[5] || ''),
    modelId: String(row[6] || ''),
    inputTokens: row[7] === null || row[7] === undefined ? null : Number(row[7]),
    outputTokens: row[8] === null || row[8] === undefined ? null : Number(row[8]),
    cachedTokens: row[9] === null || row[9] === undefined ? null : Number(row[9]),
    createdAt: String(row[10] || '')
  }))
}

/**
 * Projects a stored record onto the source `AiUsageRecordEntry` shape.
 *
 * The source entry carries 40+ fields for features Grimoire does not have: cost and pricing
 * snapshots (no price table), API-key attribution (keys never leave safeStorage and are never
 * exposed to the renderer), image counts, and provider-vs-auth modality splits. Those are
 * emitted as `null` — the source schema declares every one of them nullable, and `null` is the
 * truthful answer. Substituting 0 for a cost would render as "this call was free", and an
 * empty-string provider name would render as a provider with no name; both are claims.
 *
 * Fields Grimoire CAN answer are real: the token counts, the model, the timestamp, and — for
 * records written since the runtime gained usage reporting — the protocol/runtime that
 * produced them. `modality` is always `'language'` because only the text path reports usage today;
 * a non-text call would produce no `usage` event at all rather than a mislabelled one.
 */
export function projectUsageEntry(record: UsageRecord, id: string): CherryUsageEntry {
  const total = record.inputTokens === null && record.outputTokens === null
    ? null
    : (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
  return {
    id,
    // No request-level idempotency key is recorded, so the record's own id stands in. It is
    // stable and unique, which is what the field is used for; inventing a second id would
    // imply a dedup guarantee this app does not implement.
    requestId: record.id,
    recordKind: 'invocation',
    requestCount: 1,
    // The local row does not record whether the message belonged to a chat topic or an
    // agent session. `null` is the source's explicit "unknown" value; `assistant` is not
    // even a member of the source `messageKind` enum.
    messageKind: null,
    messageId: record.messageId,
    providerId: record.providerId || null,
    providerName: null,
    sourceType: null,
    sourceId: record.sessionId,
    sourceName: null,
    sourceIcon: null,
    modelId: record.modelId || null,
    modelName: record.modelId || null,
    modality: 'language',
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: total,
    reasoningTokens: null,
    noCacheTokens: null,
    cacheReadTokens: record.cachedTokens,
    cacheWriteTokens: null,
    imageCount: null,
    cost: null,
    costCurrency: null,
    costSource: null,
    costBreakdown: null,
    pricingSnapshot: null,
    timeFirstTokenMs: null,
    timeCompletionMs: null,
    timeThinkingMs: null,
    createdAt: record.createdAt
  }
}

const USAGE_LIST_DEFAULT_LIMIT = 50
const USAGE_LIST_MAX_LIMIT = 200
const USAGE_AGGREGATE_DEFAULT_LIMIT = 10
const USAGE_AGGREGATE_MAX_LIMIT = 50
const USAGE_MAX_RANGE_DAYS = 366
const USAGE_MAX_TIMESTAMP = 8_640_000_000_000_000

const USAGE_GROUP_BY = new Set<CherryUsageGroupBy>(['provider', 'apiKey', 'model', 'source'])
const USAGE_METRICS = new Set<CherryUsageMetric>(['tokens', 'requests', 'cost'])
const USAGE_SORT_BY = new Set<CherryUsageSortBy>(['createdAt', 'totalTokens', 'cost', 'timeFirstTokenMs', 'tokensPerSecond'])
const USAGE_SORT_ORDER = new Set<CherryUsageSortOrder>(['asc', 'desc'])
const USAGE_MESSAGE_KIND = new Set<CherryUsageMessageKind>(['chat', 'agent-session'])
const USAGE_CURRENCY = new Set<CherryUsageCurrency>(['USD', 'CNY'])

export class UsageQueryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'UsageQueryError'
  }
}

type UsageQueryObject = Record<string, unknown>

function invalidUsageQuery(message: string): never {
  throw new UsageQueryError(400, 'VALIDATION_ERROR', message)
}

function usageQueryObject(input: unknown): UsageQueryObject {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    invalidUsageQuery('Usage query must be an object')
  }
  return input as UsageQueryObject
}

function rejectUnknownUsageKeys(input: UsageQueryObject, allowed: readonly string[]): void {
  const known = new Set(allowed)
  const unknown = Object.keys(input).filter(key => !known.has(key) && input[key] !== undefined)
  if (unknown.length > 0) invalidUsageQuery(`Unknown usage query field: ${unknown[0]}`)
}

function readUsageInteger(
  input: UsageQueryObject,
  key: string,
  options: { required?: boolean; min?: number; max?: number; allowTimestamp?: boolean } = {}
): number | undefined {
  const value = input[key]
  if (value === undefined) {
    if (options.required) invalidUsageQuery(`${key} is required`)
    return undefined
  }
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(parsed)) invalidUsageQuery(`${key} must be an integer`)
  if (options.min !== undefined && parsed < options.min) invalidUsageQuery(`${key} must be at least ${options.min}`)
  if (options.max !== undefined && parsed > options.max) invalidUsageQuery(`${key} must be at most ${options.max}`)
  if (options.allowTimestamp && parsed > USAGE_MAX_TIMESTAMP) invalidUsageQuery(`${key} is outside the timestamp range`)
  return parsed
}

function readUsageString(input: UsageQueryObject, key: string): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) invalidUsageQuery(`${key} must be a nonempty string`)
  return value
}

function readUsageEnum<T extends string>(
  input: UsageQueryObject,
  key: string,
  allowed: Set<T>,
  options: { required?: boolean; fallback?: T } = {}
): T | undefined {
  const value = input[key]
  if (value === undefined) {
    if (options.required) invalidUsageQuery(`${key} is required`)
    return options.fallback
  }
  if (typeof value !== 'string' || !allowed.has(value as T)) invalidUsageQuery(`${key} is invalid`)
  return value as T
}

function readUsageCurrency(input: UsageQueryObject, key: string, required: boolean): CherryUsageCurrency | undefined {
  const currency = readUsageEnum(input, key, USAGE_CURRENCY, { required })
  return currency
}

function validateUsageRange(from: number, to: number): void {
  if (to < from) invalidUsageQuery('to must be greater than or equal to from')
  if (to - from > USAGE_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    invalidUsageQuery(`time range must not exceed ${USAGE_MAX_RANGE_DAYS} days`)
  }
}

function parseUsageListQuery(input: unknown): CherryUsageListQuery {
  const raw = usageQueryObject(input)
  rejectUnknownUsageKeys(raw, ['cursor', 'limit', 'sortBy', 'sortOrder', 'from', 'to', 'messageKind', 'messageId', 'costCurrency'])
  const sortBy = readUsageEnum(raw, 'sortBy', USAGE_SORT_BY, { fallback: 'createdAt' })!
  const sortOrder = readUsageEnum(raw, 'sortOrder', USAGE_SORT_ORDER, { fallback: 'desc' })!
  const costCurrency = readUsageCurrency(raw, 'costCurrency', sortBy === 'cost')
  const messageKind = readUsageEnum(raw, 'messageKind', USAGE_MESSAGE_KIND)
  const messageId = readUsageString(raw, 'messageId')
  if ((messageKind === undefined) !== (messageId === undefined)) {
    invalidUsageQuery('messageKind and messageId must be provided together')
  }
  const cursor = readUsageString(raw, 'cursor')
  const from = readUsageInteger(raw, 'from', { min: 0, allowTimestamp: true })
  const to = readUsageInteger(raw, 'to', { min: 0, allowTimestamp: true })
  const query: CherryUsageListQuery = {
    limit: readUsageInteger(raw, 'limit', { min: 1, max: USAGE_LIST_MAX_LIMIT }) ?? USAGE_LIST_DEFAULT_LIMIT,
    sortBy,
    sortOrder,
    ...(cursor !== undefined ? { cursor } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(messageKind !== undefined ? { messageKind } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    ...(costCurrency !== undefined ? { costCurrency } : {})
  }
  if (query.messageKind && query.messageId) {
    throw new UsageQueryError(
      501,
      'NOT_IMPLEMENTED',
      'message-scoped usage queries are unsupported: ai_usage_records stores no message kind'
    )
  }
  return query
}

function parseAggregateQuery(input: unknown, withGroupBy: true): CherryUsageStatsQuery
function parseAggregateQuery(input: unknown, withGroupBy: false): CherryUsageTimelineQuery
function parseAggregateQuery(input: unknown, withGroupBy: boolean): CherryUsageStatsQuery | CherryUsageTimelineQuery {
  const raw = usageQueryObject(input)
  rejectUnknownUsageKeys(raw, ['groupBy', 'metric', 'currency', 'limit', 'from', 'to'])
  const metric = readUsageEnum(raw, 'metric', USAGE_METRICS, { fallback: 'tokens' })!
  const currency = readUsageCurrency(raw, 'currency', metric === 'cost')
  const groupBy = readUsageEnum(raw, 'groupBy', USAGE_GROUP_BY, { required: withGroupBy })
  const from = readUsageInteger(raw, 'from', { required: true, min: 0, allowTimestamp: true })!
  const to = readUsageInteger(raw, 'to', { required: true, min: 0, allowTimestamp: true })!
  validateUsageRange(from, to)
  const common = {
    metric,
    limit: readUsageInteger(raw, 'limit', { min: 1, max: USAGE_AGGREGATE_MAX_LIMIT }) ?? USAGE_AGGREGATE_DEFAULT_LIMIT,
    from,
    to,
    ...(currency !== undefined ? { currency } : {})
  }
  return withGroupBy
    ? { ...common, groupBy: groupBy! }
    : { ...common, ...(groupBy !== undefined ? { groupBy } : {}) }
}

function readUsageRows(from?: number, to?: number): UsageRecord[] {
  const conditions: string[] = []
  const parameters: unknown[] = []
  if (from !== undefined) {
    conditions.push('created_at >= ?')
    parameters.push(new Date(from).toISOString())
  }
  if (to !== undefined) {
    conditions.push('created_at <= ?')
    parameters.push(new Date(to).toISOString())
  }
  const rows = getDatabase().exec(
    `SELECT id,session_id,message_id,runtime,protocol,provider_id,model_id,input_tokens,output_tokens,cached_tokens,created_at FROM ai_usage_records${conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC`,
    parameters
  )[0]?.values || []
  return rows.map(row => ({
    id: String(row[0]),
    sessionId: row[1] === null || row[1] === undefined ? null : String(row[1]),
    messageId: row[2] === null || row[2] === undefined ? null : String(row[2]),
    runtime: String(row[3] || ''),
    protocol: String(row[4] || ''),
    providerId: String(row[5] || ''),
    modelId: String(row[6] || ''),
    inputTokens: row[7] === null || row[7] === undefined ? null : Number(row[7]),
    outputTokens: row[8] === null || row[8] === undefined ? null : Number(row[8]),
    cachedTokens: row[9] === null || row[9] === undefined ? null : Number(row[9]),
    createdAt: String(row[10] || '')
  }))
}

function usageTotalTokens(record: UsageRecord): number | null {
  if (record.inputTokens === null && record.outputTokens === null) return null
  return (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
}

function sumNullable(rows: readonly UsageRecord[], read: (row: UsageRecord) => number | null): number | null {
  let sawValue = false
  let total = 0
  for (const row of rows) {
    const value = read(row)
    if (value === null) continue
    sawValue = true
    total += value
  }
  return sawValue ? total : null
}

function usageMetrics(rows: readonly UsageRecord[]): CherryUsageStatsMetrics {
  return {
    costCurrency: null,
    // Grimoire stores no price table and no provider-reported cost. Null means unknown;
    // a zero here would claim every call was free.
    totalCost: null,
    totalInputTokens: sumNullable(rows, row => row.inputTokens),
    totalOutputTokens: sumNullable(rows, row => row.outputTokens),
    totalTokens: sumNullable(rows, usageTotalTokens),
    // The local table has no no-cache or cache-write columns. Do not infer them from
    // cached_tokens because that would invent a split the source never captured.
    totalNoCacheTokens: null,
    totalCacheReadTokens: sumNullable(rows, row => row.cachedTokens),
    totalCacheWriteTokens: null,
    recordCount: rows.length,
    requestCount: rows.length,
    estimatedRequestCount: 0,
    unpricedRequestCount: rows.length
  }
}

function statsGroupIdentity(record: UsageRecord, groupBy: CherryUsageGroupBy): CherryUsageStatsGroupIdentity {
  const providerId = record.providerId || null
  const modelId = record.modelId || null
  const sessionId = record.sessionId || null
  switch (groupBy) {
    case 'provider':
      return { groupBy, providerId, providerName: null }
    case 'model':
      return { groupBy, providerId, providerName: null, modelId }
    case 'apiKey':
      return {
        groupBy,
        providerId,
        providerName: null,
        apiKeyId: null,
        apiKeyLabel: null,
        apiKeyMasked: null,
        apiKeyAttribution: 'unknown',
        authMethod: null
      }
    case 'source':
      return { groupBy, sourceType: null, sourceId: sessionId, sourceName: null, sourceIcon: null }
  }
}

function statsIdentityKey(identity: CherryUsageStatsGroupIdentity): string {
  return JSON.stringify(identity)
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

function compareStatsBuckets(left: CherryUsageStatsBucket, right: CherryUsageStatsBucket, metric: CherryUsageMetric): number {
  let difference = 0
  if (metric === 'requests') difference = right.requestCount - left.requestCount
  else if (metric === 'tokens') difference = compareNullableDescending(left.totalTokens, right.totalTokens)
  else difference = compareNullableDescending(left.totalCost, right.totalCost)
  return difference || statsIdentityKey(left).localeCompare(statsIdentityKey(right))
}

function statsFromRows(
  rows: readonly UsageRecord[],
  groupBy: CherryUsageGroupBy,
  metric: CherryUsageMetric,
  limit: number
): CherryUsageStatsResponse {
  const groups = new Map<string, { identity: CherryUsageStatsGroupIdentity; rows: UsageRecord[] }>()
  for (const row of rows) {
    const identity = statsGroupIdentity(row, groupBy)
    const key = statsIdentityKey(identity)
    const group = groups.get(key) ?? { identity, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  const ranked = [...groups.values()]
    .map(group => ({ rows: group.rows, bucket: { ...group.identity, ...usageMetrics(group.rows) } }))
    .sort((left, right) => compareStatsBuckets(left.bucket, right.bucket, metric))
  const buckets = ranked.slice(0, limit).map(item => item.bucket)
  const totals = usageMetrics(rows)
  const otherRows = ranked.slice(limit).flatMap(item => item.rows)
  return { buckets, totals, other: usageMetrics(otherRows) }
}

function timelineDay(record: UsageRecord): string {
  const date = new Date(record.createdAt)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function timelineMetrics(rows: readonly UsageRecord[]) {
  return {
    costCurrency: null as CherryUsageCurrency | null,
    totalCost: null as number | null,
    totalTokens: sumNullable(rows, usageTotalTokens),
    totalNoCacheTokens: null as number | null,
    totalCacheReadTokens: sumNullable(rows, row => row.cachedTokens),
    totalCacheWriteTokens: null as number | null,
    recordCount: rows.length,
    requestCount: rows.length,
    estimatedRequestCount: 0,
    unpricedRequestCount: rows.length
  }
}

function timelineIdentity(record: UsageRecord, groupBy: CherryUsageGroupBy): Partial<CherryUsageTimelineBucket> {
  const providerId = record.providerId || null
  const modelId = record.modelId || null
  const sessionId = record.sessionId || null
  if (groupBy === 'provider') return { providerId, providerName: null }
  if (groupBy === 'model') return { providerId, providerName: null, modelId }
  if (groupBy === 'source') return { sourceType: null, sourceId: sessionId, sourceName: null, sourceIcon: null }
  return {
    providerId,
    providerName: null,
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null
  }
}

function timelineIdentityKey(record: UsageRecord, groupBy: CherryUsageGroupBy): string {
  return JSON.stringify(timelineIdentity(record, groupBy))
}

function statsBucketIdentityKey(bucket: CherryUsageStatsBucket): string {
  switch (bucket.groupBy) {
    case 'provider':
      return JSON.stringify({ providerId: bucket.providerId, providerName: bucket.providerName })
    case 'model':
      return JSON.stringify({ providerId: bucket.providerId, providerName: bucket.providerName, modelId: bucket.modelId })
    case 'source':
      return JSON.stringify({
        sourceType: bucket.sourceType,
        sourceId: bucket.sourceId,
        sourceName: bucket.sourceName,
        sourceIcon: bucket.sourceIcon
      })
    case 'apiKey':
      return JSON.stringify({
        providerId: bucket.providerId,
        providerName: bucket.providerName,
        apiKeyId: bucket.apiKeyId,
        apiKeyLabel: bucket.apiKeyLabel,
        apiKeyMasked: bucket.apiKeyMasked,
        apiKeyAttribution: bucket.apiKeyAttribution,
        authMethod: bucket.authMethod
      })
  }
}

export function getUsageStats(input: unknown): CherryUsageStatsResponse {
  const query = parseAggregateQuery(input, true)
  return statsFromRows(readUsageRows(query.from, query.to), query.groupBy, query.metric, query.limit)
}

export function getUsageTimeline(input: unknown): CherryUsageTimelineResponse {
  const query = parseAggregateQuery(input, false)
  const rows = readUsageRows(query.from, query.to)
  const byDay = new Map<string, UsageRecord[]>()
  for (const row of rows) {
    const day = timelineDay(row)
    if (!day) continue
    const dayRows = byDay.get(day) ?? []
    dayRows.push(row)
    byDay.set(day, dayRows)
  }
  const days = [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right))
  const ungrouped: CherryUsageTimelineBucket[] = days.map(([date, dayRows]) => ({ date, ...timelineMetrics(dayRows) }))
  if (!query.groupBy || rows.length === 0) {
    return { buckets: ungrouped, costTotals: [], dailyCosts: [] }
  }

  const top = statsFromRows(rows, query.groupBy, query.metric, query.limit).buckets
  const topKeys = new Set(top.map(statsBucketIdentityKey))
  const selectedGroups = new Map<string, { identity: Partial<CherryUsageTimelineBucket>; rows: UsageRecord[] }>()
  const otherBuckets: CherryUsageTimelineBucket[] = []
  for (const [date, dayRows] of days) {
    const selectedRows: UsageRecord[] = []
    const otherRows: UsageRecord[] = []
    for (const row of dayRows) {
      if (topKeys.has(timelineIdentityKey(row, query.groupBy))) selectedRows.push(row)
      else otherRows.push(row)
    }
    for (const row of selectedRows) {
      const identity = timelineIdentity(row, query.groupBy)
      const key = `${date}:${JSON.stringify(identity)}`
      const group = selectedGroups.get(key) ?? { identity, rows: [] }
      group.rows.push(row)
      selectedGroups.set(key, group)
    }
    if (otherRows.length > 0) {
      otherBuckets.push({ date, ...timelineMetrics(otherRows), isOther: true })
    }
  }
  const selected = [...selectedGroups.values()]
    .sort((left, right) => JSON.stringify(left.identity).localeCompare(JSON.stringify(right.identity)))
    .map(group => ({ date: timelineDay(group.rows[0]), ...group.identity, ...timelineMetrics(group.rows) }))
    .sort((left, right) => left.date.localeCompare(right.date))
  return { buckets: [...selected, ...otherBuckets], costTotals: [], dailyCosts: [] }
}

type UsageCursor = { value: number | null; createdAt: string; id: string }

function encodeUsageCursor(cursor: UsageCursor): string {
  return encodeURIComponent(JSON.stringify([cursor.value, cursor.createdAt, cursor.id]))
}

function decodeUsageCursor(raw: string): UsageCursor {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (!Array.isArray(parsed) || parsed.length !== 3) invalidUsageQuery('Invalid usage cursor')
    const [value, createdAt, id] = parsed
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) invalidUsageQuery('Invalid usage cursor')
    if (typeof createdAt !== 'string' || !createdAt || typeof id !== 'string' || !id) invalidUsageQuery('Invalid usage cursor')
    return { value, createdAt, id }
  } catch (error) {
    if (error instanceof UsageQueryError) throw error
    invalidUsageQuery('Invalid usage cursor')
  }
}

function usageSortValue(record: UsageRecord, sortBy: CherryUsageSortBy): number | null {
  if (sortBy === 'createdAt') return Date.parse(record.createdAt)
  if (sortBy === 'totalTokens') return usageTotalTokens(record)
  // cost, TTFT and tokens/second have no columns in ai_usage_records. Sorting them as null
  // is truthful; the remaining keyset order is still stable.
  return null
}

function compareUsageKeys(left: UsageRecord, right: UsageRecord): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
}

function compareUsageRows(left: UsageRecord, right: UsageRecord, sortBy: CherryUsageSortBy, sortOrder: CherryUsageSortOrder): number {
  if (sortBy === 'createdAt') {
    const difference = left.createdAt.localeCompare(right.createdAt)
    if (difference !== 0) return sortOrder === 'asc' ? difference : -difference
    return left.id.localeCompare(right.id)
  }
  const leftValue = usageSortValue(left, sortBy)
  const rightValue = usageSortValue(right, sortBy)
  if (leftValue === null && rightValue === null) return compareUsageKeys(left, right)
  if (leftValue === null) return 1
  if (rightValue === null) return -1
  if (leftValue === rightValue) return compareUsageKeys(left, right)
  return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue
}

function isAfterUsageCursor(record: UsageRecord, query: CherryUsageListQuery, cursor: UsageCursor): boolean {
  const afterTie = record.createdAt < cursor.createdAt
    || (record.createdAt === cursor.createdAt && record.id > cursor.id)
  if (query.sortBy === 'createdAt') {
    if (record.createdAt === cursor.createdAt) return record.id > cursor.id
    return query.sortOrder === 'asc'
      ? record.createdAt > cursor.createdAt
      : record.createdAt < cursor.createdAt
  }
  const value = usageSortValue(record, query.sortBy)
  if (cursor.value === null) return value === null && afterTie
  if (value === null) return true
  if (value === cursor.value) return afterTie
  return query.sortOrder === 'asc' ? value > cursor.value : value < cursor.value
}

export function listUsageRecords(input: unknown): CherryUsageListResponse {
  const query = parseUsageListQuery(input)
  const rows = readUsageRows(query.from, query.to)
  const ordered = [...rows].sort((left, right) => compareUsageRows(left, right, query.sortBy, query.sortOrder))
  const cursor = query.cursor !== undefined ? decodeUsageCursor(query.cursor) : undefined
  const remaining = cursor
    ? ordered.filter(row => isAfterUsageCursor(row, query, cursor))
    : ordered
  const pageRows = remaining.slice(0, query.limit)
  const tail = pageRows.at(-1)
  return {
    items: pageRows.map(row => projectUsageEntry(row, row.id)),
    total: rows.length,
    ...(remaining.length > query.limit && tail
      ? { nextCursor: encodeUsageCursor({ value: usageSortValue(tail, query.sortBy), createdAt: tail.createdAt, id: tail.id }) }
      : {})
  }
}

/** Totals in the source stats-metrics shape, with unknown token/cost values null. */
export function projectUsageTotals(): CherryUsageStatsMetrics {
  return usageMetrics(readUsageRows())
}
