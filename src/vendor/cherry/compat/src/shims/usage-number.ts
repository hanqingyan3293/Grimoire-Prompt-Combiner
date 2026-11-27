import { formatUsageNumber } from './usage-display'

/**
 * Scoped replacement for `@renderer/utils/number` inside the source
 * UsageSettings directory only.
 *
 * `formatCompactNumber` returns `'0'` for a non-finite input, which is how a
 * `null` aggregate became a user-visible zero. The compat resolver redirects
 * only UsageSettings importers here; every other caller keeps the source
 * formatter. Finite values (including `0`) delegate to the same implementation.
 */
export function formatCompactNumber(value: number | null | undefined): string {
  return formatUsageNumber(value)
}
