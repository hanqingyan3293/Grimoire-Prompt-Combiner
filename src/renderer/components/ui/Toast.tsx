// 魔导书 Grimoire v7 — Toast 通知组件
import React, { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
  duration?: number
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info }

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  const Icon = icons[type]
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 animate-slide-up" role="status" aria-live="polite">
      <div className={`ui-toast ui-toast-${type}`}><Icon size={17} aria-hidden='true' />{message}</div>
    </div>
  )
}
