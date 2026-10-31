import { configure } from '@testing-library/dom'

// Wait longer than the 1s default: these tests share a machine with the whole root suite (G3), and under
// that load `findBy*` times out on assertions that pass in isolation.
// 5s was still not enough when G4 runs right after G3 (≈500s of CPU): the failure was always a `findBy*`
// giving up, never a wrong value. 15s costs nothing on green runs and absorbs the cumulative load.
configure({ asyncUtilTimeout: 15000 })

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { initI18n } from '../../source/src/renderer/i18n/resolver'
import type { CacheEntry, CacheSyncMessage } from '../../source/src/shared/data/cache/cacheTypes'
import type { DataResponse } from '../../source/src/shared/data/api/types'
import type { IpcResult } from '../../source/src/shared/ipc/errors/IpcError'

afterEach(() => {
  cleanup()
})

/**
 * Populate i18next before any test renders.
 *
 * The window entry awaits `initI18n()` (`main.tsx`) and the source contract requires it; the
 * harness did not, so every page rendered RAW KEYS (`files.title`, `paintings.select_model`)
 * instead of labels. That is worse than cosmetic for this project: an audit that reads visible
 * text would compare keys against real Cherry strings and could pass or fail for reasons that
 * have nothing to do with the migration.
 */
beforeAll(async () => {
  await initI18n()
}, 60000)

/**
 * The `window.api` surface the Grimoire preload exposes, reduced to what resolves without a main
 * process. The harness previously provided only `preference.onChanged`, so a page that subscribes
 * through the source `useIpcOn` died with "Cannot read properties of undefined (reading 'on')" -
 * a harness gap that reads exactly like a product defect. (Two of the remaining app pages were
 * falsely recorded as blocked by it.)
 *
 * `request` returns a failure envelope rather than success: there is no main process here, so the honest answer is
 * the same 404-style envelope an unbridged route returns. Resolving with `{ ok: true, data: [] }`
 * would be a fabricated success - a page that needs real data would render its empty state and a
 * test would read that as "works". Tests that need data mock the Host provider instead.
 */
// A deliberately partial test double, NOT a GrimoireAPI implementation. Only the
// subscriptions and failure transports below exist; file/runtime/domain APIs remain absent.
type CompatTestApi = Pick<Window['api'], 'ipcApi' | 'dataApi'> & {
  preference: { onChanged: (callback: (payload: unknown) => void) => () => void }
  cache: {
    getAllShared: () => Promise<Record<string, CacheEntry<unknown>>>
    broadcastSync: (message: CacheSyncMessage) => void
    onSync: (callback: (message: CacheSyncMessage) => void) => () => void
  }
}

const api = {
  preference: {
    onChanged: () => () => undefined
  },
  ipcApi: {
    request: async (route: string): Promise<IpcResult<unknown>> => ({
      ok: false,
      error: { code: 'NOT_BRIDGED', message: 'test environment has no main process: ' + route }
    }),
    // Mirrors the preload: an unbridged event yields a working no-op unsubscribe.
    on: () => () => undefined
  },
  // The source `DataApiService` reads `window.api.dataApi.request` and returns a `DataResponse`
  // envelope (`{ id, status, error? }`), NOT the `IpcResult` shape `ipcApi.request` uses. Omitting
  // it made every `/topics` fetch throw `Cannot read properties of undefined (reading 'request')`
  // in the suite. The error branch is intentional, for the same reason as above.
  dataApi: {
    request: async (request: unknown): Promise<DataResponse<unknown>> => {
      // The preload accepts unknown IPC input. Read only the correlation fields,
      // without claiming a malformed or missing fixture is a valid DataRequest.
      const id = request && typeof request === 'object' && 'id' in request && typeof request.id === 'string' ? request.id : 'test'
      const path = request && typeof request === 'object' && 'path' in request && typeof request.path === 'string' ? request.path : ''
      return {
        id,
        status: 404,
        error: { code: 'NOT_BRIDGED', status: 404, message: 'test environment has no main process: ' + path }
      }
    },
    onDataChanged: () => () => undefined
  },
  cache: {
    getAllShared: async () => ({}),
    broadcastSync: () => undefined,
    onSync: () => () => undefined
  }
} satisfies CompatTestApi

Object.defineProperty(window, 'api', {
  configurable: true,
  value: api
})

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 480
  }
})
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 720
  }
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 480
  }
})
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 720
  }
})

if (!window.ResizeObserver) {
  class CompatResizeObserver implements ResizeObserver {
    // jsdom has no layout notifications. The harness supplies fixed dimensions above;
    // this observer intentionally emits no fabricated resize entries.
    constructor(_callback: ResizeObserverCallback) {}
    observe(_target: Element, _options?: ResizeObserverOptions): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = CompatResizeObserver
}
