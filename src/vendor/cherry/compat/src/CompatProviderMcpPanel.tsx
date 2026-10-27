import { CheckCircle2, ChevronDown, Circle, Download, FlaskConical, CircleAlert, CircleCheck, KeyRound, Plug, Plus, RefreshCw, Search, Server, Settings2, Trash2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Provider } from '../../../../shared/types'
import type { McpServerRecord } from '../../../../shared/agent-types'
import { McpDetailItem, McpDetailList } from '../../source/src/renderer/pages/settings/McpSettings/McpDetailList'
import ModelListSyncContent from '../../source/src/renderer/pages/settings/ProviderSettings/ModelList/ModelListSyncContent'
import { useModelListSyncView } from '../../source/src/renderer/pages/settings/ProviderSettings/ModelList/useModelListSyncView'
import { createUniqueModelId, type Model, type UniqueModelId } from '../../source/src/shared/data/types/model'
import { useCherryHost } from './shims/cherry-host-provider'

type AnyRecord = Record<string, any>

type CompatProviderMcpPanelProps = {
  onProviderSettings: () => void
}

function providerStatus(provider: Provider): string {
  if (provider.is_active) return '当前'
  if (provider.has_api_key) return '已配置'
  return '未配置'
}

/** Grimoire stores model ids as strings; the Cherry sync view works on Cherry `Model` rows. */
function toCherryModel(providerId: string, modelId: string): Model {
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    apiModelId: modelId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

function mcpStatus(server: McpServerRecord): { label: string; tone: string } {
  if (server.status === 'connected') return { label: '已连接', tone: 'text-emerald-600 dark:text-emerald-400' }
  if (server.status === 'failed') return { label: '失败', tone: 'text-red-600 dark:text-red-400' }
  if (server.status === 'connecting') return { label: '连接中', tone: 'text-amber-600 dark:text-amber-400' }
  return { label: '未连接', tone: 'text-muted-foreground' }
}

export function CompatProviderMcpPanel({ onProviderSettings }: CompatProviderMcpPanelProps) {
  const host = useCherryHost()
  const providersApi = host.providers as AnyRecord
  const mcpApi = host.mcp as AnyRecord
  const [providers, setProviders] = useState<Provider[]>([])
  const [servers, setServers] = useState<McpServerRecord[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [serversLoading, setServersLoading] = useState(true)
  const [providersError, setProvidersError] = useState('')
  const [serversError, setServersError] = useState('')
  const [busyServerId, setBusyServerId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newServerName, setNewServerName] = useState('')
  const [newServerEndpoint, setNewServerEndpoint] = useState('')
  const [toolSearch, setToolSearch] = useState('')
  const [expandedToolKey, setExpandedToolKey] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [providerApiKey, setProviderApiKey] = useState('')
  const [modelPreview, setModelPreview] = useState<string[]>([])
  const [selectedPreviewModels, setSelectedPreviewModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ providerId: string; ok: boolean; message: string } | null>(null)
  const [applyError, setApplyError] = useState('')
  const providerRequestRef = useRef(0)

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true)
    try {
      const result = await providersApi.list()
      setProviders(Array.isArray(result) ? result : [])
      setProvidersError('')
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProvidersLoading(false)
    }
  }, [providersApi])

  const loadServers = useCallback(async () => {
    setServersLoading(true)
    try {
      const result = await mcpApi.list()
      setServers(Array.isArray(result) ? result : [])
      setServersError('')
    } catch (cause) {
      setServersError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setServersLoading(false)
    }
  }, [mcpApi])

  useEffect(() => {
    void Promise.all([loadProviders(), loadServers()])
  }, [loadProviders, loadServers])

  useEffect(() => {
    setSelectedProviderId(current => current && providers.some(provider => provider.id === current) ? current : providers[0]?.id || null)
  }, [providers])

  useEffect(() => {
    providerRequestRef.current += 1
    setProviderApiKey('')
    setModelPreview([])
    setSelectedPreviewModels([])
    setModelsError('')
    setTestResult(null)
    setApplyError('')
  }, [selectedProviderId])

  const selectedProvider = providers.find(provider => provider.id === selectedProviderId) || null
  const cherryModels = useMemo<Model[]>(
    () => (selectedProvider ? modelPreview.map(modelId => toCherryModel(selectedProvider.id, modelId)) : []),
    [modelPreview, selectedProvider]
  )
  const syncView = useModelListSyncView({ models: cherryModels, resetKey: (selectedProviderId || '') + ':' + modelPreview.length })
  const localModelIds = useMemo<Set<UniqueModelId>>(
    () => new Set((selectedProvider?.models || []).map(modelId => createUniqueModelId(selectedProvider!.id, modelId))),
    [selectedProvider]
  )
  const selectedModelIds = useMemo<Set<UniqueModelId>>(
    () => new Set(selectedPreviewModels.map(modelId => createUniqueModelId(selectedProvider?.id || 'provider', modelId))),
    [selectedPreviewModels, selectedProvider]
  )
  const configuredProviderCount = useMemo(() => providers.filter(provider => provider.has_api_key || provider.has_auth_config).length, [providers])
  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase()
    return servers.flatMap(server => server.tools
      .filter(tool => !query || [tool.name, tool.description || ''].some(value => value.toLowerCase().includes(query)))
      .map(tool => ({ server, tool })))
  }, [servers, toolSearch])

  const toggleTool = async (server: McpServerRecord, toolName: string, enabled: boolean) => {
    setBusyServerId(server.id)
    try {
      const enabledTools = enabled
        ? [...new Set([...server.enabled_tools, toolName])]
        : server.enabled_tools.filter(name => name !== toolName)
      await mcpApi.save({ id: server.id, enabled_tools: enabledTools })
      await loadServers()
    } catch (cause) {
      setServersError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyServerId(null)
    }
  }

  const fetchProviderModels = async () => {
    if (!selectedProvider) return
    const requestId = ++providerRequestRef.current
    setModelsLoading(true)
    setModelsError('')
    setSelectedPreviewModels([])
    try {
      const result = await providersApi.fetchModelsForProvider({ providerId: selectedProvider.id, apiKey: providerApiKey || undefined })
      if (requestId !== providerRequestRef.current) return
      if (!result?.success) {
        setModelPreview([])
        setModelsError(result?.error || '获取模型列表失败')
        return
      }
      const rawModels: unknown[] = Array.isArray(result.models) ? result.models : []
      const models = rawModels.filter((model): model is string => typeof model === 'string' && model.trim().length > 0).map(model => model.trim())
      setModelPreview([...new Set(models)].sort())
      setSelectedPreviewModels([...new Set(models)].sort())
    } catch (cause) {
      if (requestId === providerRequestRef.current) setModelsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestId === providerRequestRef.current) setModelsLoading(false)
    }
  }

  const applyProviderModels = async () => {
    if (!selectedProvider || selectedPreviewModels.length === 0) return
    setApplyError('')
    try {
      await providersApi.save({ id: selectedProvider.id, name: selectedProvider.name, access_mode: selectedProvider.access_mode, protocol: selectedProvider.protocol, base_url: selectedProvider.base_url, default_model: selectedProvider.default_model, test_model: selectedProvider.test_model, context_size: selectedProvider.context_size, models: [...new Set([...selectedProvider.models, ...selectedPreviewModels])] })
      await loadProviders()
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleSelectModels = (modelIds: UniqueModelId[], selected: boolean) => {
    if (!selectedProvider) return
    const prefix = selectedProvider.id + '::'
    const plainIds = modelIds.map(id => id.startsWith(prefix) ? id.slice(prefix.length) : id)
    setSelectedPreviewModels(current => selected
      ? [...new Set([...current, ...plainIds])]
      : current.filter(modelId => !plainIds.includes(modelId)))
  }

  const testProvider = async () => {
    if (!selectedProvider) return
    setTestingProviderId(selectedProvider.id)
    setTestResult(null)
    try {
      const result = await providersApi.testProvider({ providerId: selectedProvider.id, apiKey: providerApiKey || undefined, model: selectedProvider.test_model || selectedProvider.default_model, protocol: selectedProvider.protocol })
      setTestResult({ providerId: selectedProvider.id, ok: Boolean(result?.success), message: result?.message || result?.error || (result?.success ? '连接成功' : '连接失败') })
    } catch (cause) {
      setTestResult({ providerId: selectedProvider.id, ok: false, message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setTestingProviderId(null)
    }
  }

  const createServer = async () => {
    if (!newServerName.trim() || !newServerEndpoint.trim()) return
    setBusyServerId('new')
    try {
      await mcpApi.save({ name: newServerName.trim(), transport: 'http', endpoint: newServerEndpoint.trim(), enabled: true })
      setNewServerName('')
      setNewServerEndpoint('')
      setShowCreate(false)
      await loadServers()
    } catch (cause) {
      setServersError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyServerId(null)
    }
  }

  const toggleServer = async (server: McpServerRecord) => {
    setBusyServerId(server.id)
    try {
      if (server.status === 'connected' || server.status === 'connecting') await mcpApi.disconnect(server.id)
      else await mcpApi.connect(server.id)
      await loadServers()
    } catch (cause) {
      setServersError(cause instanceof Error ? cause.message : String(cause))
      await loadServers()
    } finally {
      setBusyServerId(null)
    }
  }

  const deleteServer = async (server: McpServerRecord) => {
    setBusyServerId(server.id)
    try {
      await mcpApi.delete(server.id)
      await loadServers()
    } catch (cause) {
      setServersError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyServerId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <section className="rounded-lg border border-border-subtle bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plug size={15} />
            <div>
              <h2 className="text-sm font-semibold">Provider</h2>
              <p className="text-[10px] text-muted-foreground">通过 Grimoire safeStorage 与主进程 Provider IPC 管理</p>
            </div>
          </div>
          <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={onProviderSettings}>
            <Settings2 size={13} />打开设置
          </button>
        </div>
        {providersError ? <div role="alert" className="mb-2 text-xs text-red-600">{providersError}</div> : null}
        {providersLoading ? <div className="py-3 text-xs text-muted-foreground">加载 Provider…</div> : providers.length === 0 ? <div className="py-3 text-xs text-muted-foreground">尚未配置 Provider</div> : (
          <div className="space-y-1.5">
            {providers.slice(0, 8).map(provider => (
              <div key={provider.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-xs">
                {provider.is_active ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Circle size={13} className="text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                <span className="text-[10px] text-muted-foreground">{providerStatus(provider)}</span>
                <span className="max-w-40 truncate text-[10px] text-muted-foreground">{provider.default_model || '未设置模型'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-[10px] text-muted-foreground">已配置 {configuredProviderCount} / {providers.length} · 密钥不会回传到 renderer</div>
        {selectedProvider ? (
          <div className="mt-3 rounded-md border border-border-subtle bg-background-subtle p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                <span className="shrink-0">Provider</span>
                <select className="min-w-0 flex-1 rounded border bg-background px-2 py-1" value={selectedProvider.id} onChange={event => { setSelectedProviderId(event.target.value); setModelPreview([]); setSelectedPreviewModels([]); setTestResult(null) }}>
                  {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
              </label>
              <span className="text-[10px] text-muted-foreground">{selectedProvider.models.length} 个已保存模型</span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <KeyRound size={13} className="text-muted-foreground" />
              <input aria-label="Provider API Key" type="password" className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs" value={providerApiKey} onChange={event => setProviderApiKey(event.target.value)} placeholder={selectedProvider.has_api_key ? '已配置，留空使用已保存密钥' : '输入 API Key 后拉取模型'} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50" disabled={modelsLoading || !selectedProvider.base_url || (!providerApiKey && !selectedProvider.has_api_key)} onClick={() => void fetchProviderModels()}><Download size={13} />{modelsLoading ? '拉取中…' : '刷新模型'}</button>
              <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50" disabled={testingProviderId === selectedProvider.id || !(selectedProvider.test_model || selectedProvider.default_model) || (!providerApiKey && !selectedProvider.has_api_key)} onClick={() => void testProvider()}><FlaskConical size={13} />{testingProviderId === selectedProvider.id ? '测试中…' : '测试连接'}</button>
              <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50" disabled={!selectedPreviewModels.length} onClick={() => void applyProviderModels()}><CheckCircle2 size={13} />应用选择（{selectedPreviewModels.length}）</button>
            </div>
            {modelsError ? <div role="alert" className="mt-2 flex items-center gap-1 text-xs text-red-600"><CircleAlert size={13} />{modelsError}<button type="button" className="ml-auto underline" onClick={() => void fetchProviderModels()}>重试</button></div> : null}
            {applyError ? <div role="alert" className="mt-2 flex items-center gap-1 text-xs text-red-600"><CircleAlert size={13} />{applyError}</div> : null}
            {testResult?.providerId === selectedProvider.id ? <div role={testResult.ok ? 'status' : 'alert'} className={'mt-2 flex items-center gap-1 text-xs ' + (testResult.ok ? 'text-emerald-600' : 'text-red-600')}>{testResult.ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />}{testResult.message}</div> : null}
            {modelPreview.length ? (
              <div className="mt-2 h-64 min-h-0 rounded border border-border-subtle bg-background" data-testid="provider-model-sync">
                <ModelListSyncContent
                  mode="select"
                  view={syncView}
                  isLoading={modelsLoading}
                  isApplying={false}
                  localModelIds={localModelIds}
                  selectedModelIds={selectedModelIds}
                  onSelectModels={handleSelectModels}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border-subtle bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Server size={15} />
            <div>
              <h2 className="text-sm font-semibold">MCP Servers</h2>
              <p className="text-[10px] text-muted-foreground">HTTP / stdio 连接、tools/list 和 callTool 走主进程服务</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="刷新 MCP" onClick={() => void loadServers()}><RefreshCw size={13} /></button>
            <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={() => setShowCreate(value => !value)}><Plus size={13} />新增</button>
          </div>
        </div>
        {showCreate ? (
          <div className="mb-2 grid gap-2 rounded-md border border-border-subtle bg-background-subtle p-2">
            <input className="rounded border bg-background px-2 py-1.5 text-xs" value={newServerName} onChange={event => setNewServerName(event.target.value)} placeholder="Server 名称" />
            <input className="rounded border bg-background px-2 py-1.5 text-xs" value={newServerEndpoint} onChange={event => setNewServerEndpoint(event.target.value)} placeholder="HTTP endpoint" />
            <button type="button" className="justify-self-end rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50" disabled={busyServerId === 'new'} onClick={() => void createServer()}>保存</button>
          </div>
        ) : null}
        {serversError ? <div role="alert" className="mb-2 flex items-center gap-2 text-xs text-red-600"><XCircle size={13} /><span>{serversError}</span></div> : null}
        {serversLoading ? <div className="py-3 text-xs text-muted-foreground">加载 MCP…</div> : servers.length === 0 ? <div className="py-3 text-xs text-muted-foreground">尚未配置 MCP Server</div> : (
          <div className="space-y-1.5">
            {servers.map(server => {
              const status = mcpStatus(server)
              return (
                <div key={server.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-xs">
                  <span className={status.tone}>{server.status === 'connected' ? <CheckCircle2 size={13} /> : <Circle size={13} />}</span>
                  <span className="min-w-0 flex-1 truncate">{server.name}</span>
                  <span className={'text-[10px] ' + status.tone}>{status.label}</span>
                  <span className="text-[10px] text-muted-foreground">{server.tools.length} tools</span>
                  <button type="button" className="rounded px-1.5 py-1 text-[10px] hover:bg-muted" disabled={busyServerId === server.id} onClick={() => void toggleServer(server)}>{server.status === 'connected' ? '断开' : '连接'}</button>
                  <button type="button" className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-red-600" aria-label={'删除 ' + server.name} disabled={busyServerId === server.id} onClick={() => void deleteServer(server)}><Trash2 size={13} /></button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Tools</h2>
            <p className="text-[10px] text-muted-foreground">复用 Cherry MCP 工具列表的搜索、启用状态和 schema 展开语义</p>
          </div>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input aria-label="搜索 MCP 工具" className="w-44 rounded border bg-background py-1 pl-7 pr-2 text-xs" value={toolSearch} onChange={event => setToolSearch(event.target.value)} placeholder="搜索工具" />
          </div>
        </div>
        {filteredTools.length === 0 ? <div className="py-2 text-xs text-muted-foreground">没有已发现的工具</div> : (
          <div className="space-y-1.5">
            {filteredTools.map(({ server, tool }) => {
              const key = server.id + ':' + tool.name
              const enabled = server.enabled_tools.includes(tool.name)
              const expanded = expandedToolKey === key
              return (
                <div key={key} className="rounded-md border border-border-subtle">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                    <button type="button" className="inline-flex size-5 items-center justify-center rounded hover:bg-muted" aria-label={expanded ? '收起工具详情' : '展开工具详情'} onClick={() => setExpandedToolKey(expanded ? null : key)}><ChevronDown size={13} className={expanded ? 'rotate-180' : ''} /></button>
                    <span className="min-w-0 flex-1 truncate" title={tool.description}>{tool.name}</span>
                    <span className="text-[10px] text-muted-foreground">{server.name}</span>
                    <button type="button" className={'rounded px-1.5 py-1 text-[10px] ' + (enabled ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')} disabled={busyServerId === server.id} onClick={() => void toggleTool(server, tool.name, !enabled)}>{enabled ? '已启用' : '启用'}</button>
                  </div>
                  {expanded ? (
                    <McpDetailList className="m-2 text-[11px]">
                      <McpDetailItem label="描述">{tool.description || '无描述'}</McpDetailItem>
                      <McpDetailItem label="输入 Schema"><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(tool.inputSchema || {}, null, 2)}</pre></McpDetailItem>
                    </McpDetailList>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-300">
        Cherry marketplace、prompts/resources、trust/log/restart 和 auto-approve 等未接入 Grimoire service 的 MCP 功能保持 partial/blocked，不显示为成功状态。
      </div>
    </div>
  )
}
