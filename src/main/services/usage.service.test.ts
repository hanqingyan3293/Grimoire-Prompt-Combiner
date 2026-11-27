import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import {
  getUsageStats,
  getUsageTimeline,
  listAiUsage,
  listUsageRecords,
  recordAiUsage,
  summarizeAiUsage,
  UsageQueryError
} from './usage.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-usage-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('AI usage accounting', () => {
  it('persists a full reading', async () => {
    await initDatabase()
    const stored = recordAiUsage({
      sessionId: 's1', runtime: 'opencode', modelId: 'gpt-4o',
      inputTokens: 1200, outputTokens: 340, cachedTokens: 900
    })
    expect(stored).toMatchObject({ inputTokens: 1200, outputTokens: 340, cachedTokens: 900 })
    // Read back through a separate query, so a persistence bug cannot pass on the return value.
    expect(listAiUsage()[0]).toMatchObject({ sessionId: 's1', inputTokens: 1200, outputTokens: 340, cachedTokens: 900 })
  })

  it('writes NO row when the provider reported nothing', async () => {
    await initDatabase()
    // A provider that omits usage must not produce a zero-token entry: the source UI would
    // render that as a real measurement.
    expect(recordAiUsage({ runtime: 'opencode' })).toBeNull()
    expect(summarizeAiUsage().calls).toBe(0)
  })

  it('keeps a partial reading and leaves the missing side null, not zero', async () => {
    await initDatabase()
    recordAiUsage({ runtime: 'opencode', inputTokens: 42 })
    const record = listAiUsage()[0]
    expect(record.inputTokens).toBe(42)
    // The distinction the whole design turns on: absent, not 0.
    expect(record.outputTokens).toBeNull()
    expect(record.cachedTokens).toBeNull()
  })

  it('treats a genuine zero as a reading and absent as null', async () => {
    await initDatabase()
    recordAiUsage({ runtime: 'opencode', inputTokens: 0, outputTokens: 0 })
    const record = listAiUsage()[0]
    expect(record.inputTokens).toBe(0)
    expect(record.outputTokens).toBe(0)
  })

  it('rejects non-finite counts instead of coercing them', async () => {
    await initDatabase()
    // `Number(null)` is 0 and `NaN` is not a token count; neither may become a stored 0.
    const stored = recordAiUsage({ runtime: 'opencode', inputTokens: Number.NaN as never, outputTokens: 5 })
    expect(stored?.inputTokens).toBeNull()
    expect(stored?.outputTokens).toBe(5)
  })

  it('summarizes totals, and answers null totals when every record is partial', async () => {
    await initDatabase()
    recordAiUsage({ runtime: 'a', inputTokens: 10, outputTokens: 1 })
    recordAiUsage({ runtime: 'b', inputTokens: 20, outputTokens: 2, cachedTokens: 5 })
    expect(summarizeAiUsage()).toEqual({ calls: 2, inputTokens: 30, outputTokens: 3, cachedTokens: 5 })

    closeDatabase()
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-usage-'))
    await initDatabase()
    recordAiUsage({ runtime: 'a', inputTokens: 10 })
    // `sum()` over an all-NULL column returns NULL; the UI shows "—" for that, so the null
    // is carried through rather than flattened to 0.
    expect(summarizeAiUsage().cachedTokens).toBeNull()
  })

  it('lists newest first and honours the limit', async () => {
    await initDatabase()
    for (let index = 0; index < 5; index += 1) {
      recordAiUsage({ runtime: 'a', modelId: 'm' + index, inputTokens: index + 1 })
    }
    expect(listAiUsage(3)).toHaveLength(3)
    expect(listAiUsage()).toHaveLength(5)
    // Newest first. `created_at` only has millisecond resolution, so two inserts inside the
    // same millisecond tie; the service breaks ties by rowid (insertion order) rather than by
    // a random UUID, which is what makes this assertion deterministic.
    expect(listAiUsage().map(record => record.modelId)).toEqual(['m4', 'm3', 'm2', 'm1', 'm0'])
  })
})

