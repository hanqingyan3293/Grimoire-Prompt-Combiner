import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import type { PreferenceUpdateOptions, UnifiedPreferenceKeyType, UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import { usePreference } from '@renderer/data/hooks/usePreference'

const settingsStore: Record<string, string> = { language: 'zh' }
const refreshListeners = new Set<() => void>()
const setCalls: Array<[string, string]> = []

const bridge = {
  settings: {
    getAll: vi.fn(async () => ({ ...settingsStore })),
    set: vi.fn(async (key: string, value: string) => {
      settingsStore[key] = value
      setCalls.push([key, value])
      return true
    })
  },
  db: {
    onRefresh: (callback: () => void) => {
      refreshListeners.add(callback)
      return () => refreshListeners.delete(callback)
    }
  }
}

Object.defineProperty(window, 'api', { configurable: true, value: bridge })

const { preferenceService } = await import('./preference-service')

beforeEach(() => {
  for (const key of Object.keys(settingsStore)) if (key !== 'language') delete settingsStore[key]
  settingsStore.language = 'zh'
  refreshListeners.clear()
  setCalls.length = 0
  // cleanup() drops the db.onRefresh subscription too; clearCache() alone keeps it,
  // which would leave later tests without a refresh listener after the set is cleared.
  preferenceService.cleanup()
  preferenceService.clearCache()
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { configurable: true, value: bridge })
  bridge.settings.set.mockImplementation(async (key, value) => {
    settingsStore[key] = value
    setCalls.push([key, value])
    return true
  })
})

