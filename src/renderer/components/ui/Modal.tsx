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
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[1px]" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} mx-4 max-h-[85vh] flex flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] shadow-[0_18px_60px_rgba(0,0,0,0.48),0_0_0_1px_rgba(255,255,255,0.035)]`}
        onClick={e => e.stopPropagation()}>
        <div className="flex min-h-12 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-5 py-3">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-xl leading-none text-[var(--color-text-secondary)] hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-400"
            title="关闭"
          >
            &times;
          </button>
        </div>
        <div className="p-5 overflow-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
