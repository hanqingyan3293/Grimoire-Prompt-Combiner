import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'

/**
 * Token accounting for model calls.
 *
 * Grimoire had no usage capture at all before this (`src/main/ai/` contained no token/usage
 * reference), so `/settings/usage` had nothing to read. This is the write half; the three
 * source read endpoints are a separate step (see `.agent/PLAN.md` M3.4; the original note
 * lived in the archived `.agent/history/2026-10-27/REMAINING_WORK.md`, item A4).
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
    'SELECT id,session_id,message_id,runtime,protocol,provider_id,model_id,input_tokens,output_tokens,cached_tokens,created_at FROM ai_usage_records ORDER BY created_at DESC, id DESC LIMIT ?',
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
 * produced them. `modality` is always `'text'` because only the text path reports usage today;
 * a non-text call would produce no `usage` event at all rather than a mislabelled one.
 */
export function projectUsageEntry(record: UsageRecord, id: string): Record<string, unknown> {
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
    messageKind: record.messageId ? 'assistant' : null,
    messageId: record.messageId,
    providerId: record.providerId || null,
    providerName: null,
    sourceType: null,
    sourceId: record.sessionId,
    sourceName: null,
    sourceIcon: null,
    modelId: record.modelId || null,
    modelName: record.modelId || null,
    modality: 'text',
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

/** Totals in the source `AiUsageRecordStatsMetrics` shape. */
export function projectUsageTotals(): Record<string, unknown> {
  const totals = summarizeAiUsage()
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.inputTokens === null && totals.outputTokens === null
      ? null
      : (totals.inputTokens ?? 0) + (totals.outputTokens ?? 0),
    reasoningTokens: null,
    noCacheTokens: null,
    cacheReadTokens: totals.cachedTokens,
    cacheWriteTokens: null,
    imageCount: null,
    totalCost: null,
    costCurrency: null,
    recordCount: totals.calls,
    requestCount: totals.calls
  }
}

/**
 * Daily buckets for the timeline, grouped by UTC date.
 *
 * Buckets are keyed by date alone (`groupBy: 'date'`) because Grimoire's records carry no
 * provider/model attribution strong enough to split a day by group without inventing
 * groupings the source UI would then present as real.
 */
export function listUsageTimeline(): Array<Record<string, unknown>> {
  const rows = getDatabase().exec(
    "SELECT substr(created_at,1,10) AS day, count(*), sum(input_tokens), sum(output_tokens), sum(cached_tokens) FROM ai_usage_records GROUP BY day ORDER BY day DESC LIMIT 400"
  )[0]?.values || []
  return rows.map(row => {
    const input = row[2] === null || row[2] === undefined ? null : Number(row[2])
    const output = row[3] === null || row[3] === undefined ? null : Number(row[3])
    const cached = row[4] === null || row[4] === undefined ? null : Number(row[4])
    return {
      date: String(row[0] || ''),
      groupBy: 'date',
      isOther: false,
      providerId: null,
      providerName: null,
      sourceType: null,
      sourceId: null,
      sourceName: null,
      sourceIcon: null,
      modelId: null,
      apiKeyId: null,
      apiKeyLabel: null,
      apiKeyMasked: null,
      apiKeyAttribution: 'unknown',
      authMethod: null,
      totalTokens: input === null && output === null ? null : (input ?? 0) + (output ?? 0),
      totalNoCacheTokens: null,
      totalCacheReadTokens: cached,
      totalCacheWriteTokens: null,
      totalCost: null,
      costCurrency: null,
      recordCount: Number(row[1] || 0),
      requestCount: Number(row[1] || 0)
    }
  })
}
