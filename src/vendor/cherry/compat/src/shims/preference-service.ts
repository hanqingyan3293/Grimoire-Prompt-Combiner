// Grimoire-backed replacement for Cherry's `@data/PreferenceService`.
//
// The compat window uses the Grimoire preload, which has no `window.api.preference`
// bridge, so the source PreferenceService would fall back to defaults for every key.
// This shim keeps the same singleton surface the source renderer calls, persists
// Cherry-only preferences into the existing Grimoire settings table under a
// `cherry_pref.` namespace (JSON-encoded, additive — no schema change), and maps the
// one shared concept: `app.language` <-> Grimoire `language` (`zh`/`en`).

import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type {
  PreferenceUpdateOptions,
  UnifiedPreferenceKeyType,
  UnifiedPreferenceMultipleResultType,
  UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import { getDefaultValue, isBootConfigKey } from '@shared/data/preference/preferenceUtils'
import { loggerService } from './logger'
import { isProtectedCherryPreference, redactCherrySetting } from '../../../../../shared/cherry-settings-privacy'

type SettingsSnapshot = Record<string, unknown>
type Listener = () => void
// Only the existing Grimoire API is used; absence is a write failure, not success.
type SettingsBridge = {
  settings?: {
    getAll?: () => Promise<SettingsSnapshot>
    set?: (key: string, value: string) => Promise<boolean>
  }
  db?: { onRefresh?: (callback: Listener) => () => void }
}

const logger = loggerService.withContext('CompatPreferenceService')
const CHERRY_PREFIX = 'cherry_pref.'
const LANGUAGE_KEY = 'app.language'
const GRIMOIRE_LANGUAGE_KEY = 'language'

const toCherryLanguage = (value: unknown): string | undefined => {
  if (value === 'zh') return 'zh-CN'
  if (value === 'en') return 'en-US'
  if (typeof value === 'string' && value.includes('-')) return value
  return undefined
}

const toGrimoireLanguage = (value: unknown): string | undefined => {
  if (value === 'zh-CN' || value === 'zh-TW') return 'zh'
  if (typeof value === 'string' && value.startsWith('zh')) return 'zh'
  if (typeof value === 'string' && value.includes('-')) return 'en'
  if (value === 'en') return 'en'
  return undefined
}

function api(): SettingsBridge | undefined {
  return (window as unknown as { api?: SettingsBridge }).api
}

class CompatPreferenceService {
  private cache = new Map<string, unknown>()
  private keyListeners = new Map<string, Set<Listener>>()
  private allListeners = new Set<Listener>()
  private loaded = false
  private loading: Promise<void> | null = null
  private unsubscribeRefresh: (() => void) | null = null
  private writeQueues = new Map<string, Promise<void>>()
  private pendingWrites = new Set<string>()

  /** Reads Grimoire settings once and subscribes to the refresh broadcast for later diffs. */
  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    if (!this.loading) this.loading = this.loadFromSettings()
    return this.loading
  }

  private parseStoredValue(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  private async loadFromSettings(): Promise<void> {
    const bridge = api()
    try {
      const settings = bridge?.settings?.getAll ? ((await bridge.settings.getAll()) as SettingsSnapshot) : {}
      this.applySettingsSnapshot(settings)
      this.loaded = true
      if (!this.unsubscribeRefresh && bridge?.db?.onRefresh) {
        this.unsubscribeRefresh = bridge.db.onRefresh(() => {
          void this.refresh()
        })
      }
    } catch (error) {
      logger.error('Failed to load Grimoire settings for Cherry preferences', error as Error)
      this.loaded = true
    }
  }

  private applySettingsSnapshot(settings: SettingsSnapshot): void {
    const next = new Map<string, unknown>()
    for (const [key, value] of Object.entries(settings)) {
      if (key.startsWith(CHERRY_PREFIX)) {
        next.set(key.slice(CHERRY_PREFIX.length), this.parseStoredValue(redactCherrySetting(key, value)))
      }
    }
    const language = toCherryLanguage(settings[GRIMOIRE_LANGUAGE_KEY])
    if (language) next.set(LANGUAGE_KEY, language)

    // A settings broadcast can precede the write response or carry an older
    // snapshot. Keep in-flight UI state until persistence settles (also prevents
    // a pessimistic write publishing before confirmation).
    for (const key of this.pendingWrites) {
      if (this.cache.has(key)) next.set(key, this.cache.get(key))
      else next.delete(key)
    }

    // Diff against the current cache so only real changes notify listeners.
    const changed = new Set<string>()
    for (const [key, value] of next) {
      if (!this.sameValue(this.cache.get(key), value)) changed.add(key)
    }
    for (const key of this.cache.keys()) {
      if (!next.has(key)) changed.add(key)
    }
    this.cache = next
    for (const key of changed) this.notifyKey(key)
    if (changed.size > 0) this.notifyAll()
  }

  private sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }

  private async refresh(): Promise<void> {
    const bridge = api()
    if (!bridge?.settings?.getAll) return
    try {
      this.applySettingsSnapshot((await bridge.settings.getAll()) as SettingsSnapshot)
    } catch (error) {
      logger.warn('Failed to refresh Cherry preferences from Grimoire settings', error as Error)
    }
  }

  private notifyKey(key: string): void {
    const listeners = this.keyListeners.get(key)
    if (!listeners) return
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        logger.error('Preference listener failed', error as Error)
      }
    }
  }

  private notifyAll(): void {
    for (const listener of this.allListeners) {
      try {
        listener()
      } catch (error) {
        logger.error('Preference listener failed', error as Error)
      }
    }
  }

  private notifyChange(key: string): void {
    this.notifyKey(key)
    this.notifyAll()
  }

  /** Mirrors the source contract: cache hit returns immediately, otherwise await the backing read. */
  async get<K extends UnifiedPreferenceKeyType>(key: K): Promise<UnifiedPreferenceType[K]> {
    if (!this.cache.has(key)) await this.ensureLoaded()
    return (this.cache.has(key) ? this.cache.get(key) : getDefaultValue(key)) as UnifiedPreferenceType[K]
  }

  async getMultipleRaw<K extends UnifiedPreferenceKeyType>(keys: K[]): Promise<UnifiedPreferenceMultipleResultType<K>> {
    await this.ensureLoaded()
    const result = {} as UnifiedPreferenceMultipleResultType<K>
    for (const key of keys) result[key] = await this.get(key)
    return result
  }

  async getMultiple<T extends Record<string, UnifiedPreferenceKeyType>>(
    keys: T
  ): Promise<{ [P in keyof T]: UnifiedPreferenceType[T[P]] }> {
    const raw = await this.getMultipleRaw(Object.values(keys))
    const mapped = {} as { [P in keyof T]: UnifiedPreferenceType[T[P]] }
    for (const localKey in keys) mapped[localKey] = raw[keys[localKey]]
    return mapped
  }

  private validateOptions(options: PreferenceUpdateOptions): void {
    if (!options || typeof options.optimistic !== 'boolean' || Object.keys(options).some(key => key !== 'optimistic')) {
      throw new Error('Unsupported preference update options; only optimistic: boolean is supported')
    }
  }

  private encodeWrite(key: string, value: unknown): { key: string; value: string } {
    if (isProtectedCherryPreference(key)) {
      throw new Error('Cherry credential preferences require a main-process credential adapter; generic writes are unavailable')
    }
    if (isBootConfigKey(key)) {
      throw new Error(`Preference ${key} requires a BootConfig service; Grimoire settings cannot apply it`)
    }
    if (!Object.hasOwn(DefaultPreferences.default, key)) throw new Error(`Unsupported preference key: ${key}`)
    if (value === undefined) throw new Error(`Preference ${key} value cannot be undefined`)
    if (key === LANGUAGE_KEY) {
      const mapped = toGrimoireLanguage(value)
      if (!mapped) throw new Error(`Preference ${key} cannot be represented by the Grimoire language setting`)
      return { key: GRIMOIRE_LANGUAGE_KEY, value: mapped }
    }
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error(`Preference ${key} value must be JSON serializable`)
    return { key: CHERRY_PREFIX + key, value: encoded }
  }

  async set<K extends UnifiedPreferenceKeyType>(
    key: K,
    value: UnifiedPreferenceType[K],
    options: PreferenceUpdateOptions = { optimistic: true }
  ): Promise<void> {
    this.validateOptions(options)
    const stored = this.encodeWrite(key, value)
    // Like the source queue, a failed request must settle before the next write
    // to that key begins; otherwise its rollback could clobber a later success.
    const previousRequest = this.writeQueues.get(key)
    const write = previousRequest
      ? previousRequest.then(() => this.persist(key, value, stored, options.optimistic))
      : this.persist(key, value, stored, options.optimistic)
    // Queue continuation handles failure, but the caller still receives `write`'s rejection.
    const settled = write.then(() => undefined, () => undefined)
    this.writeQueues.set(key, settled)
    void settled.then(() => {
      if (this.writeQueues.get(key) === settled) this.writeQueues.delete(key)
    })
    return write
  }

  private async persist(
    key: UnifiedPreferenceKeyType,
    value: unknown,
    stored: { key: string; value: string },
    optimistic: boolean
  ): Promise<void> {
    await this.ensureLoaded()
    const hadPrevious = this.cache.has(key)
    const previous = this.cache.get(key)
    this.pendingWrites.add(key)
    try {
      if (optimistic) {
        this.cache.set(key, value)
        this.notifyChange(key)
      }
      const settings = api()?.settings
      if (!settings?.set) throw new Error('Grimoire settings write backend is unavailable')
      const succeeded = await settings.set(stored.key, stored.value)
      if (succeeded !== true) throw new Error(`Grimoire settings rejected preference ${key}`)
      if (!optimistic) {
        this.cache.set(key, value)
        this.notifyChange(key)
      }
    } catch (error) {
      if (optimistic) {
        if (hadPrevious) this.cache.set(key, previous)
        else this.cache.delete(key)
        this.notifyChange(key)
      }
      logger.error('Failed to persist Cherry preference', error as Error)
      throw error
    } finally {
      this.pendingWrites.delete(key)
    }
  }

  async setMultiple(
    updates: Partial<UnifiedPreferenceType>,
    options: PreferenceUpdateOptions = { optimistic: true }
  ): Promise<void> {
    this.validateOptions(options)
    const entries = Object.entries(updates)
    // Preflight every entry before writing. This API has no transaction: on a
    // persistence failure retain already committed keys, rollback the failed key,
    // reject and leave remaining keys untouched. Never claim an atomic batch.
    for (const [key, value] of entries) this.encodeWrite(key, value)
    for (const [key, value] of entries) {
      const prefKey = key as UnifiedPreferenceKeyType
      await this.set(prefKey, value as UnifiedPreferenceType[typeof prefKey], options)
    }
  }

  subscribeChange = (key: UnifiedPreferenceKeyType) => (callback: Listener): (() => void) => {
    void this.ensureLoaded()
    const listeners = this.keyListeners.get(key) ?? new Set<Listener>()
    listeners.add(callback)
    this.keyListeners.set(key, listeners)
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) this.keyListeners.delete(key)
    }
  }

  subscribeAllChanges = (callback: Listener): (() => void) => {
    void this.ensureLoaded()
    this.allListeners.add(callback)
    return () => {
      this.allListeners.delete(callback)
    }
  }

  getCachedValue<K extends UnifiedPreferenceKeyType>(key: K): UnifiedPreferenceType[K] | undefined {
    return this.cache.get(key) as UnifiedPreferenceType[K] | undefined
  }

  isCached(key: UnifiedPreferenceKeyType): boolean {
    return this.cache.has(key)
  }

  async preloadAll(): Promise<void> {
    await this.ensureLoaded()
  }

  async preload(_keys: UnifiedPreferenceKeyType[]): Promise<void> {
    await this.ensureLoaded()
  }

  isFullyCached(): boolean {
    return this.loaded
  }

  clearCache(): void {
    this.cache = new Map()
    // Drop the loaded flag too so the next read re-fetches the snapshot.
    this.loaded = false
    this.loading = null
  }

  cleanup(): void {
    this.keyListeners.clear()
    this.allListeners.clear()
    if (this.unsubscribeRefresh) {
      this.unsubscribeRefresh()
      this.unsubscribeRefresh = null
    }
  }

  getPendingOptimisticUpdates(): Array<{ key: string; value: unknown; requestId: string }> {
    return []
  }

}

export const preferenceService = new CompatPreferenceService()
export default preferenceService
