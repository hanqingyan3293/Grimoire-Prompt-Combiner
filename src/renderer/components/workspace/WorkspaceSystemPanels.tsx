import React, { useEffect, useMemo, useState } from "react"
import { LoaderCircle, RefreshCw, Settings2 } from "lucide-react"
import { useProviderStore } from "../../stores/providers.store"

export function WorkspaceLogsPanel() {
  const [logs, setLogs] = useState<Array<{ id: number; message: string; stack: string; context: string; created_at: string }>>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setLogs(await window.api.error.getAll()) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return logs
    return logs.filter(log => [log.message, log.stack, log.context, log.created_at].join(" ").toLowerCase().includes(value))
  }, [logs, query])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-[var(--color-bg-secondary)] p-3">
      <div className="flex shrink-0 items-center gap-2">
        <input value={query} onChange={event => setQuery(event.target.value)} className="ui-field min-w-0 flex-1" placeholder="搜索诊断日志" aria-label="搜索诊断日志" />
        <button type="button" onClick={() => void load()} disabled={loading} className="ui-toolbar-button" title="刷新日志" aria-label="刷新日志"><RefreshCw size={15} className={loading ? "ui-spin" : ""} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {filtered.length === 0 ? <div className="ui-empty-state h-full">暂无诊断日志</div> : filtered.map(log => (
          <article key={log.id} className="ui-list-card ui-list-card-no-hover p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 text-xs font-medium text-[var(--color-danger)]">{log.message}</div><time className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{log.created_at}</time></div>
            {log.context && <div className="mt-2 text-[11px] text-[var(--color-text-secondary)]">{log.context}</div>}
            {log.stack && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-secondary)]">{log.stack}</pre>}
          </article>
        ))}
      </div>
    </div>
  )
}

export function WorkspaceProviderManagerPanel() {
  const { providers, activeProvider, loading, loadProviders, setActive } = useProviderStore()
  const safeProviders = providers.filter(Boolean).map(provider => ({ ...provider, models: Array.isArray(provider.models) ? provider.models : [] }))
  useEffect(() => { void loadProviders() }, [loadProviders])
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-[var(--color-bg-secondary)] p-3">
      <div className="flex shrink-0 items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">供应商管理</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">管理连接状态和当前供应商，详细编辑在设置中完成。</p></div><button type="button" onClick={() => void window.api.window.openSettings()} className="ui-button ui-button-secondary ui-button-sm"><Settings2 size={14} />编辑设置</button></div>
      {loading && <div className="ui-empty-state"><LoaderCircle size={17} className="ui-spin" />正在加载供应商</div>}
      {!loading && providers.length === 0 && <div className="ui-empty-state">尚未配置供应商</div>}
      <div className="grid gap-3 grid-cols-2">{safeProviders.map(provider => <article key={provider.id} className="ui-list-card p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{provider.name}</div><div className="mt-1 truncate text-[11px] text-[var(--color-text-secondary)]">{provider.base_url || "未设置地址"}</div></div>{provider.is_active && <span className="ui-status-badge ui-status-badge-success">当前</span>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded bg-[var(--color-bg-secondary)] p-2"><div className="text-[var(--color-text-secondary)]">默认模型</div><div className="mt-1 truncate text-[var(--color-text-primary)]">{provider.default_model || "未设置"}</div></div><div className="rounded bg-[var(--color-bg-secondary)] p-2"><div className="text-[var(--color-text-secondary)]">可用模型</div><div className="mt-1 text-[var(--color-text-primary)]">{provider.models.length}</div></div></div>{!provider.is_active && <button type="button" onClick={() => void setActive(provider.id)} className="ui-button ui-button-secondary ui-button-sm mt-3 w-full">设为当前供应商</button>}</article>)}</div>
    </div>
  )
}

export function WorkspaceModelManagerPanel() {
  const { providers, loading, loadProviders } = useProviderStore()
  const [query, setQuery] = useState("")
  useEffect(() => { void loadProviders() }, [loadProviders])
  const models = useMemo(() => providers.filter(Boolean).flatMap(provider => (Array.isArray(provider.models) ? provider.models : []).map(model => ({ model, provider: provider.name, active: provider.is_active }))).filter((item, index, list) => list.findIndex(other => other.model === item.model && other.provider === item.provider) === index).filter(item => !query.trim() || item.model.toLowerCase().includes(query.trim().toLowerCase()) || item.provider.toLowerCase().includes(query.trim().toLowerCase())), [providers, query])
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-[var(--color-bg-secondary)] p-3">
      <div className="flex shrink-0 items-center gap-2"><input value={query} onChange={event => setQuery(event.target.value)} className="ui-field min-w-0 flex-1" placeholder="搜索模型或供应商" aria-label="搜索模型" /><button type="button" onClick={() => void loadProviders()} className="ui-toolbar-button" title="刷新模型" aria-label="刷新模型"><RefreshCw size={15} /></button></div>
      {loading ? <div className="ui-empty-state flex-1"><LoaderCircle size={17} className="ui-spin" />正在加载模型</div> : <div className="min-h-0 flex-1 overflow-auto"><div className="grid gap-2 grid-cols-2">{models.map(item => <div key={item.provider + ":" + item.model} className="ui-list-card p-3"><div className="truncate text-sm text-[var(--color-text-primary)]" title={item.model}>{item.model}</div><div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]"><span className="truncate">{item.provider}</span>{item.active && <span className="ui-status-badge ui-status-badge-success">当前供应商</span>}</div></div>)}</div>{models.length === 0 && <div className="ui-empty-state mt-4">暂无模型</div>}</div>}
    </div>
  )
}

