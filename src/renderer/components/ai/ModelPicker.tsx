// ModelPicker.tsx
import React, { useState, useRef, useEffect } from 'react'

interface Props {
  models: string[]
  selected: string
  onSelect: (model: string) => void
  disabled?: boolean
}

export function ModelPicker({ models, selected, onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && triggerRef.current && listRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const listHeight = listRef.current.offsetHeight || 200
      const spaceBelow = window.innerHeight - triggerRect.bottom
      setDropUp(spaceBelow < listHeight + 10)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const positionClass = dropUp
    ? 'bottom-full mb-1'
    : 'top-full mt-1'

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg disabled:opacity-30"
      >
        <span className="max-w-[120px] truncate">{selected || '选择模型'}</span>
        <span className="text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          ref={listRef}
          className={"absolute left-0 z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl w-[200px] max-h-48 overflow-y-auto " + positionClass}
        >
          {models.length === 0 && (
            <div className="px-3 py-4 text-xs text-[var(--color-text-secondary)] text-center">暂无可用模型</div>
          )}
          {models.map(m => (
            <button
              key={m}
              onClick={() => { onSelect(m); setOpen(false) }}
              className={"w-full text-left px-3 py-2 text-xs transition-colors " +
                (m === selected
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium'
                  : 'text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/5')}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
