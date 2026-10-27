import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 12

export interface HoverPreviewProps {
  preview: React.ReactNode
  children: React.ReactNode
  delayMs?: number
  hideDelayMs?: number
  className?: string
}

export function HoverPreview({ preview, children, delayMs = 500, hideDelayMs = 80, className = '' }: HoverPreviewProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) { clearTimeout(showTimerRef.current); showTimerRef.current = null }
  }, [])

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }, [])

  const hide = useCallback(() => {
    clearShowTimer()
    clearHideTimer()
    setOpen(false)
    setPosition(null)
  }, [clearShowTimer, clearHideTimer])

  useEffect(() => {
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      hide()
    }
  }, [hide])

  // 浮层尺寸实测前（如 jsdom 或首个渲染帧）按 0 处理，只做基准定位，实测后翻转与钳制
  const place = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = surfaceRef.current?.offsetWidth ?? 0
    const height = surfaceRef.current?.offsetHeight ?? 0
    let left = rect.right + ANCHOR_GAP
    if (width > 0 && left + width > window.innerWidth - VIEWPORT_MARGIN) left = rect.left - width - ANCHOR_GAP
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)))
    let top = Math.max(VIEWPORT_MARGIN, rect.top)
    if (height > 0 && top + height > window.innerHeight - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
    setPosition({ left, top })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  const handleEnter = () => {
    clearHideTimer()
    if (open || showTimerRef.current !== null) return
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      setPosition({ left: Math.max(VIEWPORT_MARGIN, rect.right + ANCHOR_GAP), top: Math.max(VIEWPORT_MARGIN, rect.top) })
      setOpen(true)
    }, delayMs)
  }

  const handleLeave = () => {
    if (showTimerRef.current !== null) { clearShowTimer(); return }
    if (hideTimerRef.current !== null) return
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setOpen(false)
      setPosition(null)
    }, hideDelayMs)
  }

  return <>
    <div ref={anchorRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>{children}</div>
    {open && position && createPortal(
      <div
        ref={surfaceRef}
        data-hover-preview=''
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className={`fixed z-50 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-xl ${className}`}
        style={{ left: position.left, top: position.top }}
      >
        {preview}
      </div>,
      document.body,
    )}
  </>
}