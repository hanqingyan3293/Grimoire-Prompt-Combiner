import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, RotateCw } from 'lucide-react'
import { Button } from '../ui/Button'

// Embedded browser panel (M3).
//
// The page itself is a WebContentsView owned by the main process; this component only reserves a
// rectangle and keeps the main process informed when that rectangle moves. Everything visible here is
// chrome (address bar, history) — never a fake rendering of the page.
type Visit = { id: number; url: string; title: string; visitedAt: string }

type BrowserApi = {
  request: (route: string, input?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>
}

export function BrowserPanel({ panelId = 'browser-panel' }: { panelId?: string }) {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const openedRef = useRef(false)
  const [address, setAddress] = useState('https://example.com')
  const [current, setCurrent] = useState('')
  const [visits, setVisits] = useState<Visit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const api = useMemo(() => (typeof window !== 'undefined' ? (window as unknown as { api?: { ipcApi?: BrowserApi } }).api?.ipcApi : undefined), [])

  const bounds = useCallback(() => {
    const element = slotRef.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (rect.width < 80 || rect.height < 60) return null
    // The view is positioned in window coordinates, and the panel body may be scrolled, so the top-left
    // is taken from the live rect rather than from layout constants.
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
  }, [])

  const sync = useCallback(async (route: 'open' | 'bounds', url?: string) => {
    if (!api) return
    const rect = bounds()
    if (!rect) return
    const result = await api.request('browser.host.' + route, route === 'open' ? { id: panelId, url: url ?? address, bounds: rect } : { id: panelId, bounds: rect })
    if (!result?.ok) setError(result?.error?.message ?? 'browser host unavailable')
  }, [address, api, bounds, panelId])

  useEffect(() => {
    if (!api) return
    void sync('open')
    openedRef.current = true
    return () => { void api.request('browser.host.close', { id: panelId }) }
  }, [api, panelId, sync])

  useEffect(() => {
    const element = slotRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      // Coalesce to one update per frame: a splitter drag fires constantly and each call crosses IPC.
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; void sync('bounds') })
    })
    observer.observe(element)
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [sync])

  const navigate = async (target?: string) => {
    if (!api) return
    setBusy(true); setError(null)
    try {
      const result = await api.request('browser.host.navigate', { id: panelId, url: target ?? address })
      if (!result?.ok) { setError(result?.error?.message ?? 'navigate failed'); return }
      setCurrent(String((result.data as { url?: string })?.url ?? ''))
      const history = await api.request('browser.history.list', { limit: 20 })
      if (history?.ok) setVisits((history.data as Visit[]) ?? [])
    } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-ui="browser.panel">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-2 py-1.5">
        <Globe size={14} className="text-[var(--color-text-secondary)]" />
        <input value={address} onChange={event => setAddress(event.target.value)} aria-label="地址"
          onKeyDown={event => { if (event.key === 'Enter') void navigate() }}
          className="ui-field min-w-0 flex-1 px-2 py-1 text-xs" />
        <Button size="sm" variant="secondary" onClick={() => void navigate()} disabled={busy}>打开</Button>
        <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => void navigate(current || address)} disabled={busy} aria-label="刷新" />
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => void navigate()} disabled={busy} aria-label="后退" />
        <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => void navigate(current || address)} disabled={busy} aria-label="前进" />
      </div>
      {/* The reserved rectangle: the WebContentsView is positioned exactly here by the main process. */}
      <div ref={slotRef} className="min-h-0 flex-1 bg-[var(--color-bg-secondary)]" aria-label="网页区域" />
      {visits.length > 0 && (
        <div className="max-h-24 shrink-0 overflow-auto border-t border-[var(--color-border)] p-1 text-[11px] text-[var(--color-text-secondary)]">
          {visits.slice(0, 6).map(visit => (
            <button key={visit.id} type="button" onClick={() => { setAddress(visit.url); void navigate(visit.url) }} className="block w-full truncate text-left hover:text-[var(--color-text-primary)]">
              {visit.title || visit.url}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="px-2 py-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}
