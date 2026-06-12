import React from 'react'

interface ToastProps {
  message: string
  type: string
}

const Toast: React.FC<ToastProps> = ({ message, type }) => {
  const bgColor = type === 'success' ? 'var(--color-success)'
    : type === 'error' ? 'var(--color-danger)'
    : 'var(--color-accent)'

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-bounce"
      style={{
        backgroundColor: bgColor,
        color: 'white',
        boxShadow: 'var(--shadow-lg)'
      }}
    >
      {message}
    </div>
  )
}

export default Toast
