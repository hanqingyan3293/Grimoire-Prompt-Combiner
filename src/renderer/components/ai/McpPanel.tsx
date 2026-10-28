import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CloudCog, Link2, Play, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react'
import type { McpServerRecord, McpTransport } from '@shared/agent-types'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'

export function McpPanel() {
  const [servers, setServers] = useState<McpServerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('http')
  const [endpoint, setEndpoint] = useState('')
  const [command, setCommand] = useState('')
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({})
  const [toolResults, setToolResults] = useState<Record<string, string>>({})

  const getMcpApi = () => {
    const api = window.api?.agent?.mcp
    if (!api || typeof api.list !== 'function') {
      setMessage('当前 Electron 预加载脚本未提供 MCP API。请完全关闭 Grimoire 后使用启动脚本重新启动。')
      return null
    }
    return api
  }

  const load = async () => {
    setLoading(true)
    const api = getMcpApi()
    if (!api) { setServers([]); setLoading(false); return }
    try { setServers(await api.list()) }
    catch (error) { setMessage(error instanceof Error ? error.message : '读取 MCP 配置失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const save = async () => {
    const api = getMcpApi()
    if (!api) return
    try {
      await api.save({ name: name.trim() || '未命名 MCP', transport, endpoint: transport === 'http' ? endpoint.trim() : '', command: transport === 'stdio' ? command.trim() : '', enabled: true })
      setName(''); setEndpoint(''); setCommand(''); setMessage('MCP 配置已保存'); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存 MCP 配置失败') }
  }

  const toggle = async (server: McpServerRecord) => {
    const api = getMcpApi()
    if (!api) return
    try { await (server.status === 'connected' ? api.disconnect(server.id) : api.connect(server.id)); await load() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'MCP 连接操作失败') }
  }
  const remove = async (server: McpServerRecord) => { const api = getMcpApi(); if (!api) return; try { await api.delete(server.id); await load() } catch (error) { setMessage(error instanceof Error ? error.message : '删除 MCP 失败') } }
  const callTool = async (server: McpServerRecord, name: string) => {
    const api = getMcpApi()
    if (!api) return
    const key = server.id + ':' + name
    let args: Record<string, unknown> = {}
    const raw = toolArgs[key]?.trim()
    if (raw) {
      try { args = JSON.parse(raw) as Record<string, unknown> } catch { setToolResults(current => ({ ...current, [key]: '参数必须是合法 JSON' })); return }
    }
    try {
      const result = await api.callTool({ serverId: server.id, name, arguments: args })
      setToolResults(current => ({ ...current, [key]: JSON.stringify(result, null, 2) }))
    } catch (error) { setToolResults(current => ({ ...current, [key]: error instanceof Error ? error.message : String(error) })) }
  }
  const toggleTool = async (server: McpServerRecord, name: string) => {
    const api = getMcpApi()
    if (!api) return
    const enabled = server.enabled_tools.includes(name)
    try { await api.save({ id: server.id, enabled_tools: enabled ? server.enabled_tools.filter(item => item !== name) : [...server.enabled_tools, name] }); await load() }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存工具选择失败') }
  }

  return (
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader icon={CloudCog} title='MCP 管理' description='配置外部工具服务器、连接状态和可用工具' actions={<IconButton icon={RefreshCw} label='刷新 MCP' onClick={() => void load()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />} />
      <section className='ui-list-card space-y-2 p-3'>
        <div className='grid gap-2 grid-cols-[minmax(0,1fr)_140px]'><input className='ui-field' value={name} onChange={event => setName(event.target.value)} placeholder='Server 名称' /><select className='ui-field' value={transport} onChange={event => setTransport(event.target.value as McpTransport)}><option value='http'>HTTP</option><option value='stdio'>stdio</option></select></div>
        {transport === 'http' ? <input className='ui-field w-full' value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder='http://127.0.0.1:3000/mcp' /> : <input className='ui-field w-full' value={command} onChange={event => setCommand(event.target.value)} placeholder='MCP 启动命令' />}
        <Button size='sm' variant='primary' icon={Plus} onClick={() => void save()}>添加 MCP Server</Button>
        {message && <div className='ui-inline-note ui-inline-note-info text-xs' role='status'>{message}</div>}
      </section>
      {loading && !servers.length ? <div className='ui-empty-state text-sm'>正在读取 MCP</div> : servers.length === 0 ? <EmptyState icon={CloudCog} title='暂无 MCP Server' description='添加 HTTP 或 stdio MCP Server 后在这里管理' /> : <div className='space-y-2'>
        {servers.map(server => <article key={server.id} className='ui-list-card space-y-3 p-3'>
          <div className='flex items-center gap-3'>
          <div className='grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-accent-text)]'><CloudCog size={17} /></div>
          <div className='min-w-0 flex-1'><div className='truncate text-sm font-medium'>{server.name}</div><div className='mt-1 truncate text-xs text-[var(--color-text-secondary)]'>{server.transport === 'http' ? server.endpoint : server.command}</div>{server.error_message && <div className='mt-1 truncate text-xs text-red-500'>{server.error_message}</div>}</div>
          <StatusBadge tone={server.status === 'connected' ? 'success' : server.status === 'failed' ? 'danger' : 'neutral'}>{server.status}</StatusBadge>
          <div className='flex shrink-0 gap-1'><IconButton icon={server.status === 'connected' ? Unplug : Link2} label={server.status === 'connected' ? '断开 MCP' : '连接 MCP'} onClick={() => void toggle(server)} /><IconButton icon={Trash2} label='删除 MCP' onClick={() => void remove(server)} className='ui-icon-button-danger' /></div>
          </div>
          {server.status === 'connected' && <div className='border-t border-[var(--color-border)] pt-2'><button type='button' className='flex w-full items-center gap-2 text-left text-xs font-medium text-[var(--color-text-secondary)]' onClick={() => setExpanded(current => ({ ...current, [server.id]: !current[server.id] }))} aria-expanded={Boolean(expanded[server.id])}>{expanded[server.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}工具列表 · {server.tools.length} · 已启用 {server.enabled_tools.length}</button>{expanded[server.id] && <div className='mt-2 space-y-2'>{server.tools.length === 0 ? <div className='text-xs text-[var(--color-text-secondary)]'>该 Server 没有返回可用工具</div> : server.tools.map(tool => { const key = server.id + ':' + tool.name; const enabled = server.enabled_tools.includes(tool.name); return <div key={tool.name} className='rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2'><div className='flex items-start gap-2'><label className='flex min-w-0 flex-1 items-start gap-2'><input type='checkbox' checked={enabled} onChange={() => void toggleTool(server, tool.name)} aria-label={'启用工具 ' + tool.name} className='mt-0.5 accent-[var(--color-accent)]' /><span className='min-w-0'><span className='block truncate text-xs font-medium text-[var(--color-text-primary)]'>{tool.name}</span>{tool.description && <span className='mt-1 block text-[10px] text-[var(--color-text-secondary)]'>{tool.description}</span>}</span></label><button type='button' className='ui-toolbar-button' disabled={!enabled} onClick={() => void callTool(server, tool.name)} aria-label={'调用工具 ' + tool.name} title='调用工具'><Play size={13} /></button></div><input className='ui-field mt-2 w-full text-[11px]' value={toolArgs[key] || ''} onChange={event => setToolArgs(current => ({ ...current, [key]: event.target.value }))} placeholder='参数 JSON，例如 {}' />{toolResults[key] && <pre className='mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-secondary)]'>{toolResults[key]}</pre>}</div> })}</div>}</div>}
        </article>)}
      </div>}
    </div>
  )
}
