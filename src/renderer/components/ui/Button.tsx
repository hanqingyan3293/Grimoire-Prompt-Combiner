import React from 'react'
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

export function IconButton({ icon: Icon, label, className = '', ...props }: IconButtonProps) {
  return <button {...props} aria-label={label} title={props.title || label} className={`ui-icon-button ${className}`}><Icon size={16} aria-hidden='true' /></button>
}
