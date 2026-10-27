import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, GripVertical } from 'lucide-react'
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

type ResizeSide = 'left' | 'right'
type ResizeState = { side: ResizeSide; startX: number; startWidth: number }

const SHELL_LAYOUT_KEY = 'grimoire.agent.shell.layout.v1'

function clampWidth(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function readLayout() {
  if (typeof window === 'undefined') return { left: 280, right: 320, leftCollapsed: false, rightCollapsed: false }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHELL_LAYOUT_KEY) || '{}') as Record<string, unknown>
    return {
      left: typeof parsed.left === 'number' ? clampWidth(parsed.left, 236, 420) : 280,
      right: typeof parsed.right === 'number' ? clampWidth(parsed.right, 260, 460) : 320,
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
    }
  } catch {
    return { left: 280, right: 320, leftCollapsed: false, rightCollapsed: false }
  }
}

export function CherryAgentShell({ header, toolbar, notice, sidebar, center, context, error, compact = false }: { header: ReactNode; toolbar?: ReactNode; notice?: ReactNode; sidebar?: ReactNode; center: ReactNode; context?: ReactNode; error?: ReactNode; compact?: boolean }) {
  const initial = useMemo(readLayout, [])
  const [leftWidth, setLeftWidth] = useState(initial.left)
  const [rightWidth, setRightWidth] = useState(initial.right)
  const [leftCollapsed, setLeftCollapsed] = useState(initial.leftCollapsed)
  const [rightCollapsed, setRightCollapsed] = useState(initial.rightCollapsed)
  const [resize, setResize] = useState<ResizeState | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(SHELL_LAYOUT_KEY, JSON.stringify({ left: leftWidth, right: rightWidth, leftCollapsed, rightCollapsed }))
    } catch { /* localStorage may be disabled in a test or restricted window */ }
  }, [leftWidth, rightWidth, leftCollapsed, rightCollapsed])

  useEffect(() => {
    if (!resize) return
    const move = (event: PointerEvent) => {
      const delta = event.clientX - resize.startX
      if (resize.side === 'left') setLeftWidth(clampWidth(resize.startWidth + delta, 236, 420))
      else setRightWidth(clampWidth(resize.startWidth - delta, 260, 460))
    }
    const end = () => {
      setResize(null)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      end()
    }
  }, [resize])

  const startResize = (side: ResizeSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setResize({ side, startX: event.clientX, startWidth: side === 'left' ? leftWidth : rightWidth })
  }

  const gridTemplateColumns = (leftCollapsed ? '0px' : leftWidth + 'px') + ' minmax(0, 1fr) ' + (rightCollapsed ? '0px' : rightWidth + 'px')
  return <div data-cherry-root="true" className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
    {header}
    {notice}
    {toolbar}
    {compact ? <main className="min-h-0 flex-1 overflow-hidden">{center}</main> : <div className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns }}>
      <aside className={'relative min-h-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-[width,opacity] duration-150 ' + (leftCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100')}>
        <div className="flex h-full min-h-0 flex-col p-3">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--color-text-secondary)]">会话与导航</span>
            <button type="button" className="ui-toolbar-button h-7 w-7 p-0" onClick={() => setLeftCollapsed(true)} aria-label="收起会话侧栏" title="收起会话侧栏"><PanelLeftClose size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{sidebar}</div>
        </div>
        <button type="button" className="absolute inset-y-0 right-[-8px] z-20 w-4 cursor-col-resize bg-transparent" onPointerDown={event => startResize('left', event)} aria-label="调整会话侧栏宽度" title="拖动调整侧栏宽度"><GripVertical className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-[var(--color-border-strong)] opacity-0 transition-opacity hover:opacity-100" /></button>
      </aside>
      <main className="min-h-0 overflow-hidden bg-[var(--color-bg-primary)]">{center}</main>
      <aside className={'relative min-h-0 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-[width,opacity] duration-150 ' + (rightCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100')}>
        <div className="flex h-full min-h-0 flex-col p-3">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--color-text-secondary)]">上下文与工具</span>
            <button type="button" className="ui-toolbar-button h-7 w-7 p-0" onClick={() => setRightCollapsed(true)} aria-label="收起上下文侧栏" title="收起上下文侧栏"><PanelRightClose size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto">{context}</div>
        </div>
        <button type="button" className="absolute inset-y-0 left-[-8px] z-20 w-4 cursor-col-resize bg-transparent" onPointerDown={event => startResize('right', event)} aria-label="调整上下文侧栏宽度" title="拖动调整上下文侧栏宽度"><GripVertical className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-[var(--color-border-strong)] opacity-0 transition-opacity hover:opacity-100" /></button>
      </aside>
      {leftCollapsed && <button type="button" className="absolute left-2 top-2 z-30 grid size-8 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] shadow-lg hover:text-[var(--color-text-primary)]" onClick={() => setLeftCollapsed(false)} aria-label="展开会话侧栏" title="展开会话侧栏"><PanelLeftOpen size={15} /></button>}
      {rightCollapsed && <button type="button" className="absolute right-2 top-2 z-30 grid size-8 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] shadow-lg hover:text-[var(--color-text-primary)]" onClick={() => setRightCollapsed(false)} aria-label="展开上下文侧栏" title="展开上下文侧栏"><PanelRightOpen size={15} /></button>}
    </div>}
    {error}
  </div>
}