function deferredWrite() {
  let resolve!: (value: boolean) => void
  let reject!: (error: Error) => void
  const promise = new Promise<boolean>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('compat preference service', () => {
  it('maps Grimoire language into Cherry app.language', async () => {
    expect(await preferenceService.get('app.language')).toBe('zh-CN')
    settingsStore.language = 'en'
    for (const listener of refreshListeners) listener()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await preferenceService.get('app.language')).toBe('en-US')
  })

  it('returns the exact source defaults and typed mapped values for supported keys', async () => {
    expect(await preferenceService.get('assistant.icon_type')).toEqual(getDefaultValue('assistant.icon_type'))
    const raw = await preferenceService.getMultipleRaw(['app.language', 'assistant.icon_type'])
    expect(raw).toEqual({ 'app.language': 'zh-CN', 'assistant.icon_type': getDefaultValue('assistant.icon_type') })
    const mapped = await preferenceService.getMultiple({ language: 'app.language', icon: 'assistant.icon_type' })
    expect(mapped).toEqual({ language: 'zh-CN', icon: getDefaultValue('assistant.icon_type') })
    expectTypeOf(mapped.icon).toEqualTypeOf<UnifiedPreferenceType['assistant.icon_type']>()
    expectTypeOf(preferenceService.get('app.language')).toEqualTypeOf<Promise<UnifiedPreferenceType['app.language']>>()
  })

  it('persists Cherry-only preferences under the cherry_pref namespace', async () => {
    await preferenceService.set('assistant.icon_type', 'emoji')
    expect(bridge.settings.set).toHaveBeenCalledWith('cherry_pref.assistant.icon_type', JSON.stringify('emoji'))
    expect(settingsStore['cherry_pref.assistant.icon_type']).toBe('"emoji"')
  })

  it('redacts credential snapshots before caching and rejects writes before optimistic publication', async () => {
    const canary = 'synthetic-preference-secret-canary'
    settingsStore['cherry_pref.feature.api_gateway.api_key'] = JSON.stringify(canary)
    settingsStore['cherry_pref.chat.web_search.provider_overrides'] = JSON.stringify({ tavily: { apiKeys: [canary], basicAuthPassword: canary, apiHost: 'https://example.invalid' } })
    await preferenceService.preloadAll()
    expect(preferenceService.getCachedValue('feature.api_gateway.api_key')).toBe('********')
    const overrides = preferenceService.getCachedValue('chat.web_search.provider_overrides')
    expect(JSON.stringify(overrides)).not.toContain(canary)
    expect(overrides).toMatchObject({ tavily: { apiKeys: ['********'], basicAuthPassword: '********', apiHost: 'https://example.invalid' } })
    const changed = vi.fn()
    preferenceService.subscribeAllChanges(changed)
    await expect(preferenceService.set('feature.api_gateway.api_key', canary)).rejects.toThrow('main-process credential adapter')
    await expect(preferenceService.setMultiple({ 'assistant.icon_type': 'none', 'feature.api_gateway.api_key': canary })).rejects.toThrow('main-process credential adapter')
    expect(bridge.settings.set).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(preferenceService.getCachedValue('feature.api_gateway.api_key')).toBe('********')
  })

  it('writes app.language back through the Grimoire language key', async () => {
    await preferenceService.set('app.language', 'zh-CN')
    expect(setCalls).toContainEqual(['language', 'zh'])
    await preferenceService.set('app.language', 'en-US')
    expect(setCalls).toContainEqual(['language', 'en'])
  })

  it('notifies key subscribers on change and unsubscribe stops delivery', async () => {
    const seen: unknown[] = []
    const unsubscribe = preferenceService.subscribeChange('app.language')(() => {
      seen.push(preferenceService.getCachedValue('app.language'))
    })
    await preferenceService.get('app.language')
    await preferenceService.set('app.language', 'en-US')
    expect(seen.length).toBeGreaterThan(0)
    unsubscribe()
    const before = seen.length
    await preferenceService.set('app.language', 'zh-CN')
    expect(seen.length).toBe(before)
  })

  it.each([undefined, {}, { settings: { getAll: bridge.settings.getAll } }])(
    'rejects writes without a settings write backend (%j) and notifies rollback', async missingBridge => {
      await preferenceService.preloadAll()
      const keySeen: unknown[] = []
      const allSeen: unknown[] = []
      preferenceService.subscribeChange('app.language')(() => keySeen.push(preferenceService.getCachedValue('app.language')))
      preferenceService.subscribeAllChanges(() => allSeen.push(preferenceService.getCachedValue('app.language')))
      Object.defineProperty(window, 'api', { configurable: true, value: missingBridge })
      await expect(preferenceService.set('app.language', 'en-US')).rejects.toThrow('backend is unavailable')
      expect(keySeen).toEqual(['en-US', 'zh-CN'])
      expect(allSeen).toEqual(keySeen)
      expect(await preferenceService.get('app.language')).toBe('zh-CN')
    }
  )

  it('propagates the original persistence error and rolls back both subscriber surfaces', async () => {
    await preferenceService.set('assistant.icon_type', 'emoji')
    const failure = new Error('disk full')
    bridge.settings.set.mockRejectedValueOnce(failure)
    const seen: unknown[] = []
    const allSeen: unknown[] = []
    preferenceService.subscribeChange('assistant.icon_type')(() => seen.push(preferenceService.getCachedValue('assistant.icon_type')))
    preferenceService.subscribeAllChanges(() => allSeen.push(preferenceService.getCachedValue('assistant.icon_type')))
    await expect(preferenceService.set('assistant.icon_type', 'none')).rejects.toBe(failure)
    expect(seen).toEqual(['none', 'emoji'])
    expect(allSeen).toEqual(seen)
    expect(settingsStore['cherry_pref.assistant.icon_type']).toBe('"emoji"')
  })

  it('treats false acknowledgement as failure and removes a newly cached value on rollback', async () => {
    await preferenceService.preloadAll()
    bridge.settings.set.mockResolvedValueOnce(false)
    const seen: unknown[] = []
    preferenceService.subscribeChange('assistant.icon_type')(() => seen.push(preferenceService.getCachedValue('assistant.icon_type')))
    await expect(preferenceService.set('assistant.icon_type', 'none')).rejects.toThrow('rejected preference')
    expect(seen).toEqual(['none', undefined])
    expect(preferenceService.isCached('assistant.icon_type')).toBe(false)
    expect(await preferenceService.get('assistant.icon_type')).toBe(getDefaultValue('assistant.icon_type'))
  })

  it('supports pessimistic writes without exposing values before confirmation', async () => {
    await preferenceService.preloadAll()
    const pending = deferredWrite()
    bridge.settings.set.mockReturnValueOnce(pending.promise)
    const seen: unknown[] = []
    preferenceService.subscribeChange('app.language')(() => seen.push(preferenceService.getCachedValue('app.language')))
    const write = preferenceService.set('app.language', 'en-US', { optimistic: false })
    await vi.waitFor(() => expect(bridge.settings.set).toHaveBeenCalled())
    expect(preferenceService.getCachedValue('app.language')).toBe('zh-CN')
    expect(seen).toEqual([])
    pending.resolve(true)
    await write
    expect(seen).toEqual(['en-US'])
  })

  it('propagates pessimistic failures without changing the cache or notifying subscribers', async () => {
    await preferenceService.preloadAll()
    const failure = new Error('unwritable')
    bridge.settings.set.mockRejectedValueOnce(failure)
    const keyListener = vi.fn()
    const allListener = vi.fn()
    preferenceService.subscribeChange('app.language')(keyListener)
    preferenceService.subscribeAllChanges(allListener)
    await expect(preferenceService.set('app.language', 'en-US', { optimistic: false })).rejects.toBe(failure)
    expect(preferenceService.getCachedValue('app.language')).toBe('zh-CN')
    expect(keyListener).not.toHaveBeenCalled()
    expect(allListener).not.toHaveBeenCalled()
  })

  it.each([true, false])('reports partial batch persistence honestly (optimistic=%s)', async optimistic => {
    await preferenceService.set('assistant.icon_type', 'emoji')
    bridge.settings.set.mockClear()
    const failure = new Error('second item failed')
    bridge.settings.set.mockImplementationOnce(async (key, value) => {
      settingsStore[key] = value
      return true
    }).mockRejectedValueOnce(failure)
    const seen: unknown[] = []
    const allSeen: unknown[] = []
    preferenceService.subscribeChange('assistant.icon_type')(() => seen.push(preferenceService.getCachedValue('assistant.icon_type')))
    preferenceService.subscribeAllChanges(() => allSeen.push(preferenceService.getCachedValue('assistant.icon_type')))
    await expect(preferenceService.setMultiple({
      'app.language': 'en-US',
      'assistant.icon_type': 'none',
      'data.export.menus.markdown': false
    }, { optimistic })).rejects.toBe(failure)
    expect(bridge.settings.set).toHaveBeenCalledTimes(2)
    expect(settingsStore.language).toBe('en')
    expect(settingsStore['cherry_pref.assistant.icon_type']).toBe('"emoji"')
    expect(settingsStore['cherry_pref.data.export.menus.markdown']).toBeUndefined()
    expect(preferenceService.getCachedValue('app.language')).toBe('en-US')
    expect(preferenceService.getCachedValue('assistant.icon_type')).toBe('emoji')
    expect(preferenceService.isCached('data.export.menus.markdown')).toBe(false)
    expect(seen).toEqual(optimistic ? ['none', 'emoji'] : [])
    expect(allSeen).toEqual(optimistic ? ['emoji', 'none', 'emoji'] : ['emoji'])
  })

  it('rejects a batch without a write backend instead of returning success', async () => {
    await preferenceService.preloadAll()
    Object.defineProperty(window, 'api', { configurable: true, value: undefined })
    await expect(preferenceService.setMultiple({ 'assistant.icon_type': 'none', 'app.language': 'en-US' })).rejects.toThrow('backend is unavailable')
    expect(preferenceService.isCached('assistant.icon_type')).toBe(false)
    expect(preferenceService.getCachedValue('app.language')).toBe('zh-CN')
  })

  it('validates all batch entries before any persistence and explicitly rejects BootConfig writes', async () => {
    await expect(preferenceService.setMultiple({
      'assistant.icon_type': 'none',
      'BootConfig.unknown': true
    } as unknown as Partial<UnifiedPreferenceType>)).rejects.toThrow('requires a BootConfig service')
    expect(bridge.settings.set).not.toHaveBeenCalled()
    expect(preferenceService.isCached('assistant.icon_type')).toBe(false)
    await expect(preferenceService.set('unknown.key' as UnifiedPreferenceKeyType, 'none')).rejects.toThrow('Unsupported preference key')
    await expect(preferenceService.set('assistant.icon_type', undefined as unknown as UnifiedPreferenceType['assistant.icon_type'])).rejects.toThrow('cannot be undefined')
    await expect(preferenceService.set('app.language', null)).rejects.toThrow('cannot be represented')
    await expect(preferenceService.set('assistant.icon_type', 'none', { optimistic: true, extra: true } as unknown as PreferenceUpdateOptions)).rejects.toThrow('Unsupported preference update options')
    expect(bridge.settings.set).not.toHaveBeenCalled()
  })

  it('serializes same-key writes so a failed write cannot roll back a later success', async () => {
    await preferenceService.set('assistant.icon_type', 'emoji')
    bridge.settings.set.mockClear()
    const pending = deferredWrite()
    bridge.settings.set.mockReturnValueOnce(pending.promise)
    const first = preferenceService.set('assistant.icon_type', 'none')
    const firstRejected = expect(first).rejects.toThrow('first failed')
    const second = preferenceService.set('assistant.icon_type', 'model')
    await vi.waitFor(() => expect(bridge.settings.set).toHaveBeenCalledTimes(1))
    expect(preferenceService.getCachedValue('assistant.icon_type')).toBe('none')
    pending.reject(new Error('first failed'))
    await firstRejected
    await second
    expect(preferenceService.getCachedValue('assistant.icon_type')).toBe('model')
    expect(settingsStore['cherry_pref.assistant.icon_type']).toBe('"model"')
  })

  it.each([true, false])('preserves pending UI state across a settings refresh (optimistic=%s)', async optimistic => {
    await preferenceService.preloadAll()
    const pending = deferredWrite()
    bridge.settings.set.mockReturnValueOnce(pending.promise)
    const write = preferenceService.set('app.language', 'en-US', { optimistic })
    const rejected = expect(write).rejects.toThrow('failed')
    await vi.waitFor(() => expect(bridge.settings.set).toHaveBeenCalled())
    // A snapshot arriving before the response must not remove optimism or expose
    // a pessimistic write before acknowledgement; unrelated keys still refresh.
    settingsStore.language = optimistic ? 'zh' : 'en'
    settingsStore['cherry_pref.assistant.icon_type'] = '"none"'
    for (const listener of refreshListeners) listener()
    await vi.waitFor(() => expect(preferenceService.getCachedValue('assistant.icon_type')).toBe('none'))
    expect(preferenceService.getCachedValue('app.language')).toBe(optimistic ? 'en-US' : 'zh-CN')
    pending.reject(new Error('failed'))
    await rejected
    expect(preferenceService.getCachedValue('app.language')).toBe('zh-CN')
  })

  it('allows source usePreference callers to catch failure and observe rollback', async () => {
    await preferenceService.preloadAll()
    const pending = deferredWrite()
    bridge.settings.set.mockReturnValueOnce(pending.promise)
    const { result, unmount } = renderHook(() => usePreference('app.language'))
    let write!: Promise<void>
    await act(async () => { write = result.current[1]('en-US') })
    expect(result.current[0]).toBe('en-US')
    const failure = new Error('hook persistence failed')
    const rejected = expect(write).rejects.toBe(failure)
    await act(async () => {
      pending.reject(failure)
      await rejected
    })
    expect(result.current[0]).toBe('zh-CN')
    unmount()
  })

  it('isolates throwing global subscribers from persistence and rollback delivery', async () => {
    await preferenceService.preloadAll()
    preferenceService.subscribeAllChanges(() => { throw new Error('subscriber failed') })
    const notified = vi.fn()
    preferenceService.subscribeAllChanges(notified)
    await preferenceService.set('assistant.icon_type', 'emoji')
    bridge.settings.set.mockRejectedValueOnce(new Error('disk failed'))
    await expect(preferenceService.set('assistant.icon_type', 'none')).rejects.toThrow('disk failed')
    expect(notified).toHaveBeenCalledTimes(3)
    expect(preferenceService.getCachedValue('assistant.icon_type')).toBe('emoji')
  })

  it('reports cache state used by the source hooks', async () => {
    expect(preferenceService.isCached('app.language')).toBe(false)
    await preferenceService.get('app.language')
    expect(preferenceService.isCached('app.language')).toBe(true)
    expect(preferenceService.isFullyCached()).toBe(true)
  })

  it('notifies key subscribers when an external write arrives through the refresh broadcast', async () => {
    // This is the exact path `useLanguageSync` depends on: another window (or the
    // settings UI) writes the Grimoire `language` setting, main broadcasts
    // `data:refresh`, the shim re-reads and diffs, and key subscribers re-render.
    await preferenceService.get('app.language')
    const seen: unknown[] = []
    preferenceService.subscribeChange('app.language')(() => {
      seen.push(preferenceService.getCachedValue('app.language'))
    })

    settingsStore.language = 'en'
    for (const listener of refreshListeners) listener()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seen).toContain('en-US')
    // Repeat refresh with no change must not re-notify.
    const before = seen.length
    for (const listener of refreshListeners) listener()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen.length).toBe(before)
  })
})
