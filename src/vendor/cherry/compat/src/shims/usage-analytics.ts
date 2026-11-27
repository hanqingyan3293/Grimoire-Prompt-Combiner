import type {
  AiUsageRecordDailyCost,
  AiUsageRecordGroupIdentity,
  AiUsageRecordTimelineBucket
} from '@shared/data/api/schemas/aiUsageRecords'
import type { Currency } from '@shared/data/types/model'

import {
  DEFAULT_COST_CURRENCY,
  parseDateKey,
  startOfLocalDay,
  toDateKey
} from '../../../source/src/renderer/pages/settings/UsageSettings/usageDisplay'
import {
  endOfLocalDay,
  getBucketKey,
  toPeriodKey
} from '../../../source/src/renderer/pages/settings/UsageSettings/usageAnalytics'

/**
 * Compat-only analytics shim for the source Usage dashboard.
 *
 * The source math assumes every aggregate is a number. Grimoire keeps an
 * unmeasured token or cost total as `null`. Reuse the source module's public
 * surface, then override only the functions that previously coerced `null` to
 * zero. A missing day remains a genuine `0`; a present-but-unmeasured bucket is
 * represented as a chart gap (`null`).
 */
export * from '../../../source/src/renderer/pages/settings/UsageSettings/usageAnalytics'

type SortMetric = 'tokens' | 'requests' | 'cost'
type Rollup = 'total' | 'daily' | 'weekly' | 'monthly'

export interface CompatUsageChartSeries {
  key: string
  identity?: AiUsageRecordGroupIdentity
  values: Array<number | null>
  total: number
}

interface MetricSource {
  totalTokens?: number | null
  totalCost?: number | null
  requestCount?: number | null
}

function knownNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Empty reads carry unknown token/cost totals, matching the backend's response. */
export const EMPTY_STATS_METRICS = {
  costCurrency: null,
  totalCost: null,
  totalInputTokens: null,
  totalOutputTokens: null,
  totalTokens: null,
  totalNoCacheTokens: null,
  totalCacheReadTokens: null,
  totalCacheWriteTokens: null,
  recordCount: 0,
  requestCount: 0,
  estimatedRequestCount: 0,
  unpricedRequestCount: 0
}

/** Unknown daily cost stays unknown; a supplied daily zero stays a zero. */
export function applyTimelineCurrency(
  buckets: AiUsageRecordTimelineBucket[],
  dailyCosts: AiUsageRecordDailyCost[],
  currency: Currency | undefined
): AiUsageRecordTimelineBucket[] {
  const costs = new Map(
    dailyCosts.filter(item => item.currency === currency).map(item => [item.date, item.total] as const)
  )

  return buckets.map(bucket => {
    const direct = knownNumber(bucket.totalCost)
    const daily = currency !== undefined ? costs.get(bucket.date) : undefined
    const totalCost = daily !== undefined
      ? daily
      : currency !== undefined
        ? (bucket.costCurrency === currency ? direct : null)
        : direct

    return {
      ...bucket,
      costCurrency: currency ?? bucket.costCurrency ?? null,
      totalCost
    } as unknown as AiUsageRecordTimelineBucket
  })
}

/** A partially observed cache breakdown has no honest hit rate. */
export function getCacheUsageMetrics(
  buckets: Array<{
    totalNoCacheTokens?: number | null
    totalCacheReadTokens?: number | null
    totalCacheWriteTokens?: number | null
  }>
) {
  let noCacheTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let hasUnknown = false

  for (const bucket of buckets) {
    const noCache = knownNumber(bucket.totalNoCacheTokens)
    const cacheRead = knownNumber(bucket.totalCacheReadTokens)
    const cacheWrite = knownNumber(bucket.totalCacheWriteTokens)
    if (noCache === null) hasUnknown = true
    else noCacheTokens += noCache
    if (cacheRead === null) hasUnknown = true
    else cacheReadTokens += cacheRead
    if (cacheWrite === null) hasUnknown = true
    else cacheWriteTokens += cacheWrite
  }

  const observableTokens = hasUnknown ? null : noCacheTokens + cacheReadTokens + cacheWriteTokens
  return {
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens,
    observableTokens,
    hitRate: observableTokens !== null && observableTokens > 0 ? cacheReadTokens / observableTokens : undefined
  }
}

/** Requests are always known; token and cost aggregates may be unknown. */
export function getMetricValue(bucket: MetricSource, metric: SortMetric): number | null {
  if (metric === 'requests') return knownNumber(bucket.requestCount) ?? 0
  if (metric === 'cost') return knownNumber(bucket.totalCost)
  return knownNumber(bucket.totalTokens)
}

