import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, NormalTooltip, Skeleton } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { cn } from '@renderer/utils/style'
import { getLocaleFirstDayOfWeek } from '@renderer/utils/time'
import type { AiUsageRecordTimelineBucket } from '@shared/data/api/schemas/aiUsageRecords'

import { buildHeatmapDays } from '../../../source/src/renderer/pages/settings/UsageSettings/UsageHeatmap'
import { formatCost, formatUsageNumber } from './usage-display'
import { UsagePanelTitle } from './usage-primitives'

/**
 * Compat-only heatmap for the source Usage dashboard.
 *
 * Source `getBucketValue` maps both an absent day and an unmeasured bucket to
 * `0`. This shim keeps the source calendar construction (`buildHeatmapDays`) but
 * distinguishes an absent day (genuine zero) from a present bucket whose total
 * is unknown. Unknown cells get a distinct surface and an em-dash tooltip.
 */

export type UsageHeatmapMetric = 'tokens' | 'cost'

const CELL_SIZE = 12
const CELL_GAP = 3

function knownNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBucketValue(bucket: AiUsageRecordTimelineBucket | undefined, metric: UsageHeatmapMetric): number | null {
  if (!bucket) return 0
  return knownNumber(metric === 'cost' ? bucket.totalCost : bucket.totalTokens)
}

function quantile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))
  return sorted[index]
}

type Intensity = 0 | 1 | 2 | 3 | 4 | 'unknown'

function getIntensity(value: number | null, thresholds: [number, number, number]): Intensity {
  if (value === null) return 'unknown'
  if (value <= 0) return 0
  if (value <= thresholds[0]) return 1
  if (value <= thresholds[1]) return 2
  if (value <= thresholds[2]) return 3
  return 4
}

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const updateWidth = () => setWidth(element.clientWidth)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

interface UsageHeatmapProps {
  buckets: AiUsageRecordTimelineBucket[]
  costCurrency?: string | null
  isLoading?: boolean
  range?: { from?: number; to?: number }
}

const intensityClassNames: Record<Intensity, string> = {
  0: 'bg-muted/70',
  1: 'bg-primary/25',
  2: 'bg-primary/45',
  3: 'bg-primary/70',
  4: 'bg-primary',
  unknown: 'bg-muted/30 ring-1 ring-border ring-inset'
}

