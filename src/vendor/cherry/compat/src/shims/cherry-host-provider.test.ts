import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CherryHostBridge } from '../../../../../shared/cherry-host-types'
import { getBridge } from './cherry-host-provider'

type AnyRecord = Record<string, any>

function stubApi(): AnyRecord {
  const sessions: AnyRecord = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'assistants' || prop === 'topics') return sessions
      if (prop === 'catalog') return { models: async () => [], providers: async () => [] }
      if (prop === 'attachments') return { read: async () => null }
      if (prop === 'onPermissionRequest') return () => () => undefined
      if (prop === 'decidePermission') return async () => true
      return async () => null
    }
  })
  return {
    ai: {
      sessions,
      vision: async () => null,
      generateImage: async () => null
    },
    providers: {},
    settings: {},
    window: {},
    images: { list: async () => [] },
    promptAssets: {},
    tags: {},
    canvas: {},
    wd14: { history: {} },
    tasks: {},
    media: {},
    agent: { mcp: {} }
  }
}

const REQUIRED_BRIDGE_MEMBERS: Array<keyof CherryHostBridge> = [
  'chat', 'media', 'sessions', 'assistants', 'topics', 'latest',
  'providers', 'models', 'mcp', 'settings', 'attachments',
  'context', 'permissions', 'windows', 'domains'
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('compat fallback host bridge', () => {
  it('exposes every member of the typed CherryHostBridge contract', () => {
    // The fallback bridge is what renders when no explicit bridge is passed (the real
    // window path). A member added to the shared contract but forgotten here throws
    // `Cannot read properties of undefined` at runtime, which is what this guards.
    vi.stubGlobal('window', { api: stubApi() })
    const bridge = getBridge()
    for (const member of REQUIRED_BRIDGE_MEMBERS) {
      expect(bridge[member], `missing bridge member: ${String(member)}`).toBeDefined()
    }
  })

  it('routes latest.session and latest.topic through the preload session API', async () => {
    vi.stubGlobal('window', { api: stubApi() })
    const bridge = getBridge()
    await expect(bridge.latest.session({ kind: 'chat' })).resolves.toBeNull()
    await expect(bridge.latest.topic({ sessionId: 's1' })).resolves.toBeNull()
  })
})
