import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from './Badge'

type StatusTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

export function PanelHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className='ui-content-header'>
      <div className='min-w-0'>
        <div className='flex items-center gap-2'>
          {Icon && <Icon size={17} className='shrink-0 text-[var(--color-accent-text)]' aria-hidden='true' />}
          <h2 className='truncate text-sm font-semibold text-[var(--color-text-primary)]'>{title}</h2>
        </div>
        {description && <p className='mt-1 text-xs leading-5 text-[var(--color-text-secondary)]'>{description}</p>}
      </div>
      {actions && <div className='flex shrink-0 items-center gap-2'>{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className='ui-empty-state flex-col gap-2 px-5 py-6 text-center'>
      <span className='ui-empty-state-icon'><Icon size={19} aria-hidden='true' /></span>
      <div>
        <div className='text-sm font-medium text-[var(--color-text-primary)]'>{title}</div>
        {description && <p className='mt-1 text-xs leading-5 text-[var(--color-text-secondary)]'>{description}</p>}
      </div>
      {action && <div className='mt-1'>{action}</div>}
    </div>
  )
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: React.ReactNode }) {
  return <Badge tone={tone} className='ui-status-badge'><span className='ui-status-dot' aria-hidden='true' />{children}</Badge>
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className='ui-progress' role='progressbar' aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className='ui-progress-fill' style={{ width: `${percent}%` }} />
    </div>
  )
}
