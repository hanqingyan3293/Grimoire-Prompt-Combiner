import type { CherryCapabilityStatus, CherryDomainApi, CherryHostBridge } from '@shared/cherry-host-types'

function unsupportedDomain(id: string, message: string): CherryDomainApi {
  const status = async (): Promise<CherryCapabilityStatus> => ({
    id,
    state: 'blocked',
    message,
    nextAction: '保留 Cherry 入口，完成对应 Grimoire 服务适配后解除阻塞。',
  })
  return {
    status,
    list: async () => [],
    get: async () => null,
    invoke: async () => { throw new Error(message) },
  }
}

function availableDomain(id: string, message: string, list: CherryDomainApi['list']): CherryDomainApi {
  return {
    status: async () => ({ id, state: 'available', message }),
    list,
  }
}

/**
 * Renderer-side boundary for every Cherry component.
 *
 * The implementation delegates to the existing preload API. Secrets and
 * SQLite access therefore remain in the main process.
 */
export function getCherryHostBridge(): CherryHostBridge {
  const api = window.api
  const sessions = api.ai.sessions

  return {
    chat: {
      send: input => sessions.send(input),
      interrupt: sessionId => sessions.interrupt(sessionId),
      retry: input => sessions.retry(input),
      compact: sessionId => sessions.compact(sessionId),
      onEvent: callback => sessions.onEvent(callback),
    },
    media: {
      vision: input => api.ai.vision(input),
      generateImage: input => api.ai.generateImage(input),
    },
    sessions: {
      list: input => sessions.list(input),
      search: input => sessions.search(input),
      get: id => sessions.get(id),
      create: input => sessions.create(input || {}),
      import: input => sessions.import(input),
      update: input => sessions.update(input),
      archive: id => sessions.archive(id),
      restore: id => sessions.restore(id),
      pin: (id, pinned) => sessions.pin(id, pinned),
      reorder: input => sessions.reorder(input),
      delete: id => sessions.delete(id),
      branch: input => sessions.branch(input),
      appendMessage: input => sessions.appendMessage(input),
      updateMessage: input => sessions.updateMessage(input),
      deleteMessage: id => sessions.deleteMessage(id),
      appendEvent: input => sessions.appendEvent(input),
      runtimes: {
        list: () => sessions.runtimes.list(),
        prepare: kind => sessions.runtimes.prepare(kind),
      },
    },
    assistants: {
      list: input => sessions.assistants.list(input),
      save: input => sessions.assistants.save(input),
      delete: id => sessions.assistants.delete(id),
      archive: id => sessions.assistants.archive(id),
      restore: id => sessions.assistants.restore(id),
      pin: (id, pinned) => sessions.assistants.pin(id, pinned),
      reorder: input => sessions.assistants.reorder(input),
    },
    topics: {
      list: input => sessions.topics.list(input),
      save: input => sessions.topics.save(input),
      delete: id => sessions.topics.delete(id),
      archive: id => sessions.topics.archive(id),
      restore: id => sessions.topics.restore(id),
      pin: (id, pinned) => sessions.topics.pin(id, pinned),
      reorder: input => sessions.topics.reorder(input),
      latest: input => sessions.topics.latest(input),
    },
    latest: {
      session: input => sessions.latest(input),
      topic: input => sessions.topics.latest(input),
    },
    providers: {
      list: () => api.providers.list(),
      save: input => api.providers.save(input),
      delete: id => api.providers.delete(id),
      setActive: id => api.providers.setActive(id),
      fetchModels: (baseUrl, apiKey) => api.providers.fetchModels(baseUrl, apiKey),
      test: (baseUrl, apiKey, model, protocol) => api.providers.test(baseUrl, apiKey, model, protocol),
      fetchModelsForProvider: input => api.providers.fetchModelsForProvider(input),
      testProvider: input => api.providers.testProvider(input),
    },
    models: {
      list: async input => (await sessions.catalog.models(input)) as never,
      providers: input => sessions.catalog.providers(input),
    },
    mcp: {
      list: () => api.agent.mcp.list(),
      save: input => api.agent.mcp.save(input),
      delete: id => api.agent.mcp.delete(id),
      connect: id => api.agent.mcp.connect(id),
      disconnect: id => api.agent.mcp.disconnect(id),
      callTool: input => api.agent.mcp.callTool(input),
    },
    settings: {
      getAll: async () => (await api.settings.getAll()) as Record<string, unknown>,
      set: (key, value) => api.settings.set(key, value),
    },
    attachments: {
      select: () => sessions.attachments.select(),
      list: sessionId => sessions.attachments.list(sessionId),
      import: input => sessions.attachments.import(input),
      delete: id => sessions.attachments.delete(id),
      read: id => sessions.attachments.read(id),
    },
    context: {
      images: {
        list: async () => (await api.images.list()).map(item => ({ id: item.id, original_name: item.original_name })),
        readData: id => api.images.readData(id),
      },
      prompts: {
        list: input => api.promptAssets.list(input as never),
      },
      tags: {
        search: input => api.tags.search(input || {}),
      },
      canvases: {
        list: async () => api.canvas.list(),
      },
      wd14: {
        history: {
          list: input => api.wd14.history.list(input as never),
        },
      },
    },
    permissions: {
      onRequest: callback => sessions.onPermissionRequest(callback),
      decide: value => sessions.decidePermission(value),
    },
    windows: {
      openSettings: () => api.window.openSettings(),
      openAI: () => api.window.openAI(),
      openCherry: () => api.window.openCherry(),
      open: async kind => {
        if (kind === 'settings') {
          await api.window.openSettings()
          return { id: kind, state: 'available', message: 'Settings window opened' }
        }
        if (kind === 'ai' || kind === 'main') {
          await api.window.openAI()
          return { id: kind, state: 'available', message: 'AI window opened' }
        }
        if (kind === 'cherry') {
          await api.window.openCherry()
          return { id: kind, state: 'available', message: 'Cherry source UI opened' }
        }
        return { id: kind, state: 'blocked', message: 'Cherry window ' + kind + ' is not connected to an Electron window yet.' }
      },
    },
    domains: {
      browser: unsupportedDomain('browser', 'Cherry Browser requires a dedicated secure Browser service.'),
      knowledge: unsupportedDomain('knowledge', 'Cherry Knowledge requires a Grimoire knowledge service.'),
      files: availableDomain('files', 'Grimoire file services are available through the existing workspace.', async () => []),
      code: unsupportedDomain('code', 'Cherry Code requires a dedicated source runtime host.'),
      paintings: availableDomain('paintings', 'Grimoire image and Comfy services are available.', async () => api.media.list()),
      notes: unsupportedDomain('notes', 'Cherry Notes requires a Notes persistence adapter.'),
      translate: unsupportedDomain('translate', 'Cherry Translate requires a translation service adapter.'),
      selection: unsupportedDomain('selection', 'Cherry Selection Assistant requires a selection window bridge.'),
      scheduledTasks: availableDomain('scheduledTasks', 'Grimoire task services are available.', async () => api.tasks.list()),
      skills: unsupportedDomain('skills', 'Cherry Skills requires a Skills registry adapter.'),
    },
  }
}
