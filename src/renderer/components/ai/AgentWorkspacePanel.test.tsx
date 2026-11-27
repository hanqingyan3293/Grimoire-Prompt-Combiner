// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const snapshot = (runtime = 'openai-compatible', modelId = 'model-a') => ({
    session: { id: 's1', kind: 'chat', runtime, provider_id: runtime === 'pi' ? '' : 'provider', model_id: modelId, title: 'Session', status: 'idle', metadata: {}, created_at: 'now', updated_at: 'now' },
    messages: [], events: [],
  })
  const runtimes = [
    { kind: 'openai-compatible', available: true, source: 'system', driver: 'provider-adapter', executable: null, version: 'provider-adapter', message: 'provider', checkedAt: 'now', contract: { provider: 'grimoire', model: 'catalog' } },
    { kind: 'pi', available: true, source: 'embedded', driver: 'pi-sdk', executable: null, version: '1.0.1', message: 'sdk', checkedAt: 'now', contract: { provider: 'runtime', model: 'freeform' } },
  ]
  const bridge = {
    chat: { send: vi.fn(async () => ({})), interrupt: vi.fn(async () => true), retry: vi.fn(async () => null), compact: vi.fn(async () => null), onEvent: vi.fn(() => () => {}) },
    media: { vision: vi.fn(async () => ({ success: true })), generateImage: vi.fn(async () => ({ success: true })) },
    sessions: {
      list: vi.fn(async () => []), search: vi.fn(async () => []), get: vi.fn(async () => snapshot()),
      create: vi.fn(async input => ({ ...snapshot(String(input.runtime || 'openai-compatible'), String(input.modelId || '')), session: { ...snapshot().session, ...input } })),
      import: vi.fn(async () => snapshot().session), update: vi.fn(async input => ({ ...snapshot().session, ...input })),
      archive: vi.fn(async () => snapshot().session), restore: vi.fn(async () => snapshot().session), pin: vi.fn(async () => snapshot().session),
      reorder: vi.fn(async () => snapshot().session), delete: vi.fn(async () => true), branch: vi.fn(async () => snapshot().session),
      appendMessage: vi.fn(async () => ({})), updateMessage: vi.fn(async () => ({})), deleteMessage: vi.fn(async () => true), appendEvent: vi.fn(async () => ({})),
      runtimes: { list: vi.fn(async () => runtimes), prepare: vi.fn(async () => runtimes[0]) },
    },
    assistants: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn(), archive: vi.fn(), restore: vi.fn(), pin: vi.fn(), reorder: vi.fn() },
    topics: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn(), archive: vi.fn(), restore: vi.fn(), pin: vi.fn(), reorder: vi.fn(), latest: vi.fn(async () => null) },
    latest: { session: vi.fn(async () => null), topic: vi.fn(async () => null) },
    providers: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn(), setActive: vi.fn(), fetchModels: vi.fn(), test: vi.fn(), fetchModelsForProvider: vi.fn(), testProvider: vi.fn() },
    models: { list: vi.fn(async () => [{ id: 'model-a', name: 'Model A' }]), providers: vi.fn(async () => []) },
    mcp: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), callTool: vi.fn() },
    settings: { getAll: vi.fn(async () => ({})), set: vi.fn(async () => true) },
    attachments: { select: vi.fn(async () => null), list: vi.fn(async () => []), import: vi.fn(), delete: vi.fn(async () => true), read: vi.fn(async () => ({})) },
    context: { images: { list: vi.fn(async () => []), readData: vi.fn(async () => '') }, prompts: { list: vi.fn(async () => []) }, tags: { search: vi.fn(async () => []) }, canvases: { list: vi.fn(async () => []) }, wd14: { history: { list: vi.fn(async () => []) } } },
    permissions: { onRequest: vi.fn(() => () => {}), decide: vi.fn(async () => true) },
    windows: { openSettings: vi.fn(async () => {}), openAI: vi.fn(async () => {}), openCherry: vi.fn(async () => {}), open: vi.fn(async () => ({ id: 'x', state: 'available', message: 'ok' })) },
    domains: {},
  }
  return { bridge, snapshot, runtimes }
})

vi.mock('../../services/cherry-host-bridge', () => ({ getCherryHostBridge: () => h.bridge }))

import { useProviderStore } from '../../stores/providers.store'
import { useUnifiedAgentStore } from '../../stores/unified-agent.store'
import { AgentWorkspacePanel } from './AgentWorkspacePanel'

const provider = { id: 'provider', name: 'Provider', default_model: 'provider-default', models: ['model-a'], base_url: 'http://mock', is_active: true }

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    meta: { capabilities: { attachments: true, unifiedSessions: true, catalog: true } },
    dialog: { save: vi.fn(async () => true), open: vi.fn(async () => '') },
  }
  useProviderStore.setState({
    providers: [provider], activeProvider: provider, loading: false,
    loadProviders: vi.fn(async () => {}), setActive: vi.fn(async () => {}), refreshActive: vi.fn(async () => {}),
  } as never)
  useUnifiedAgentStore.setState({ activeSessionId: 's1', setActiveSessionId: vi.fn() } as never)
})

afterEach(() => cleanup())

describe('Agent workspace runtime selection', () => {
  it('never fills a local runtime model from the active provider default', async () => {
    h.bridge.sessions.get.mockResolvedValue(h.snapshot('pi', ''))
    render(<AgentWorkspacePanel />)
    await waitFor(() => expect(h.bridge.sessions.get).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(screen.getByLabelText('Runtime')).toHaveProperty('value', 'pi'))
    expect(screen.queryByText('provider-default')).toBeNull()
    expect(screen.getAllByText('未选择模型').length).toBeGreaterThan(0)
  })

  it('resets the provider/model on runtime change and restores a remembered valid model', async () => {
    h.bridge.sessions.get.mockResolvedValue(h.snapshot('openai-compatible', 'model-a'))
    render(<AgentWorkspacePanel />)
    await waitFor(() => expect(screen.getByLabelText('Runtime')).toHaveProperty('value', 'openai-compatible'))

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'pi' } })
    await waitFor(() => expect(h.bridge.sessions.update).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', runtime: 'pi', providerId: '', modelId: '' })))
    expect(screen.queryByText('provider-default')).toBeNull()

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'openai-compatible' } })
    await waitFor(() => expect(h.bridge.sessions.update).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', runtime: 'openai-compatible', providerId: 'provider', modelId: 'model-a' })))
    expect(screen.getAllByText('Model A').length).toBeGreaterThan(0)
  })
})
