import React from 'react'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning'
}

export function Badge({ tone = 'neutral', children, className = '', ...props }: BadgeProps) {
  return <span {...props} className={`ui-badge ui-badge-${tone} ${className}`}>{children}</span>
}