/** Fill absent calendar days with a real zero, not a present-but-unknown bucket. */
export function getTimelinePoints(
  buckets: AiUsageRecordTimelineBucket[],
  range: { from?: number; to?: number },
  getValue: (bucket: AiUsageRecordTimelineBucket) => number | null
): Array<{ date: string; value: number | null }> {
  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  const from = range.from ?? (first ? startOfLocalDay(parseDateKey(first.date)).getTime() : undefined)
  const to = range.to ?? (last ? endOfLocalDay(parseDateKey(last.date)).getTime() : undefined)
  if (from === undefined || to === undefined) return []

  const byDate = new Map(buckets.map(bucket => [bucket.date, getValue(bucket)] as const))
  const points: Array<{ date: string; value: number | null }> = []
  const cursor = startOfLocalDay(new Date(from))
  const end = endOfLocalDay(new Date(to))

  while (cursor.getTime() <= end.getTime()) {
    const date = toDateKey(cursor)
    const value = byDate.get(date)
    points.push({ date, value: value === undefined ? 0 : knownNumber(value) })
    cursor.setDate(cursor.getDate() + 1)
  }

  return points
}

function getScopedCost(
  bucket: { costCurrency?: Currency | null; totalCost?: number | null },
  currency: Currency | undefined
): number | null | undefined {
  const value = knownNumber(bucket.totalCost)
  if (currency === undefined) return value
  if ((bucket.costCurrency ?? DEFAULT_COST_CURRENCY) !== currency) return undefined
  return value
}

function chartMetricValue(
  bucket: AiUsageRecordTimelineBucket,
  metric: SortMetric,
  currency: Currency | undefined
): number | null | undefined {
  if (metric === 'requests') return knownNumber(bucket.requestCount) ?? 0
  if (metric === 'cost') return getScopedCost(bucket, currency)
  return knownNumber(bucket.totalTokens)
}

/** Preserve unknown positions as gaps; a known zero is still a plotted zero. */
export function buildChartSeries(
  buckets: AiUsageRecordTimelineBucket[],
  periodKeys: string[],
  options: {
    rollup: Rollup
    metric: SortMetric
    currency?: Currency
    topCount: number
    firstDayOfWeek: number
  }
): CompatUsageChartSeries[] {
  const positions = new Map(periodKeys.map((key, index) => [key, index] as const))
  const groups = new Map<string, CompatUsageChartSeries>()

  for (const bucket of buckets) {
    const position = positions.get(toPeriodKey(bucket.date, options.rollup, options.firstDayOfWeek))
    if (position === undefined) continue

    const value = chartMetricValue(bucket, options.metric, options.currency)
    if (value === undefined) continue

    const key = getBucketKey(bucket)
    let series = groups.get(key)
    if (!series) {
      series = {
        key,
        ...(bucket.isOther ? {} : { identity: { ...bucket } as AiUsageRecordGroupIdentity }),
        values: periodKeys.map(() => 0),
        total: 0
      }
      groups.set(key, series)
    }

    if (value === null) {
      series.values[position] = null
      continue
    }
    if (series.values[position] === null) continue
    series.values[position] = (series.values[position] ?? 0) + value
    series.total += value
  }

  const serverOther = groups.get('other')
  const ranked = [...groups.values()]
    .filter(series => series.key !== 'other' && series.total > 0)
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key))
  const other: CompatUsageChartSeries = serverOther ?? {
    key: 'other',
    values: periodKeys.map(() => 0),
    total: 0
  }

  for (const series of ranked.slice(options.topCount)) {
    for (const [index, value] of series.values.entries()) {
      if (value === null) {
        other.values[index] = null
      } else if (other.values[index] !== null) {
        other.values[index] = (other.values[index] ?? 0) + value
      }
    }
    other.total += series.total
  }

  const top = ranked.slice(0, options.topCount)
  return other.total > 0 ? [...top, other] : top
}

export function getTimelineSeries(
  buckets: AiUsageRecordTimelineBucket[],
  range: { from?: number; to?: number },
  getValue: (bucket: AiUsageRecordTimelineBucket) => number | null
): Array<number | null> {
  const points = getTimelinePoints(buckets, range, getValue)
  return (range.from !== undefined && range.to !== undefined ? points : points.slice(-64)).map(point => point.value)
}

export function getRatioChange(
  current: number | null | undefined,
  previous: number | null | undefined
): number | undefined {
  if (current === null || current === undefined || previous === null || previous === undefined) return undefined
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return undefined
  return (current - previous) / previous
}
