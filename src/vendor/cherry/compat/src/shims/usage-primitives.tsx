import type { ReactNode } from 'react'

import { MetricDelta } from '../../../source/src/renderer/pages/settings/UsageSettings/UsageSettingsPrimitives'

/**
 * Compat-only metric primitives for the source Usage dashboard.
 *
 * The source sparkline receives `number[]` and treats an unknown day as a
 * coordinate on the zero line. The shim keeps the mature card layout and only
 * breaks the sparkline at an unknown value, so a `null` gap never becomes a
 * plotted zero. The source primitives remain the implementation for every
 * other export.
 */
export * from '../../../source/src/renderer/pages/settings/UsageSettings/UsageSettingsPrimitives'

function known(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function MetricSparkline({ values }: { values: Array<number | null | undefined> }) {
  const recentValues = values.slice(-64)
  const knownValues = recentValues.filter(known)
  const maxValue = Math.max(...knownValues, 0)
  const minValue = Math.min(...knownValues, maxValue)
  const width = 48
  const height = 32
  const xStep = recentValues.length > 1 ? width / (recentValues.length - 1) : width
  const segments: string[][] = []
  let segment: string[] = []

  for (const [index, value] of recentValues.entries()) {
    if (!known(value)) {
      if (segment.length > 0) segments.push(segment)
      segment = []
      continue
    }

    const ratio = maxValue === minValue ? 0.5 : (value - minValue) / (maxValue - minValue)
    const x = index * xStep
    const y = height - ratio * (height - 4) - 2
    segment.push(`${x},${y}`)
  }
  if (segment.length > 0) segments.push(segment)

  return (
    <div className="flex h-8 w-12 shrink-0 items-center" aria-hidden>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-8 w-full text-primary">
        {segments.map((points, index) => (
          <polyline
            key={index}
            points={points.join(' ')}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        ))}
      </svg>
    </div>
  )
}

export function MetricCell({
  label,
  value,
  helper,
  trendValues,
  delta,
  deltaLabel,
  formatDelta
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  trendValues: Array<number | null | undefined>
  delta?: number
  deltaLabel: string
  formatDelta: (value: number) => string
}) {
  const hasTrend = trendValues.some(trendValue => known(trendValue) && trendValue > 0)

  return (
    <div className="flex min-h-24 min-w-0 flex-col bg-background p-3 @[640px]/usage:px-4">
      <div className="text-muted-foreground text-xs leading-5">{label}</div>
      <div className="mt-2 flex min-h-8 min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 text-pretty break-words font-semibold text-foreground text-xl leading-6">
          {value}
        </div>
        {hasTrend && <MetricSparkline values={trendValues} />}
      </div>
      <div className="mt-auto flex min-w-0 flex-col gap-1 pt-2">
        <MetricDelta change={delta} label={deltaLabel} formatDelta={formatDelta} />
        {helper && <div className="min-w-0 text-pretty text-foreground-tertiary text-xs leading-5">{helper}</div>}
      </div>
    </div>
  )
}
