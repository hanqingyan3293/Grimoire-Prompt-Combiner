import { useEffect, useState } from 'react'
import { CloudCog, Link2, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react'
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

  const load = async () => {
    setLoading(true)
    try { setServers(await window.api.agent.mcp.list()) }
    catch (error) { setMessage(error instanceof Error ? error.message : '读取 MCP 配置失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const save = async () => {
    try {
      await window.api.agent.mcp.save({ name: name.trim() || '未命名 MCP', transport, endpoint: transport === 'http' ? endpoint.trim() : '', command: transport === 'stdio' ? command.trim() : '', enabled: true })
      setName(''); setEndpoint(''); setCommand(''); setMessage('MCP 配置已保存'); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存 MCP 配置失败') }
  }

  const toggle = async (server: McpServerRecord) => {
    try { await (server.status === 'connected' ? window.api.agent.mcp.disconnect(server.id) : window.api.agent.mcp.connect(server.id)); await load() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'MCP 连接操作失败') }
  }
  const remove = async (server: McpServerRecord) => { await window.api.agent.mcp.delete(server.id); await load() }

  return (
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader icon={CloudCog} title='MCP 管理' description='配置外部工具服务器、连接状态和可用工具' actions={<IconButton icon={RefreshCw} label='刷新 MCP' onClick={() => void load()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />} />
      <section className='ui-list-card space-y-2 p-3'>
        <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]'><input className='ui-field' value={name} onChange={event => setName(event.target.value)} placeholder='Server 名称' /><select className='ui-field' value={transport} onChange={event => setTransport(event.target.value as McpTransport)}><option value='http'>HTTP</option><option value='stdio'>stdio</option></select></div>
        {transport === 'http' ? <input className='ui-field w-full' value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder='http://127.0.0.1:3000/mcp' /> : <input className='ui-field w-full' value={command} onChange={event => setCommand(event.target.value)} placeholder='MCP 启动命令' />}
        <Button size='sm' variant='primary' icon={Plus} onClick={() => void save()}>添加 MCP Server</Button>
        {message && <div className='ui-inline-note ui-inline-note-info text-xs' role='status'>{message}</div>}
      </section>
      {loading && !servers.length ? <div className='ui-empty-state text-sm'>正在读取 MCP</div> : servers.length === 0 ? <EmptyState icon={CloudCog} title='暂无 MCP Server' description='添加 HTTP 或 stdio MCP Server 后在这里管理' /> : <div className='space-y-2'>
        {servers.map(server => <article key={server.id} className='ui-list-card flex items-center gap-3 p-3'>
          <div className='grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-accent-text)]'><CloudCog size={17} /></div>
          <div className='min-w-0 flex-1'><div className='truncate text-sm font-medium'>{server.name}</div><div className='mt-1 truncate text-xs text-[var(--color-text-secondary)]'>{server.transport === 'http' ? server.endpoint : server.command}</div>{server.error_message && <div className='mt-1 truncate text-xs text-red-500'>{server.error_message}</div>}</div>
          <StatusBadge tone={server.status === 'connected' ? 'success' : server.status === 'failed' ? 'danger' : 'neutral'}>{server.status}</StatusBadge>
          <div className='flex shrink-0 gap-1'><IconButton icon={server.status === 'connected' ? Unplug : Link2} label={server.status === 'connected' ? '断开 MCP' : '连接 MCP'} onClick={() => void toggle(server)} /><IconButton icon={Trash2} label='删除 MCP' onClick={() => void remove(server)} className='ui-icon-button-danger' /></div>
        </article>)}
      </div>}
    </div>
  )
}
