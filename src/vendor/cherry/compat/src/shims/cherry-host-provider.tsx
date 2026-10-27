import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'

type AnyRecord = Record<string, any>

function unsupportedDomain(id: string, message: string): AnyRecord {
  return {
    status: async () => ({ id, state: 'blocked', message, nextAction: '完成对应 Grimoire 服务适配后解除阻塞。' }),
    list: async () => [],
    get: async () => null,
    invoke: async () => { throw new Error(message) }
  }
}

export function getBridge(): AnyRecord {
  const api = (window as AnyRecord).api as AnyRecord
  const sessions = api.ai.sessions
  return {
    chat: {
      send: (input: AnyRecord) => sessions.send(input),
      interrupt: (id: string) => sessions.interrupt(id),
      retry: (input: AnyRecord) => sessions.retry(input),
      compact: (id: string) => sessions.compact(id),
      onEvent: (callback: (event: AnyRecord) => void) => sessions.onEvent(callback)
    },
    sessions: {
      ...sessions,
      archive: (id: string) => sessions.archive(id),
      restore: (id: string) => sessions.restore(id),
      pin: (id: string, pinned: boolean) => sessions.pin(id, pinned)
    },
    assistants: sessions.assistants,
    topics: sessions.topics,
    latest: {
      session: (input?: AnyRecord) => sessions.latest(input || {}),
      topic: (input?: AnyRecord) => sessions.topics.latest(input || {})
    },
    // The source composer drop/paste path calls `window.api.file` / `fs` / `ipcApi`
    // directly; the compat window runs on Grimoire's preload, which now serves that
    // surface, so the bridge just re-exposes it for shim consumers.
    file: api.file,
    fs: api.fs,
    ipcApi: api.ipcApi,
    providers: api.providers,
    models: {
      list: (input?: AnyRecord) => sessions.catalog.models(input || {}),
      providers: (input?: AnyRecord) => sessions.catalog.providers(input || {})
    },
    mcp: {
      list: () => api.agent.mcp.list(),
      save: (input: AnyRecord) => api.agent.mcp.save(input),
      delete: (id: string) => api.agent.mcp.delete(id),
      connect: (id: string) => api.agent.mcp.connect(id),
      disconnect: (id: string) => api.agent.mcp.disconnect(id),
      callTool: (input: AnyRecord) => api.agent.mcp.callTool(input)
    },
    settings: api.settings,
    attachments: sessions.attachments,
    media: {
      vision: (input: AnyRecord) => api.ai.vision(input),
      generateImage: (input: AnyRecord) => api.ai.generateImage(input)
    },
    context: {
      images: {
        list: async () => (await api.images.list()).map((item: AnyRecord) => ({ id: item.id, original_name: item.original_name })),
        readData: (id: number) => api.images.readData(id)
      },
      prompts: { list: (input?: AnyRecord) => api.promptAssets.list(input || {}) },
      tags: { search: (input?: AnyRecord) => api.tags.search(input || {}) },
      canvases: { list: () => api.canvas.list() },
      wd14: { history: { list: (input?: AnyRecord) => api.wd14.history.list(input || {}) } }
    },
    permissions: {
      onRequest: (callback: (event: AnyRecord) => void) => sessions.onPermissionRequest(callback),
      decide: (input: AnyRecord) => sessions.decidePermission(input)
    },
    windows: {
      openSettings: () => api.window.openSettings(),
      openAI: () => api.window.openAI(),
      openCherry: () => api.window.openCherry(),
      open: async (kind: string) => {
        if (kind === 'settings') { await api.window.openSettings(); return { id: kind, state: 'available', message: 'Settings window opened' } }
        if (kind === 'ai' || kind === 'main') { await api.window.openAI(); return { id: kind, state: 'available', message: 'AI window opened' } }
        if (kind === 'cherry') { await api.window.openCherry(); return { id: kind, state: 'available', message: 'Cherry source UI opened' } }
        return { id: kind, state: 'blocked', message: 'Cherry window ' + kind + ' is not connected to an Electron window yet.' }
      }
    },
    domains: {
      browser: unsupportedDomain('browser', 'Cherry Browser requires a dedicated secure Browser service.'),
      knowledge: unsupportedDomain('knowledge', 'Cherry Knowledge requires a Grimoire knowledge service.'),
      files: { status: async () => ({ id: 'files', state: 'available', message: 'Grimoire file services are available.' }), list: async () => [] },
      code: unsupportedDomain('code', 'Cherry Code requires a dedicated source runtime host.'),
      paintings: { status: async () => ({ id: 'paintings', state: 'available', message: 'Grimoire image and Comfy services are available.' }), list: () => api.media.list() },
      notes: unsupportedDomain('notes', 'Cherry Notes requires a Notes persistence adapter.'),
      translate: unsupportedDomain('translate', 'Cherry Translate requires a translation service adapter.'),
      selection: unsupportedDomain('selection', 'Cherry Selection Assistant requires a selection window bridge.'),
      scheduledTasks: { status: async () => ({ id: 'scheduledTasks', state: 'available', message: 'Grimoire task services are available.' }), list: () => api.tasks.list() },
      skills: unsupportedDomain('skills', 'Cherry Skills requires a Skills registry adapter.')
    }
  }
}

const HostContext = createContext<AnyRecord | null>(null)

export function CherryHostProvider({ bridge, children }: PropsWithChildren<{ bridge?: AnyRecord }>) {
  // The fallback is built LAZILY — only when no bridge was supplied. `getBridge()` reads
  // `window.api` at call time, so building it unconditionally both wastes the work and
  // makes an injected bridge unusable anywhere `window.api` is absent (a test render, or
  // any context where the preload did not load). That is a real failure mode, not just a
  // test convenience: the provider should honour the bridge it was handed.
  const fallback = useMemo(() => (bridge ? null : getBridge()), [bridge])
  return <HostContext.Provider value={bridge || fallback}>{children}</HostContext.Provider>
}

export function useCherryHost(): AnyRecord {
  const value = useContext(HostContext)
  if (!value) throw new Error('useCherryHost must be used inside CherryHostProvider')
  return value
}
