import { logEvent } from './logger.service'

/**
 * System font enumeration for the source `system.get_fonts` route.
 *
 * The source main process answers this route with the `font-list` package and
 * normalizes the result — strip a wrapping pair of quotes, drop empties, and fall back
 * to `[]` on failure (`source/src/main/ipc/handlers/system.ts`). This service is that
 * same contract: it uses the SAME package at the SAME declared version (`font-list`
 * `2.0.0`, per the source manifest) rather than reimplementing enumeration, so the
 * names, ordering and Windows-specific PowerShell/`PresentationCore` path stay
 * byte-identical to upstream.
 *
 * On Windows `font-list` shells out to PowerShell, which takes on the order of a
 * second. The appearance settings page requests fonts on mount, so the result is
 * memoized for the process lifetime: the installed-font set does not change while the
 * app runs, and repeated route calls would otherwise re-spawn PowerShell every time.
 *
 * Failure is never fatal — the source renders a degraded picker for an empty list, so
 * a failed enumeration returns `[]` (logged) rather than rejecting the route.
 */

/** Guard rail for the memo: an enumeration that fails must be retried, not cached. */
let cachedFonts: string[] | null = null
let inFlight: Promise<string[]> | null = null

/**
 * Source normalization: `font-list` returns some families wrapped in double quotes on
 * Windows (`"Microsoft YaHei"`); the source strips one wrapping pair and drops empties.
 */
function normalizeFonts(fonts: unknown): string[] {
  if (!Array.isArray(fonts)) return []
  return fonts
    .filter((font): font is string => typeof font === 'string')
    .map(font => font.replace(/^"(.*)"$/, '$1'))
    .filter(font => font.length > 0)
}

/**
 * Enumerates installed font families, memoized. Concurrent callers share one
 * enumeration so a burst of requests cannot spawn several PowerShell processes.
 */
export async function listSystemFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      // `font-list` ships CommonJS with no type declarations; the source calls it the
      // same way (a dynamic `await import` behind a try/catch).
      const module = (await import('font-list')) as unknown as {
        default?: { getFonts: () => Promise<unknown> }
        getFonts?: () => Promise<unknown>
      }
      const getFonts = module.default?.getFonts ?? module.getFonts
      if (typeof getFonts !== 'function') {
        logEvent('warn', 'system-fonts', 'font-list 未导出 getFonts，字体枚举降级为空列表')
        return []
      }
      const fonts = normalizeFonts(await getFonts())
      if (fonts.length > 0) cachedFonts = fonts
      return fonts
    } catch (error) {
      // Mirrors the source handler: log and degrade rather than failing the route.
      logEvent('warn', 'system-fonts', '系统字体枚举失败', {
        context: error instanceof Error ? error.message : String(error)
      })
      return []
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Test/diagnostic hook: clears the memo so a probe can observe a fresh enumeration. */
export function resetSystemFontCache(): void {
  cachedFonts = null
  inFlight = null
}
