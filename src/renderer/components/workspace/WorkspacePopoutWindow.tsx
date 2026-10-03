import { Suspense } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { PANEL_DEFINITIONS, renderPanel } from './PanelRegistry'
import type { PanelType } from './panelTypes'

export function WorkspacePopoutWindow({ popoutId, panelType, title }: { popoutId: string; panelType: PanelType; title: string }) {
  const definition = PANEL_DEFINITIONS[panelType]
  return (
    <div className='flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]'>
      <header className='flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3'>
        <div className='min-w-0 truncate text-sm font-semibold'>{title || definition.title}</div>
        <button type='button' className='grid size-7 place-items-center rounded hover:bg-[var(--color-bg-tertiary)]' onClick={() => void window.api.workspace.closePopout(popoutId)} aria-label='关闭弹出面板' title='关闭弹出面板'>
          <X size={15} />
        </button>
      </header>
      <main className='min-h-0 flex-1 overflow-hidden'>
        <Suspense fallback={<div className='flex h-full items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]'><LoaderCircle size={17} className='animate-spin' />正在载入面板</div>}>
          {renderPanel(panelType)}
        </Suspense>
      </main>
    </div>
  )
}
