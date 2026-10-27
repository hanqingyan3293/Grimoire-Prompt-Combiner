import type { ElementType } from 'react'
import { Bot } from 'lucide-react'

export type CherryConversationMode = { id: string; label: string; icon: ElementType }

export function CherryConversationHeader({ title, subtitle, mode, modes, runtime, model, onModeChange }: { title: string; subtitle: string; mode: string; modes: CherryConversationMode[]; runtime: string; model: string; onModeChange: (mode: string) => void }) {
  return <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-2 shadow-sm">
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]"><Bot size={17} /></div>
      <div className="min-w-0"><div className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</div><div className="truncate text-[10px] text-[var(--color-text-secondary)]">{subtitle}</div></div>
    </div>
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Agent 模式">
      {modes.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => onModeChange(item.id)} aria-current={mode === item.id ? 'page' : undefined} className={'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ' + (mode === item.id ? 'bg-[var(--color-accent)]/15 font-medium text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]')}><Icon size={14} />{item.label}</button> })}
    </nav>
    <div className="hidden shrink-0 items-center gap-2 text-[10px] text-[var(--color-text-secondary)] xl:flex"><span className="rounded-md border border-[var(--color-border)] px-2 py-1">{runtime}</span><span className="max-w-32 truncate" title={model}>{model || '未选择模型'}</span></div>
  </header>
}
