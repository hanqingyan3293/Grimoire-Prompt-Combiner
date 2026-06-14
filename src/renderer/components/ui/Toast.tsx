// 魔导书 Grimoire v7 — Toast 通知组件
import React, { useEffect } from 'react'

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
  duration?: number
}

const colors = {
  success: 'bg-green-600',
  error: 'bg-red-600',
  info: 'bg-blue-600',
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      <div className={`${colors[type]} text-white px-4 py-2 rounded-lg shadow-lg text-sm`}>
        {message}
      </div>
    </div>
  )
}