export default function UsageHeatmap({ buckets, costCurrency, isLoading, range }: UsageHeatmapProps) {
  const { t, i18n } = useTranslation()
  const [metric, setMetric] = usePersistCache('settings.usage.heatmap_metric')
  const { ref: heatmapRef, width: heatmapWidth } = useElementWidth()
  const animationRef = useRef<HTMLDivElement>(null)

  const firstDayOfWeek = useMemo(() => getLocaleFirstDayOfWeek(i18n.resolvedLanguage), [i18n.resolvedLanguage])
  const days = useMemo(() => buildHeatmapDays(buckets, range, firstDayOfWeek), [buckets, firstDayOfWeek, range])
  const weeks = useMemo(
    () => Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7)),
    [days]
  )
  const bucketMap = useMemo(() => new Map(buckets.map(bucket => [bucket.date, bucket])), [buckets])
  const thresholds = useMemo(() => {
    const values = buckets
      .map(bucket => getBucketValue(bucket, metric))
      .filter((value): value is number => value !== null && value > 0)
      .sort((a, b) => a - b)
    return [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)] as [number, number, number]
  }, [buckets, metric])

  useEffect(() => {
    const element = heatmapRef.current
    if (!element) return
    element.scrollLeft = element.scrollWidth - element.clientWidth
  }, [days, heatmapRef, heatmapWidth])

  useEffect(() => {
    if (isLoading) return
    const element = animationRef.current
    if (!element || typeof element.getAnimations !== 'function') return
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.currentTime = 0
      animation.play()
    }
  }, [isLoading, range?.from, range?.to])

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short' })
    let previousVisibleIndex = -Infinity

    return weeks.map((week, weekIndex) => {
      const day = week[0]
      const previous = weekIndex > 0 ? weeks[weekIndex - 1][0] : undefined
      const label = !previous || previous.date.getMonth() !== day.date.getMonth() ? formatter.format(day.date) : ''
      if (!label || weekIndex - previousVisibleIndex < 3) return ''
      previousVisibleIndex = weekIndex
      return label
    })
  }, [i18n.language, weeks])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language]
  )

  const metricOptions = useMemo(
    () =>
      [
        { value: 'tokens' as const, label: t('settings.usage.metric.tokens') },
        { value: 'cost' as const, label: t('settings.usage.metric.cost') }
      ] as const,
    [t]
  )

  return (
    <div className="min-w-0 p-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <UsagePanelTitle className="min-w-0">{t('settings.usage.heatmap.title')}</UsagePanelTitle>
        <div role="group" aria-label={t('settings.usage.explore.metric')} className="flex shrink-0 items-center gap-3">
          {metricOptions.map(option => {
            const isActive = metric === option.value
            return (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isActive}
                onClick={() => setMetric(option.value)}
                className={cn(
                  'px-1 text-sm hover:bg-transparent',
                  isActive ? 'font-medium text-foreground' : 'text-foreground-tertiary hover:text-muted-foreground'
                )}>
                {option.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div ref={heatmapRef} className="mt-2 min-w-0 max-w-full overflow-x-auto">
        <div ref={animationRef} className="flex w-max min-w-full justify-end" style={{ gap: CELL_GAP }}>
          {weeks.map((week, weekIndex) => (
            <div
              key={week[0]?.key ?? weekIndex}
              className="grid shrink-0"
              style={{ width: CELL_SIZE, gap: CELL_GAP, gridTemplateRows: '16px auto' }}>
              <div className="h-4 overflow-visible whitespace-nowrap pr-3 text-[10px] text-foreground-tertiary leading-4">
                {monthLabels[weekIndex]}
              </div>

              <div className="grid" style={{ gap: CELL_GAP, gridTemplateRows: `repeat(7, ${CELL_SIZE}px)` }}>
                {isLoading
                  ? week.map(day => (
                      <Skeleton
                        key={day.key}
                        className="rounded-[3px]"
                        style={{ height: CELL_SIZE, width: CELL_SIZE }}
                      />
                    ))
                  : week.map((day, dayIndex) => {
                      const cellIndex = weekIndex * 7 + dayIndex
                      const cellStyle = {
                        height: CELL_SIZE,
                        width: CELL_SIZE,
                        animationDelay: `${Math.floor(cellIndex / 7) * 8 + (cellIndex % 7) * 12}ms`
                      }

                      if (day.isOutsideRange) {
                        return (
                          <div
                            key={day.key}
                            aria-hidden
                            className="animation-usage-heatmap-cell-enter rounded-[3px] bg-muted/30"
                            style={cellStyle}
                          />
                        )
                      }

                      const bucket = bucketMap.get(day.key)
                      const value = getBucketValue(bucket, metric)
                      const intensity = getIntensity(value, thresholds)
                      const tooltipValue =
                        metric === 'cost'
                          ? t('settings.usage.tooltip.cost', { value: formatCost(value, costCurrency) })
                          : t('settings.usage.tooltip.tokens', { value: formatUsageNumber(value) })
                      const tooltipContent = (
                        <div className="flex flex-col gap-1">
                          <span>{dateFormatter.format(day.date)}</span>
                          <span>{tooltipValue}</span>
                          <span>{t('settings.usage.tooltip.requests', { count: bucket?.requestCount ?? 0 })}</span>
                        </div>
                      )

                      return (
                        <NormalTooltip key={day.key} content={tooltipContent} side="top" sideOffset={4}>
                          <div
                            role="img"
                            aria-label={`${dateFormatter.format(day.date)} · ${tooltipValue} · ${t(
                              'settings.usage.tooltip.requests',
                              { count: bucket?.requestCount ?? 0 }
                            )}`}
                            className={`animation-usage-heatmap-cell-enter cursor-help rounded-[3px] ${intensityClassNames[intensity]}`}
                            style={cellStyle}
                          />
                        </NormalTooltip>
                      )
                    })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
