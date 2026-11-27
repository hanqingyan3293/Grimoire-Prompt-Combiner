import { Chart as SourceChart } from '../../../source/src/renderer/components/Chart'
import type { ChartProps } from '../../../source/src/renderer/components/Chart'

import { UNKNOWN_USAGE_VALUE } from './usage-display'

/**
 * Compat-only wrapper around the source Chart for the Usage dashboard.
 *
 * Source `UsageDistributionChart` converts a tooltip value with `Number(value)`
 * before formatting. `Number(null)` is zero, which would label an unknown gap as
 * `$0.00`. Keep null/undefined out of that conversion; genuine numeric zero still
 * reaches the original formatter.
 */
export function unknownAwareTooltipFormatter(
  original?: (value: unknown) => string
): (value: unknown) => string {
  return (value: unknown) => {
    if (value === null || value === undefined || value === '') return UNKNOWN_USAGE_VALUE
    return original ? original(value) : String(value)
  }
}

export function Chart(props: ChartProps) {
  const option = props.option
  const nextOption = option
    ? {
        ...option,
        tooltip: {
          ...option.tooltip,
          valueFormatter: unknownAwareTooltipFormatter(option.tooltip?.valueFormatter)
        }
      }
    : option

  return <SourceChart {...props} option={nextOption as ChartProps['option']} />
}
