// 魔导书 Grimoire v7 — 通用 Modal 组件
import React, { ReactNode, useEffect, useRef } from "react"
import { X } from 'lucide-react'
import { IconButton } from './Button'

interface ModalProps {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}

export function Modal({ title, open, onClose, children, maxWidth = "max-w-lg" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-dialog-overlay absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} tabIndex={-1} className={`ui-dialog-surface relative flex max-h-[calc(100vh-24px)] w-full ${maxWidth} min-w-0 flex-col overflow-hidden outline-none`}
        onClick={e => e.stopPropagation()}>
        <div className="flex min-h-12 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-5 py-3">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
          <IconButton onClick={onClose} icon={X} label="关闭" className="ui-icon-button-danger" />
        </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
          {children}
        </div>
      </div>
    </div>
  )
}
