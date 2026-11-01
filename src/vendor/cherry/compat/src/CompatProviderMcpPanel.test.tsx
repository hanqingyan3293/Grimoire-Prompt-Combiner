import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompatProviderMcpPanel } from './CompatProviderMcpPanel'
import type { CherryHostBridge, CherryProviderApi } from '../../../../shared/cherry-host-types'
import type { Provider } from '../../../../shared/types'
import type { McpServerRecord } from '../../../../shared/agent-types'

// This panel consumes only these MCP projection fields; no transport is simulated.
type McpFixture = Pick<McpServerRecord, 'id' | 'name' | 'transport' | 'endpoint' | 'status' | 'tools' | 'enabled_tools'>

const providerFixtures: Provider[] = [
  { id: 'p1', name: 'OpenAI', access_mode: 'api', protocol: 'chat_completions', base_url: 'https://api.openai.com/v1', is_active: true, has_api_key: true, has_auth_config: false, default_model: 'gpt-4o', test_model: 'gpt-4o-mini', context_size: null, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', models: ['gpt-4o'] },
  { id: 'p2', name: 'Backup', access_mode: 'api', protocol: 'responses', base_url: 'https://backup.example.com/v1', is_active: false, has_api_key: true, has_auth_config: false, default_model: 'o3', test_model: 'o3-mini', context_size: null, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', models: [] },
]

const host = {
  providers: {
    list: vi.fn<CherryProviderApi['list']>(async () => providerFixtures),
    fetchModels: vi.fn<CherryProviderApi['fetchModels']>(async () => ({ success: true, models: ['z-model', 'a-model', 'a-model'] })),
    fetchModelsForProvider: vi.fn<CherryProviderApi['fetchModelsForProvider']>(async () => ({ success: true, models: ['z-model', 'a-model', 'a-model'] })),
    test: vi.fn<CherryProviderApi['test']>(async () => ({ success: true, message: '连接成功' })),
    testProvider: vi.fn<CherryProviderApi['testProvider']>(async () => ({ success: true, message: '连接成功' })),
    save: vi.fn<CherryProviderApi['save']>(async () => ({ id: 'p1' })),
  },
  mcp: {
    list: vi.fn<() => Promise<McpFixture[]>>(async () => [{ id: 'm1', name: 'Docs', transport: 'http', endpoint: 'http://localhost:3000/mcp', status: 'disconnected', tools: [], enabled_tools: [] }]),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => true),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    callTool: vi.fn(async () => undefined),
  },
} satisfies {
  providers: Pick<CherryHostBridge['providers'], 'list' | 'fetchModels' | 'fetchModelsForProvider' | 'test' | 'testProvider' | 'save'>
  mcp: CherryHostBridge['mcp']
}

vi.mock('./shims/cherry-host-provider', () => ({ useCherryHost: () => host }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompatProviderMcpPanel', () => {
  it('loads provider and MCP status through the Host Bridge', async () => {
    render(<CompatProviderMcpPanel onProviderSettings={vi.fn()} />)
    expect(await screen.findByText('OpenAI')).toBeTruthy()
    expect(await screen.findByText('Docs')).toBeTruthy()
    // WAIT ON THE ASSERTION, not on the DOM. `findByText` resolves when the panel has painted,
    // which is not the same moment the Host callbacks have been recorded — under full-suite
    // scheduling the count could still be 0 here. That produced a ~1-in-7 intermittent failure
    // in the suite while passing 8/8 in isolation: a red light that trains people to ignore red
    // lights. `waitFor` makes the wait and the assertion the same condition.
    await waitFor(() => expect(host.providers.list).toHaveBeenCalledOnce())
    await waitFor(() => expect(host.mcp.list).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '刷新模型' })).toBeTruthy()
  })

  it('pulls models with the saved key, previews via the source sync view, and applies explicitly', async () => {
    render(<CompatProviderMcpPanel onProviderSettings={vi.fn()} />)
    // Clicking before the panel's first `providers.list()` resolves leaves the refresh a no-op, and the only
    // symptom is a missing test id 15s later. Wait for the loaded state, not just for the button to exist.
    await waitFor(() => expect(host.providers.list).toHaveBeenCalled())
    await screen.findByText(/OpenAI/)
    // 刷新模型 is DISABLED without base_url + a key, and a click on a disabled button is a no-op — the
    // element then never appears and the failure reads as a mystery timeout. Wait for enabled, then click.
    const refresh = await screen.findByRole('button', { name: '刷新模型' })
    await waitFor(() => expect(refresh).not.toBeDisabled())
    fireEvent.click(refresh)
    expect(await screen.findByTestId('provider-model-sync')).toBeTruthy()
    expect((await screen.findAllByText('a-model')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('z-model').length).toBeGreaterThan(0)
    // The saved key stays in the main process: no key is sent from the renderer.
    expect(host.providers.fetchModelsForProvider).toHaveBeenCalledWith({ providerId: 'p1', apiKey: undefined })
    expect(host.providers.fetchModels).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: '测试连接' })[0])
    await waitFor(() => expect(host.providers.testProvider).toHaveBeenCalledWith({ providerId: 'p1', apiKey: undefined, model: 'gpt-4o-mini', protocol: 'chat_completions' }))

    fireEvent.click(screen.getAllByRole('button', { name: /应用选择/ })[0])
    await waitFor(() => expect(host.providers.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', models: expect.arrayContaining(['gpt-4o', 'a-model', 'z-model']) })))
  })

  it('keeps stale pull results from the previous provider out of the current selection', async () => {
    let resolvePull: (value: Awaited<ReturnType<CherryProviderApi['fetchModelsForProvider']>>) => void = () => undefined
    host.providers.fetchModelsForProvider.mockImplementationOnce(() => new Promise(resolve => { resolvePull = resolve }))
    render(<CompatProviderMcpPanel onProviderSettings={vi.fn()} />)
    expect(await screen.findByText('OpenAI')).toBeTruthy()
    await waitFor(() => expect(host.providers.list).toHaveBeenCalledOnce())
    fireEvent.click(await screen.findByRole('button', { name: '刷新模型' }))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2' } })
    // Only the first pull is in flight; switching providers does not start a second pull.
    expect(host.providers.fetchModelsForProvider).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('p2'))

    resolvePull({ success: true, models: ['stale-model'] })
    // The assertion is NEGATIVE: the stale result must never appear. A single
    // `setTimeout(0)` is not enough to prove that — it only flushes the first
    // microtask/macrotask turn, so under load the update this test exists to catch can
    // land AFTER the assertion and the run passes or fails by timing. Assert the
    // settled state instead: active work drains, then the stale model is still absent.
    // (`waitFor` cannot express this, since a negative assertion is satisfied
    // immediately and would return before the effect runs.)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('p2'))
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('stale-model')).toBeNull()
  })

  it('surfaces pull failures with a retry action', async () => {
    host.providers.fetchModelsForProvider.mockResolvedValueOnce({ success: false, error: 'HTTP 503' })
    render(<CompatProviderMcpPanel onProviderSettings={vi.fn()} />)
    // Same disabled-button trap as the test above: 刷新模型 needs base_url + a key before it can be clicked.
    const refreshButton = await screen.findByRole('button', { name: '刷新模型' })
    await waitFor(() => expect(refreshButton).not.toBeDisabled())
    fireEvent.click(refreshButton)
    expect(await screen.findByText('HTTP 503')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('connects and deletes MCP servers through host callbacks', async () => {
    render(<CompatProviderMcpPanel onProviderSettings={vi.fn()} />)
    const connect = (await screen.findAllByRole('button', { name: '连接' }))[0]
    fireEvent.click(connect)
    await waitFor(() => expect(host.mcp.connect).toHaveBeenCalledWith('m1'))
    // disabled={busyServerId === ...} or a selection guard: wait for enabled before clicking.
    await waitFor(() => expect(screen.getAllByRole('button', { name: '删除 Docs' })[0]).not.toBeDisabled())
    fireEvent.click(screen.getAllByRole('button', { name: '删除 Docs' })[0])
    await waitFor(() => expect(host.mcp.delete).toHaveBeenCalledWith('m1'))
  })

  it('filters and toggles discovered MCP tools without calling them', async () => {
    host.mcp.list.mockResolvedValueOnce([{ id: 'm1', name: 'Docs', transport: 'http', endpoint: 'http://localhost:3000/mcp', status: 'connected', tools: [{ name: 'search_docs', description: 'Search documentation', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }], enabled_tools: [] }])
    render(<CompatProviderMcpPanel onProviderSettings={vi.fn()} />)
    expect(await screen.findByText('search_docs')).toBeTruthy()
    fireEvent.change(screen.getAllByRole('textbox', { name: '搜索 MCP 工具' })[0], { target: { value: 'search_docs' } })
    expect(await screen.findByText('search_docs')).toBeTruthy()
    // disabled={busyServerId === ...} or a selection guard: wait for enabled before clicking.
    await waitFor(() => expect(screen.getByRole('button', { name: '启用' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => expect(host.mcp.save).toHaveBeenCalledWith({ id: 'm1', enabled_tools: ['search_docs'] }))
    expect(host.mcp.callTool).not.toHaveBeenCalled()
  })
})