describe('source AI usage read models', () => {
  type Seed = {
    id: string
    providerId?: string
    modelId?: string
    sessionId?: string
    inputTokens?: number | null
    outputTokens?: number | null
    cachedTokens?: number | null
    createdAt: string
  }

  function seedUsage(rows: Seed[]): void {
    for (const row of rows) {
      getDatabase().run(
        'INSERT INTO ai_usage_records (id,session_id,message_id,runtime,protocol,provider_id,model_id,input_tokens,output_tokens,cached_tokens,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [
          row.id, row.sessionId ?? null, null, 'opencode', 'chat', row.providerId ?? '', row.modelId ?? '',
          row.inputTokens ?? null, row.outputTokens ?? null, row.cachedTokens ?? null, row.createdAt
        ]
      )
    }
  }

  const from = Date.parse('2026-03-01T00:00:00.000Z')
  const to = Date.parse('2026-03-04T00:00:00.000Z')
  const outside = Date.parse('2026-02-20T00:00:00.000Z')
  const after = Date.parse('2026-04-20T00:00:00.000Z')

  it('range-filters real rows and returns real provider/model counts, with unknown tokens still null', async () => {
    await initDatabase()
    seedUsage([
      { id: 'a', providerId: 'p1', modelId: 'm1', inputTokens: 100, outputTokens: 20, cachedTokens: 5, createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 'b', providerId: 'p1', modelId: 'm1', inputTokens: 50, outputTokens: null, cachedTokens: null, createdAt: '2026-03-02T12:00:00.000Z' },
      { id: 'c', providerId: 'p2', modelId: 'm2', inputTokens: 30, outputTokens: 10, cachedTokens: null, createdAt: '2026-03-03T12:00:00.000Z' },
      { id: 'before', providerId: 'p1', modelId: 'm1', inputTokens: 999, outputTokens: 999, createdAt: new Date(outside).toISOString() },
      { id: 'after', providerId: 'p2', modelId: 'm2', inputTokens: 999, outputTokens: 999, createdAt: new Date(after).toISOString() }
    ])

    const stats = getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 10, from, to })
    expect(stats.totals).toEqual({
      costCurrency: null,
      totalCost: null,
      totalInputTokens: 180,
      totalOutputTokens: 30,
      totalTokens: 210,
      totalNoCacheTokens: null,
      totalCacheReadTokens: 5,
      totalCacheWriteTokens: null,
      recordCount: 3,
      requestCount: 3,
      estimatedRequestCount: 0,
      unpricedRequestCount: 3
    })
    expect(stats.buckets).toHaveLength(2)
    expect(stats.buckets[0]).toMatchObject({
      groupBy: 'provider', providerId: 'p1', providerName: null,
      totalInputTokens: 150, totalOutputTokens: 20, totalTokens: 170,
      totalCacheReadTokens: 5, recordCount: 2, requestCount: 2, totalCost: null, costCurrency: null
    })
    expect(stats.buckets[1]).toMatchObject({
      groupBy: 'provider', providerId: 'p2', providerName: null,
      totalInputTokens: 30, totalOutputTokens: 10, totalTokens: 40, recordCount: 1
    })

    const models = getUsageStats({ groupBy: 'model', metric: 'tokens', limit: 10, from, to })
    expect(models.buckets.map(bucket => (bucket as any).modelId)).toEqual(['m1', 'm2'])
  })

  it('keeps wholly unknown token totals null in stats, timeline and entries', async () => {
    await initDatabase()
    seedUsage([
      { id: 'u1', providerId: 'p1', modelId: 'm1', sessionId: 's1', createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 'u2', providerId: 'p1', modelId: 'm1', sessionId: 's1', createdAt: '2026-03-02T12:00:00.000Z' }
    ])

    const stats = getUsageStats({ groupBy: 'model', metric: 'tokens', limit: 10, from, to })
    expect(stats.totals).toMatchObject({
      totalInputTokens: null, totalOutputTokens: null, totalTokens: null,
      totalCacheReadTokens: null, totalCost: null, costCurrency: null,
      recordCount: 2, requestCount: 2, unpricedRequestCount: 2
    })
    expect(stats.buckets[0]).toMatchObject({ totalTokens: null, totalInputTokens: null, totalOutputTokens: null, totalCost: null })

    const timeline = getUsageTimeline({ metric: 'tokens', limit: 10, from, to })
    expect(timeline.costTotals).toEqual([])
    expect(timeline.dailyCosts).toEqual([])
    expect(timeline.buckets).toHaveLength(2)
    expect(timeline.buckets[0]).toMatchObject({ totalTokens: null, totalCost: null, costCurrency: null, requestCount: 1 })

    const page = listUsageRecords({ limit: 10 })
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({ totalTokens: null, cost: null, costCurrency: null, requestCount: 1 })
  })

  it('returns an explicit empty contract instead of fabricated zero token buckets', async () => {
    await initDatabase()

    const stats = getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 10, from, to })
    expect(stats).toMatchObject({ buckets: [], totals: { recordCount: 0, requestCount: 0, totalTokens: null, totalCost: null, costCurrency: null }, other: { recordCount: 0, totalTokens: null } })

    const timeline = getUsageTimeline({ metric: 'tokens', limit: 10, from, to, groupBy: 'provider' })
    expect(timeline).toEqual({ buckets: [], costTotals: [], dailyCosts: [] })

    const page = listUsageRecords({ limit: 10 })
    expect(page).toEqual({ items: [], total: 0 })
  })

  it('ranks top groups and emits only real remainder buckets', async () => {
    await initDatabase()
    seedUsage([
      { id: 't1', providerId: 'p1', modelId: 'm1', inputTokens: 100, outputTokens: 0, createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 't2', providerId: 'p1', modelId: 'm1', inputTokens: 50, outputTokens: 0, createdAt: '2026-03-02T12:00:00.000Z' },
      { id: 't3', providerId: 'p2', modelId: 'm2', inputTokens: 40, outputTokens: 0, createdAt: '2026-03-02T13:00:00.000Z' },
      { id: 't4', providerId: 'p3', modelId: 'm3', inputTokens: 10, outputTokens: 0, createdAt: '2026-03-03T12:00:00.000Z' }
    ])

    const stats = getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 1, from, to })
    expect(stats.buckets).toHaveLength(1)
    expect(stats.buckets[0]).toMatchObject({ providerId: 'p1', totalTokens: 150 })
    expect(stats.other).toMatchObject({ recordCount: 2, requestCount: 2, totalTokens: 50 })

    const timeline = getUsageTimeline({ groupBy: 'provider', metric: 'tokens', limit: 1, from, to })
    expect(timeline.buckets.filter(bucket => !bucket.isOther).map(bucket => (bucket as any).providerId)).toEqual(['p1', 'p1'])
    expect(timeline.buckets.filter(bucket => bucket.isOther)).toEqual([
      expect.objectContaining({ date: '2026-03-02', totalTokens: 40, requestCount: 1, isOther: true }),
      expect.objectContaining({ date: '2026-03-03', totalTokens: 10, requestCount: 1, isOther: true })
    ])
  })

  it('does not turn an unknown remainder group into zero tokens', async () => {
    await initDatabase()
    seedUsage([
      { id: 'r1', providerId: 'known', inputTokens: 100, outputTokens: 0, createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 'r2', providerId: 'unknown', inputTokens: null, outputTokens: null, createdAt: '2026-03-02T12:00:00.000Z' }
    ])

    const stats = getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 1, from, to })
    expect(stats.buckets[0]).toMatchObject({ providerId: 'known', totalTokens: 100 })
    expect(stats.totals.totalTokens).toBe(100)
    expect(stats.other).toMatchObject({ recordCount: 1, requestCount: 1, totalTokens: null })
  })

  it('pages with a stable opaque cursor instead of repeating the first page', async () => {
    await initDatabase()
    seedUsage([
      { id: 'c1', inputTokens: 1, createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 'c2', inputTokens: 2, createdAt: '2026-03-02T00:00:00.000Z' },
      { id: 'c3', inputTokens: 3, createdAt: '2026-03-03T00:00:00.000Z' },
      { id: 'c4', inputTokens: 4, createdAt: '2026-03-04T00:00:00.000Z' },
      { id: 'c5', inputTokens: 5, createdAt: '2026-03-05T00:00:00.000Z' }
    ])

    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = listUsageRecords({ limit: 2, sortBy: 'createdAt', sortOrder: 'desc', cursor })
      expect(page.total).toBe(5)
      ids.push(...page.items.map(item => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toEqual(['c5', 'c4', 'c3', 'c2', 'c1'])

    expect(() => listUsageRecords({ cursor: 'not-a-cursor' })).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR', status: 400
    }))
  })

  it('keeps a metric cursor stable across known and unknown token values', async () => {
    await initDatabase()
    seedUsage([
      { id: 'k1', inputTokens: 100, createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 'k2', inputTokens: null, createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 'k3', inputTokens: 50, createdAt: '2026-03-01T12:00:00.000Z' },
      { id: 'k4', inputTokens: null, createdAt: '2026-03-01T12:00:00.000Z' }
    ])

    const readAll = (sortOrder: 'asc' | 'desc') => {
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = listUsageRecords({ limit: 2, sortBy: 'totalTokens', sortOrder, cursor })
        ids.push(...page.items.map(item => item.id))
        cursor = page.nextCursor
      } while (cursor)
      return ids
    }
    expect(readAll('desc')).toEqual(['k1', 'k3', 'k2', 'k4'])
    expect(readAll('asc')).toEqual(['k3', 'k1', 'k2', 'k4'])
  })

  it('validates strict source query fields and refuses an unrepresentable message filter', async () => {
    await initDatabase()
    const invalid = (run: () => unknown) => expect(run).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 }))
    invalid(() => getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 10 }))
    invalid(() => getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 10, from: to, to: from }))
    invalid(() => getUsageStats({ groupBy: 'provider', metric: 'tokens', limit: 10, from, to: from + 367 * 24 * 60 * 60 * 1000 }))
    invalid(() => getUsageStats({ groupBy: 'date', metric: 'tokens', limit: 10, from, to }))
    invalid(() => getUsageStats({ groupBy: 'provider', metric: 'cost', limit: 10, from, to }))
    invalid(() => listUsageRecords({ sortBy: 'cost' }))
    invalid(() => listUsageRecords({ messageKind: 'chat' }))
    invalid(() => listUsageRecords({ unknown: true }))
    invalid(() => getUsageTimeline({ metric: 'tokens', limit: 10, from, to, groupBy: 'date' }))

    expect(() => listUsageRecords({ messageKind: 'chat', messageId: 'message-1' })).toThrow(expect.objectContaining({
      code: 'NOT_IMPLEMENTED', status: 501
    }))
    expect(new UsageQueryError(400, 'VALIDATION_ERROR', 'bad').message).toBe('bad')
  })
})
