// 魔导书 Grimoire v7 — 通用 Modal 组件
import React, { ReactNode } from "react"

interface ModalProps {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}

export function Modal({ title, open, onClose, children, maxWidth = "max-w-lg" }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded w-full ${maxWidth} mx-4 shadow-2xl max-h-[85vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h3>
          <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 overflow-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
