import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const VIEWPORT_GUTTER = 16
const MIN_WIDTH = 240
const MIN_HEIGHT = 180

function fitRect(rect: { left: number; top: number; width: number; height: number }) {
  const maxWidth = Math.max(1, window.innerWidth - VIEWPORT_GUTTER * 2)
  const maxHeight = Math.max(1, window.innerHeight - VIEWPORT_GUTTER * 2)
  const width = Math.min(rect.width, maxWidth)
  const height = Math.min(rect.height, maxHeight)
  return {
    width,
    height,
    left: Math.max(VIEWPORT_GUTTER, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GUTTER)),
    top: Math.max(VIEWPORT_GUTTER, Math.min(rect.top, window.innerHeight - height - VIEWPORT_GUTTER)),
  }
}

export function FloatingPreview({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const [rect, setRect] = useState({ left: 80, top: 60, width: 760, height: 560 })
  const action = useRef<{ mode: 'drag' | 'resize'; edge?: Edge; x: number; y: number; rect: typeof rect } | null>(null)
  useEffect(() => {
    if (!open) return
    const fitToViewport = () => setRect(current => fitRect(current))
    fitToViewport()
    const move = (event: PointerEvent) => {
      const current = action.current
      if (!current) return
      const dx = event.clientX - current.x; const dy = event.clientY - current.y
      if (current.mode === 'drag') {
        setRect(fitRect({ ...current.rect, left: current.rect.left + dx, top: current.rect.top + dy }))
        return
      }
      else {
        const edge = current.edge!; let { left, top, width, height } = current.rect
        if (edge.includes('e')) width = Math.max(MIN_WIDTH, current.rect.width + dx)
        if (edge.includes('s')) height = Math.max(MIN_HEIGHT, current.rect.height + dy)
        if (edge.includes('w')) { width = Math.max(MIN_WIDTH, current.rect.width - dx); left = current.rect.left + current.rect.width - width }
        if (edge.includes('n')) { height = Math.max(MIN_HEIGHT, current.rect.height - dy); top = current.rect.top + current.rect.height - height }
        setRect(fitRect({ left, top, width, height }))
      }
    }
    const up = () => { action.current = null; document.body.style.userSelect = '' }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    window.addEventListener('blur', up); window.addEventListener('resize', fitToViewport)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up); window.removeEventListener('resize', fitToViewport); up() }
  }, [open])
  if (!open) return null
  const drag = (event: React.PointerEvent) => { event.preventDefault(); action.current = { mode: 'drag', x: event.clientX, y: event.clientY, rect }; document.body.style.userSelect = 'none' }
  const resize = (edge: Edge, event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); action.current = { mode: 'resize', edge, x: event.clientX, y: event.clientY, rect }; document.body.style.userSelect = 'none' }
  return <div className='fixed inset-0 z-[1200] pointer-events-auto bg-black/50 p-3 backdrop-blur-[2px]' onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role='dialog' aria-label={title} className='absolute flex min-h-0 min-w-0 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] flex-col overflow-visible rounded-xl bg-[var(--color-bg-primary)] shadow-[0_24px_80px_rgba(0,0,0,.45)] outline-none' style={rect}>
      <header onPointerDown={drag} className='relative z-10 flex h-12 shrink-0 cursor-move items-center justify-between rounded-t-xl border-b border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] bg-[var(--color-bg-secondary)] px-5 font-semibold'><span className='truncate'>{title}</span><button type='button' onPointerDown={e => e.stopPropagation()} onClick={onClose} className='grid size-8 place-items-center rounded-lg outline-none hover:bg-black/10 focus:outline-none dark:hover:bg-white/10'><X size={18} /></button></header>
      <div className='preview-body relative z-0 flex min-h-0 min-w-0 flex-1 overflow-auto p-5'><div className='preview-body-inner h-full min-h-full min-w-0 flex-1'>{children}</div></div>{footer ? <footer className='relative z-10 shrink-0 rounded-b-xl border-t border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] bg-[var(--color-bg-secondary)] px-5 py-3'>{footer}</footer> : null}
      {(['n','s','e','w','ne','nw','se','sw'] as Edge[]).map(edge => <button key={edge} type="button" aria-label={`调整预览窗口${edge}大小`} onPointerDown={event => resize(edge, event)} className={`group absolute z-[100] block touch-none border-0 bg-transparent p-0 opacity-0 hover:opacity-100 focus-visible:opacity-100 ${edge === 'n' ? 'left-3 right-3 top-[-8px] h-4 cursor-n-resize' : edge === 's' ? 'bottom-[-8px] left-3 right-3 h-4 cursor-s-resize' : edge === 'e' ? 'bottom-3 right-[-8px] top-3 w-4 cursor-e-resize' : edge === 'w' ? 'bottom-3 left-[-8px] top-3 w-4 cursor-w-resize' : edge === 'ne' ? 'right-[-8px] top-[-8px] size-5 cursor-ne-resize' : edge === 'nw' ? 'left-[-8px] top-[-8px] size-5 cursor-nw-resize' : edge === 'se' ? 'bottom-[-8px] right-[-8px] size-5 cursor-se-resize' : 'bottom-[-8px] left-[-8px] size-5 cursor-sw-resize'}`}><span className="pointer-events-none absolute inset-1 rounded-md border border-[var(--color-accent)]/45 bg-[var(--color-accent)]/10" /></button>)}
    </section>
  </div>
}
