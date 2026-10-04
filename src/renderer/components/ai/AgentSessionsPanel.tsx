import { useEffect, useState } from 'react'
import { GitBranch, MessageSquare, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { AgentRuntimeKind, AgentSessionRecord } from '@shared/agent-types'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'

const runtimes: Array<{ value: AgentRuntimeKind; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'pi', label: 'Pi' },
]

export function AgentSessionsPanel() {
  const [sessions, setSessions] = useState<AgentSessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [runtime, setRuntime] = useState<AgentRuntimeKind>('openai-compatible')
  const [model, setModel] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    try { setSessions(await window.api.agent.sessions.list()) }
    catch (error) { setMessage(error instanceof Error ? error.message : '读取 Agent 会话失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const create = async () => {
    try {
      await window.api.agent.sessions.create({ runtime, model, title: title.trim() || undefined })
      setTitle('')
      setMessage('会话已创建')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '创建会话失败') }
  }

  const branch = async (session: AgentSessionRecord) => {
    try { await window.api.agent.sessions.branch({ sessionId: session.id }); await load() }
    catch (error) { setMessage(error instanceof Error ? error.message : '创建分支失败') }
  }

  const remove = async (session: AgentSessionRecord) => {
    try { await window.api.agent.sessions.delete(session.id); await load() }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除会话失败') }
  }

  return (
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader icon={MessageSquare} title='Agent 会话' description='统一管理 Codex、OpenCode、Pi 和 OpenAI 兼容会话' actions={<IconButton icon={RefreshCw} label='刷新会话' onClick={() => void load()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />} />
      <section className='ui-list-card space-y-3 p-3'>
        <div className='grid gap-2 sm:grid-cols-2'>
          <select className='ui-field' value={runtime} onChange={event => setRuntime(event.target.value as AgentRuntimeKind)} aria-label='Agent Runtime'>
            {runtimes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input className='ui-field' value={model} onChange={event => setModel(event.target.value)} placeholder='模型（可选）' />
        </div>
        <div className='flex gap-2'>
          <input className='ui-field min-w-0 flex-1' value={title} onChange={event => setTitle(event.target.value)} placeholder='会话标题（可选）' />
          <Button size='sm' variant='primary' icon={Plus} onClick={() => void create()}>新建</Button>
        </div>
        {message && <div className='ui-inline-note ui-inline-note-info text-xs' role='status'>{message}</div>}
      </section>
      {loading && !sessions.length ? <div className='ui-empty-state text-sm'>正在读取会话</div> : sessions.length === 0 ? <EmptyState icon={MessageSquare} title='暂无 Agent 会话' description='创建会话后可以在这里查看、分支和恢复' /> : (
        <div className='space-y-2'>
          {sessions.map(session => <article key={session.id} className='ui-list-card flex items-center gap-3 p-3'>
            <div className='grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-accent-text)]'><MessageSquare size={17} /></div>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm font-medium text-[var(--color-text-primary)]'>{session.title || '未命名会话'}</div>
              <div className='mt-1 truncate text-xs text-[var(--color-text-secondary)]'>{session.runtime} · {session.model || '未指定模型'}</div>
            </div>
            <StatusBadge tone={session.status === 'failed' ? 'danger' : session.status === 'running' ? 'warning' : 'success'}>{session.status}</StatusBadge>
            <div className='flex shrink-0 gap-1'>
              <IconButton icon={GitBranch} label='创建分支' onClick={() => void branch(session)} />
              <IconButton icon={Trash2} label='删除会话' onClick={() => void remove(session)} className='ui-icon-button-danger' />
            </div>
          </article>)}
        </div>
      )}
    </div>
  )
}
