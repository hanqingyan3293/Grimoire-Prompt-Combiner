import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export function FloatingPreview({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const [rect, setRect] = useState({ left: 80, top: 60, width: 760, height: 560 })
  const action = useRef<{ mode: 'drag' | 'resize'; edge?: Edge; x: number; y: number; rect: typeof rect } | null>(null)
  useEffect(() => {
    if (!open) return
    const move = (event: PointerEvent) => {
      const current = action.current
      if (!current) return
      const dx = event.clientX - current.x; const dy = event.clientY - current.y
      if (current.mode === 'drag') setRect({ ...current.rect, left: Math.max(8, current.rect.left + dx), top: Math.max(8, current.rect.top + dy) })
      else {
        const edge = current.edge!; let { left, top, width, height } = current.rect
        if (edge.includes('e')) width = Math.max(320, current.rect.width + dx)
        if (edge.includes('s')) height = Math.max(220, current.rect.height + dy)
        if (edge.includes('w')) { width = Math.max(320, current.rect.width - dx); left = current.rect.left + current.rect.width - width }
        if (edge.includes('n')) { height = Math.max(220, current.rect.height - dy); top = current.rect.top + current.rect.height - height }
        setRect({ left: Math.max(8, left), top: Math.max(8, top), width, height })
      }
    }
    const up = () => { action.current = null; document.body.style.userSelect = '' }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [open])
  if (!open) return null
  const drag = (event: React.PointerEvent) => { event.preventDefault(); action.current = { mode: 'drag', x: event.clientX, y: event.clientY, rect }; document.body.style.userSelect = 'none' }
  const resize = (edge: Edge, event: React.PointerEvent) => { event.preventDefault(); event.stopPropagation(); action.current = { mode: 'resize', edge, x: event.clientX, y: event.clientY, rect }; document.body.style.userSelect = 'none' }
  return <div className='fixed inset-0 z-[1200] bg-black/50 backdrop-blur-[2px]' onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className='absolute flex flex-col overflow-visible rounded-2xl border-2 border-stone-400 bg-[var(--color-bg-primary)] shadow-[0_24px_80px_rgba(0,0,0,.45)] dark:border-stone-600' style={rect}>
      <header onPointerDown={drag} className='flex h-12 shrink-0 cursor-move items-center justify-between border-b-2 border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] px-4 font-semibold'><span className='truncate'>{title}</span><button type='button' onPointerDown={e => e.stopPropagation()} onClick={onClose} className='grid size-8 place-items-center rounded-lg hover:bg-black/10 dark:hover:bg-white/10'><X size={18} /></button></header>
      <div className='min-h-0 flex-1 overflow-auto p-4'>{children}</div>{footer ? <footer className='shrink-0 border-t-2 border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] p-3'>{footer}</footer> : null}
      {(['n','s','e','w','ne','nw','se','sw'] as Edge[]).map(edge => <span key={edge} onPointerDown={event => resize(edge, event)} className={`absolute z-10 ${edge.includes('n') ? 'top-[-6px]' : edge.includes('s') ? 'bottom-[-6px]' : 'top-2 bottom-2'} ${edge.includes('e') ? 'right-[-6px]' : edge.includes('w') ? 'left-[-6px]' : 'left-2 right-2'} ${edge.length === 2 ? 'size-4' : edge === 'n' || edge === 's' ? 'h-3' : 'w-3'} cursor-${edge}-resize`} />)}
    </section>
  </div>
}
