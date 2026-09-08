import React, { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'

const STORAGE_KEY = 'grimoire.resource-card-groups'

type CollapseState = Record<string, boolean>

function readState(): CollapseState {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as CollapseState } catch { return {} }
}

export function ResourceGroup({ id, title, count, children, empty = false, forceOpen = false }: { id: string; title: string; count?: number; children: React.ReactNode; empty?: boolean; forceOpen?: boolean }) {
  const [collapsed, setCollapsed] = useState(() => readState()[id] ?? false)
  useEffect(() => {
    const state = readState()
    state[id] = collapsed
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [collapsed, id])
  const isCollapsed = forceOpen ? false : collapsed
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setCollapsed(value => !value)} className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-xs font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]" aria-expanded={!isCollapsed}>
        <ChevronRight size={14} className={`shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {typeof count === 'number' && <span className="ui-count-badge">{count}</span>}
      </button>
      {!isCollapsed && !empty && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>}
      {!isCollapsed && empty && <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-5 text-center text-xs text-[var(--color-text-secondary)]">暂无内容</div>}
    </section>
  )
}

export function ResourceCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <article className={`ui-list-card min-w-0 overflow-hidden rounded-xl p-3 ${className}`}>{children}</article>
}
