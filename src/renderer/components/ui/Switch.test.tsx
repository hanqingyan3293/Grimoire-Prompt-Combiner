// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Switch } from './Switch'

afterEach(() => cleanup())

describe('Switch baseline (M1.5.6)', () => {
  it('exposes role=switch and reports the new value on click', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label='开机自启' />)
    const control = screen.getByRole('switch', { name: '开机自启' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('reflects the checked state in the class contract and ignores clicks when disabled', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(<Switch checked onCheckedChange={onCheckedChange} aria-label='防休眠' />)
    expect(screen.getByRole('switch').className).toContain('ui-switch-on')
    rerender(<Switch checked disabled onCheckedChange={onCheckedChange} aria-label='防休眠' />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
