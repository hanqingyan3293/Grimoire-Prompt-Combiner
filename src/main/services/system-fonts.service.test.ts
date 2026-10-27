import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `font-list` is mocked: the real module shells out to PowerShell on Windows, which is
 * neither deterministic nor appropriate in a unit test. The mock exercises the service's
 * own contract — source normalization, memoization, single-flight, and the degrade-to-
 * empty behaviour the source handler has — while leaving the package itself to the
 * manual/visual check that actually enumerates the machine's fonts.
 */
const getFonts = vi.fn<() => Promise<unknown>>()
vi.mock('font-list', () => ({ default: { getFonts: () => getFonts() } }))

const loggedEvents: Array<{ level: string; module: string; message: string }> = []
vi.mock('./logger.service', () => ({
  logEvent: (level: string, module: string, message: string) => { loggedEvents.push({ level, module, message }) }
}))

import { listSystemFonts, resetSystemFontCache } from './system-fonts.service'

beforeEach(() => {
  resetSystemFontCache()
  getFonts.mockReset()
  loggedEvents.length = 0
})

describe('system font enumeration', () => {
  it('normalizes the source way: strips one wrapping quote pair and drops empties', async () => {
    // The source filter is `font.length > 0` — an exact mirror, not a trimmed variant —
    // so an empty string is dropped while a whitespace-only entry would survive. That
    // is reachable only if `font-list` emitted one; its own parser trims each line and
    // filters blanks, so the empty-string case is the defensive guard being exercised.
    getFonts.mockResolvedValue(['"Microsoft YaHei"', 'Arial', '', '"Cascadia Code"', 'SimSun'])
    const fonts = await listSystemFonts()
    expect(fonts).toEqual(['Microsoft YaHei', 'Arial', 'Cascadia Code', 'SimSun'])
  })

  it('memoizes a successful enumeration so repeated route calls do not re-spawn PowerShell', async () => {
    getFonts.mockResolvedValue(['Arial'])
    expect(await listSystemFonts()).toEqual(['Arial'])
    expect(await listSystemFonts()).toEqual(['Arial'])
    expect(getFonts).toHaveBeenCalledTimes(1)
  })

  it('shares one enumeration between concurrent callers', async () => {
    // The deferred is created up front: `listSystemFonts` only reaches `getFonts()`
    // after its dynamic import resolves, so a resolver captured inside the mock
    // implementation would still be the initial no-op when this test body runs.
    let resolveFonts: (value: unknown) => void = () => undefined
    const pending = new Promise(resolve => { resolveFonts = resolve })
    getFonts.mockImplementation(() => pending)

    const first = listSystemFonts()
    const second = listSystemFonts()
    resolveFonts(['Arial'])

    expect(await first).toEqual(['Arial'])
    expect(await second).toEqual(['Arial'])
    expect(getFonts).toHaveBeenCalledTimes(1)
  })

  it('degrades to an empty list and logs when enumeration throws, mirroring the source handler', async () => {
    getFonts.mockRejectedValue(new Error('powershell unavailable'))
    expect(await listSystemFonts()).toEqual([])
    expect(loggedEvents.some(event => event.level === 'warn' && event.module === 'system-fonts')).toBe(true)
  })

  it('does not cache a failed enumeration — the next call retries', async () => {
    getFonts.mockRejectedValueOnce(new Error('transient'))
    expect(await listSystemFonts()).toEqual([])
    getFonts.mockResolvedValue(['Arial'])
    expect(await listSystemFonts()).toEqual(['Arial'])
    expect(getFonts).toHaveBeenCalledTimes(2)
  })

  it('treats a malformed result as no fonts rather than propagating it', async () => {
    getFonts.mockResolvedValue('not-an-array')
    expect(await listSystemFonts()).toEqual([])
    getFonts.mockResolvedValue([1, null, 'Arial'])
    // Non-strings are dropped, not stringified into fake font names.
    expect(await listSystemFonts()).toEqual(['Arial'])
  })
})
