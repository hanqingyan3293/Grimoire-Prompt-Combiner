import React from 'react'
import { Tooltip } from './Tooltip'
import type { LucideIcon } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, className = '', children, ...props }: ButtonProps) {
  return <button {...props} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`}>
    {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden='true' />}
    {children}
  </button>
}

interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  icon: LucideIcon
  label: string
}

// Icon buttons carry their meaning only in the icon, so the hint must work for keyboard users too:
// a themed tooltip on hover AND focus instead of the OS-styled `title` attribute.
export function IconButton({ icon: Icon, label, className = '', ...props }: IconButtonProps) {
  return (
    <Tooltip content={String(props.title || label)}>
      <button {...props} aria-label={label} className={`ui-icon-button ${className}`}><Icon size={16} aria-hidden='true' /></button>
    </Tooltip>
  )
}
