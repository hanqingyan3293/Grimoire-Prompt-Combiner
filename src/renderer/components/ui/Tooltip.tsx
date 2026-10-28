import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

// Tooltip (M1.5).
//
// The vendored primitive shows a dark bubble with a small arrow, offset clear of the trigger, on hover
// AND focus. Grimoire relied on the native `title` attribute, which is OS-styled, has no arrow, ignores
// the theme, and is invisible to keyboard users until the browser decides to show it.
export interface TooltipProps {
  readonly content: React.ReactNode
  readonly children: React.ReactElement
  readonly side?: 'top' | 'bottom'
  readonly delayMs?: number
}

const OFFSET = 6

export function Tooltip({ content, children, side = 'top', delayMs = 120 }: TooltipProps) {
  const id = useId()
  const anchorRef = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const show = useCallback(() => {
    clear()
    timer.current = setTimeout(() => {
      const element = anchorRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setPosition({
        left: rect.left + rect.width / 2,
        top: side === 'top' ? rect.top - OFFSET : rect.bottom + OFFSET,
      })
    }, delayMs)
  }, [clear, delayMs, side])

  const hide = useCallback(() => { clear(); setPosition(null) }, [clear])

  useEffect(() => () => clear(), [clear])

  const child = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node
      const original = (children as unknown as { ref?: unknown }).ref
      if (typeof original === 'function') (original as (value: HTMLElement | null) => void)(node)
    },
    'aria-describedby': position ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  })

  return (
    <>
      {child}
      {position && (
        <div
          id={id}
          role="tooltip"
          className="ui-tooltip"
          style={{ left: position.left, top: position.top }}
          data-side={side}
        >
          {content}
          <span className="ui-tooltip-arrow" aria-hidden="true" />
        </div>
      )}
    </>
  )
}
