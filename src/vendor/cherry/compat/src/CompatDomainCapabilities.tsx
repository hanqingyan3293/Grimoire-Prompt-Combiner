import { useEffect, useState } from 'react'
import { useCherryHost } from './shims/cherry-host-provider'

/**
 * Domain capability panel.
 *
 * The Host Bridge has always exposed a `domains` map whose entries report, per product
 * domain, whether this window can serve it — `available` with a reason, or `blocked` with
 * the missing service named. Nothing rendered it, so the map was accurate but invisible:
 * a user could not tell whether Cherry Browser/Knowledge/Code/Notes/Translate/Selection
 * were absent by design or simply broken.
 *
 * This reads that map rather than restating it, so the panel cannot drift from the bridge:
 * adding or unblocking a domain changes the display with no edit here.
 */

type DomainStatus = {
  id: string
  state: string
  message: string
  nextAction?: string
}

const DOMAIN_LABELS: Record<string, string> = {
  browser: '浏览器',
  knowledge: '知识库',
  files: '文件',
  code: '代码',
  paintings: '绘画',
  notes: '笔记',
  translate: '翻译',
  selection: '划词助手',
  scheduledTasks: '定时任务',
  skills: '技能'
}

export function CompatDomainCapabilities() {
  const host = useCherryHost()
  const [statuses, setStatuses] = useState<DomainStatus[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const domains = host?.domains as Record<string, { status?: () => Promise<unknown> }> | undefined
    if (!domains) {
      setError('Host Bridge 未提供 domains')
      return
    }
    void Promise.all(
      Object.entries(domains).map(async ([key, domain]) => {
        if (typeof domain?.status !== 'function') return null
        try {
          const value = (await domain.status()) as DomainStatus | null
          if (!value) return null
          return { id: value.id || key, state: value.state, message: value.message, nextAction: value.nextAction }
        } catch (cause) {
          // A status call that throws is itself a fact worth showing, not a reason to
          // blank the panel.
          return { id: key, state: 'error', message: cause instanceof Error ? cause.message : String(cause) }
        }
      })
    ).then(results => {
      if (cancelled) return
      setStatuses(results.filter((entry): entry is DomainStatus => entry !== null))
    })
    return () => { cancelled = true }
  }, [host])

  if (error) return <div role="alert" className="m-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700">{error}</div>
  if (!statuses) return <div className="p-4 text-xs text-muted-foreground">正在读取能力状态…</div>

  // Available first, then blocked — the panel answers "what can I use" before "what is missing".
  const ordered = [...statuses].sort((a, b) => {
    const rank = (state: string) => (state === 'available' ? 0 : 1)
    return rank(a.state) - rank(b.state)
  })
  const blockedCount = ordered.filter(entry => entry.state !== 'available').length

  return (
    <div className="m-4 space-y-3">
      <div className="text-xs text-muted-foreground">
        共 {ordered.length} 个产品域，其中 {blockedCount} 个尚未接入。未接入的域不会渲染成可用界面。
      </div>
      {ordered.map(entry => {
        const available = entry.state === 'available'
        return (
          <div
            key={entry.id}
            className={
              'rounded border p-3 text-xs ' +
              (available
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700')
            }>
            <div className="flex items-center gap-2">
              <span className="font-medium">{DOMAIN_LABELS[entry.id] || entry.id}</span>
              <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px]">{available ? '可用' : '未接入'}</span>
            </div>
            <div className="mt-1 leading-5">{entry.message}</div>
            {entry.nextAction ? <div className="mt-1 text-[11px] opacity-80">{entry.nextAction}</div> : null}
          </div>
        )
      })}
    </div>
  )
}
