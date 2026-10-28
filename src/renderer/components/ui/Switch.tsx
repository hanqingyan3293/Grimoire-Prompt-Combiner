import React from 'react'

// Switch baseline (M1.5.6).
//
// The vendored `Switch` is a Radix track+thumb: 32x18 track, 14px thumb, accent fill when checked,
// and a real `role="switch"` for assistive tech. Grimoire used bare <input type="checkbox">, which
// looks like a form control rather than a setting and announces itself as a checkbox.
type SwitchSize = 'sm' | 'md'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  size?: SwitchSize
  'aria-label'?: string
  'aria-labelledby'?: string
  title?: string
}

export function Switch({ checked, onCheckedChange, disabled = false, size = 'md', title, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={'ui-switch ' + (size === 'sm' ? 'ui-switch-sm' : '') + (checked ? ' ui-switch-on' : '')}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  )
}
