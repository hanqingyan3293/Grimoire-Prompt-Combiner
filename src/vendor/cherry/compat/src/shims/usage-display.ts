import { formatCompactNumber as sourceFormatCompactNumber } from '../../../source/src/renderer/utils/number'
import { formatCost as sourceFormatCost } from '../../../source/src/renderer/pages/settings/UsageSettings/usageDisplay'

/**
 * Compat-only presentation shim for the source Usage dashboard.
 *
 * The source helpers take `number` because Cherry always stores a numeric
 * aggregate. Grimoire's usage backend deliberately keeps an unmeasured token or
 * cost aggregate as `null`. This shim reuses every source helper unchanged and
 * only adds the missing `null`/`undefined` branch: an unknown value renders as
 * an em dash, while a genuine numeric zero still goes through the source
 * formatter and therefore renders as `0` / `$0.00`.
 */
export * from '../../../source/src/renderer/pages/settings/UsageSettings/usageDisplay'

export const UNKNOWN_USAGE_VALUE = '\u2014'

function isKnownNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatCost(value: number | null | undefined, currency: string | null | undefined): string {
  if (!isKnownNumber(value)) return UNKNOWN_USAGE_VALUE
  return sourceFormatCost(value, currency)
}

export function formatUsageNumber(value: number | null | undefined): string {
  if (!isKnownNumber(value)) return UNKNOWN_USAGE_VALUE
  return sourceFormatCompactNumber(value)
}
