// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(() => cleanup())

describe('Tooltip (M1.5)', () => {
  it('shows a themed bubble on hover and hides it on leave', async () => {
    vi.useFakeTimers()
    render(<Tooltip content='刷新状态'><button type='button'>刷新</button></Tooltip>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('button', { name: '刷新' }))
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('tooltip')).toHaveProperty('textContent')
    expect(screen.getByRole('tooltip').textContent).toContain('刷新状态')
    fireEvent.mouseLeave(screen.getByRole('button', { name: '刷新' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('exposes the bubble to keyboard users through focus, with aria-describedby', () => {
    vi.useFakeTimers()
    render(<Tooltip content='删除素材'><button type='button'>删除</button></Tooltip>)
    const button = screen.getByRole('button', { name: '删除' })
    fireEvent.focus(button)
    act(() => { vi.advanceTimersByTime(200) })
    const bubble = screen.getByRole('tooltip')
    expect(button.getAttribute('aria-describedby')).toBe(bubble.id)
    fireEvent.blur(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })
})
