import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AiUsageRecordTimelineBucket } from '@shared/data/api/schemas/aiUsageRecords'
import i18n from '../../source/src/renderer/i18n/resolver'

import * as usageDisplay from '@renderer/pages/settings/UsageSettings/usageDisplay'
import { formatCompactNumber as rendererFormatCompactNumber } from '@renderer/utils/number'
import {
  applyTimelineCurrency,
  buildChartSeries,
  getMetricValue,
  getRatioChange,
  getTimelinePoints
} from '@renderer/pages/settings/UsageSettings/usageAnalytics'

const usageData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@cherrystudio/ui', async importOriginal => importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/hooks/useProvider', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@renderer/pages/settings/UsageSettings/UsageDistributionChart', () => ({
  UsageDistributionChart: () => null
}))
vi.mock('@renderer/pages/settings/UsageSettings/UsageEntriesTable', () => ({
  UsageEntriesTable: () => null
}))
vi.mock('@renderer/pages/settings/UsageSettings/useUsageData', () => {
  const metrics = {
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
  return {
    useUsageData: () => ({
      costTotals: [],
      costCurrency: undefined,
      timelineBuckets: [],
      overviewBuckets: [],
      exploreBuckets: [],
      exploreTimelineRows: [],
      overviewTotals: metrics,
      previousOverviewTotals: metrics,
      exploreTotals: metrics,
      exploreOther: metrics,
      timelineLoading: false,
      overviewLoading: false,
      exploreStatsLoading: false,
      exploreTimelineLoading: false,
      ...usageData.current
    }),
    useUsageEntriesData: () => ({
      entries: [],
      total: 0,
      isLoading: false,
      isRefreshing: false,
      hasNext: false,
      loadNext: vi.fn()
    })
  }
})

import UsageSettings from '@renderer/pages/settings/UsageSettings/UsageSettings'
import UsageHeatmap from '@renderer/pages/settings/UsageSettings/UsageHeatmap'
import { unknownAwareTooltipFormatter } from './shims/usage-chart'

type NullableNumberFormatter = (value: number | null | undefined) => string
const formatUsageNumber = (usageDisplay as typeof usageDisplay & { formatUsageNumber: NullableNumberFormatter })
  .formatUsageNumber

function bucket(date: string, overrides: Record<string, unknown> = {}): AiUsageRecordTimelineBucket {
  return {
    date,
    costCurrency: 'USD',
    totalTokens: 0,
    totalNoCacheTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    recordCount: 1,
    requestCount: 1,
    estimatedRequestCount: 0,
    unpricedRequestCount: 0,
    ...overrides
  } as unknown as AiUsageRecordTimelineBucket
}

const unknownBucket = (date: string, overrides: Record<string, unknown> = {}): AiUsageRecordTimelineBucket =>
  bucket(date, {
    costCurrency: null,
    totalTokens: null,
    totalNoCacheTokens: null,
    totalCacheReadTokens: null,
    totalCacheWriteTokens: null,
    totalCost: null,
    unpricedRequestCount: 1,
    ...overrides
  })

describe('usage null-aware display helpers', () => {
  it('separates an unknown cost from a genuine zero cost', () => {
    expect(usageDisplay.formatCost(null as unknown as number, 'USD')).toBe('—')
    expect(usageDisplay.formatCost(undefined as unknown as number, 'USD')).toBe('—')
    expect(usageDisplay.formatCost(0, 'USD')).toBe('$0.00')
  })

  it('separates an unknown count from a genuine zero count', () => {
    expect(formatUsageNumber(null)).toBe('—')
    expect(formatUsageNumber(undefined)).toBe('—')
    expect(formatUsageNumber(0)).toBe('0')
    expect(formatUsageNumber(Number.NaN)).toBe('—')
  })

  it('scopes the null-aware number formatter to UsageSettings', () => {
    // This test file is outside the UsageSettings directory, so it must still
    // receive the renderer-wide source formatter and its original behavior.
    expect(rendererFormatCompactNumber(null as unknown as number)).toBe('0')
  })

  it('keeps unknown cost unknown while preserving a known zero day', () => {
    const unknown = applyTimelineCurrency([unknownBucket('2026-03-01')], [], undefined)
    expect(unknown[0]).toMatchObject({ costCurrency: null, totalCost: null })

    const zero = applyTimelineCurrency(
      [bucket('2026-03-01', { totalCost: 0 })],
      [{ currency: 'USD', date: '2026-03-01', total: 0 }],
      'USD'
    )
    expect(zero[0]).toMatchObject({ costCurrency: 'USD', totalCost: 0 })
  })

  it('uses null for an unknown bucket and zero only for a missing day', () => {
    const from = new Date(2026, 2, 1).getTime()
    const to = new Date(2026, 2, 3, 23, 59, 59, 999).getTime()
    const points = getTimelinePoints(
      [unknownBucket('2026-03-02'), bucket('2026-03-03', { totalTokens: 0 })],
      { from, to },
      value => value.totalTokens
    )

    expect(points).toEqual([
      { date: '2026-03-01', value: 0 },
      { date: '2026-03-02', value: null },
      { date: '2026-03-03', value: 0 }
    ])
  })

  it('leaves chart gaps for unknown values and keeps known zero points', () => {
    const periods = ['2026-03-01', '2026-03-02', '2026-03-03']
    const series = buildChartSeries(
      [
        bucket('2026-03-01', { modelId: 'a', totalTokens: 10 }),
        unknownBucket('2026-03-02', { modelId: 'a' }),
        bucket('2026-03-03', { modelId: 'a', totalTokens: 0 })
      ],
      periods,
      { rollup: 'daily', metric: 'tokens', topCount: 10, firstDayOfWeek: 0 }
    )

    expect(series[0].values).toEqual([10, null, 0])
    expect(series[0].total).toBe(10)
  })

  it('does not invent a zero cost series for an unknown cost', () => {
    const series = buildChartSeries(
      [unknownBucket('2026-03-01'), bucket('2026-03-02', { totalCost: 0 })],
      ['2026-03-01', '2026-03-02'],
      { rollup: 'daily', metric: 'cost', currency: 'USD', topCount: 10, firstDayOfWeek: 0 }
    )

    expect(series).toEqual([])
  })

  it('keeps null distinct from zero in metric values and deltas', () => {
    expect(getMetricValue({ totalTokens: null, totalCost: null, requestCount: 0 } as never, 'tokens')).toBeNull()
    expect(getMetricValue({ totalTokens: null, totalCost: null, requestCount: 0 } as never, 'requests')).toBe(0)
    expect(getMetricValue({ totalTokens: null, totalCost: null, requestCount: 0 } as never, 'cost')).toBeNull()
    expect(getRatioChange(null as unknown as number, 10)).toBeUndefined()
    expect(getRatioChange(0, 10)).toBe(-1)
  })

  it('keeps a chart tooltip gap out of the numeric cost formatter', () => {
    const costFormatter = (value: unknown) => `$${Number(value).toFixed(2)}`
    const format = unknownAwareTooltipFormatter(costFormatter)

    expect(format(null)).toBe('—')
    expect(format(undefined)).toBe('—')
    expect(format('')).toBe('—')
    expect(format(0)).toBe('$0.00')
  })
})

describe('UsageSettings null presentation', () => {
  const metrics = {
    costCurrency: null,
    totalCost: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalTokens: null,
    totalNoCacheTokens: null,
    totalCacheReadTokens: null,
    totalCacheWriteTokens: null,
    recordCount: 1,
    requestCount: 1,
    estimatedRequestCount: 0,
    unpricedRequestCount: 1
  }

  const unknownTimeline = [unknownBucket('2026-03-01')]

  beforeEach(() => {
    usageData.current = {
      timelineBuckets: unknownTimeline,
      overviewTotals: metrics,
      previousOverviewTotals: metrics,
      exploreTotals: metrics
    }
  })

  it('shows an unknown token total as an em dash instead of zero', () => {
    render(<UsageSettings />)

    const tokenCard = screen.getByText(i18n.t('settings.usage.cards.totalTokens')).parentElement
    expect(tokenCard).not.toBeNull()
    expect(within(tokenCard!).getByText('—')).toBeInTheDocument()
    expect(tokenCard).not.toHaveTextContent(/\b0\b/)
    expect(
      screen.getByText((_content, element) =>
        element?.tagName === 'P' && Boolean(element.textContent?.includes('—'))
      )
    ).toBeInTheDocument()
  })

  it('still renders a genuine zero token total as zero', () => {
    usageData.current = {
      timelineBuckets: [bucket('2026-03-01', { totalTokens: 0 })],
      overviewTotals: { ...metrics, totalTokens: 0, unpricedRequestCount: 0 },
      previousOverviewTotals: { ...metrics, totalTokens: 0, unpricedRequestCount: 0 },
      exploreTotals: { ...metrics, totalTokens: 0, unpricedRequestCount: 0 }
    }

    render(<UsageSettings />)

    const tokenCard = screen.getByText(i18n.t('settings.usage.cards.totalTokens')).parentElement
    expect(within(tokenCard!).getByText('0')).toBeInTheDocument()
    expect(tokenCard).not.toHaveTextContent('—')
  })

  it('shows an unknown cost as an em dash when a currency is selected', () => {
    usageData.current = {
      costTotals: [{ currency: 'USD', total: 0 }],
      costCurrency: 'USD',
      timelineBuckets: unknownTimeline,
      overviewTotals: metrics,
      previousOverviewTotals: metrics,
      exploreTotals: metrics
    }

    render(<UsageSettings />)

    const costCard = screen.getByText(i18n.t('settings.usage.cards.totalCost')).parentElement
    expect(costCard).not.toBeNull()
    expect(within(costCard!).getByText('—')).toBeInTheDocument()
    expect(costCard).not.toHaveTextContent('$0.00')
  })
})

describe('UsageHeatmap null presentation', () => {
  it('marks an unknown bucket differently from a genuine zero day', () => {
    const range = {
      from: new Date(2026, 2, 1).getTime(),
      to: new Date(2026, 2, 2, 23, 59, 59, 999).getTime()
    }

    render(
      <UsageHeatmap
        buckets={[unknownBucket('2026-03-01'), bucket('2026-03-02', { totalTokens: 0 })]}
        range={range}
      />
    )

    const unknownCell = screen.getByLabelText(/— tokens/)
    const zeroCell = screen.getByLabelText(/0 tokens/)
    expect(unknownCell.className).toContain('bg-muted/30')
    expect(unknownCell.className).toContain('ring-border')
    expect(zeroCell.className).toContain('bg-muted/70')
    expect(unknownCell.className).not.toBe(zeroCell.className)
  })
})
