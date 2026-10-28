// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectionAssistantView } from './SelectionAssistantView'

const current = vi.fn()
const apply = vi.fn()
const close = vi.fn()

beforeEach(() => {
  current.mockResolvedValue({ text: '1girl, smile', actions: ['copy-as-tags'] })
  apply.mockResolvedValue({ ok: true, outcome: { kind: 'clipboard', text: '1girl, smile' } })
  close.mockResolvedValue(true)
  // Only the surface under test is provided: casting through `unknown` keeps the partial stub honest
  // without pretending this test owns the other 37 API members.
  ;(window as unknown as { api: { selection: unknown } }).api = { selection: { current, apply, close } }
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('SelectionAssistantView (M3 popup)', () => {
  it('shows the captured selection that the main process handed over', async () => {
    render(<SelectionAssistantView />)
    await waitFor(() => expect(screen.getByText(/1girl, smile/)).toBeTruthy())
    expect(current).toHaveBeenCalledTimes(1)
  })

  it('applies the chosen action through IPC', async () => {
    render(<SelectionAssistantView />)
    const button = await screen.findByRole('button', { name: /复制为标签语法/ })
    fireEvent.click(button)
    await waitFor(() => expect(apply).toHaveBeenCalledWith('copy-as-tags'))
  })

  it('reports an empty selection instead of pretending the action worked', async () => {
    current.mockResolvedValue({ text: '', actions: [] })
    apply.mockResolvedValue({ ok: false, error: 'EMPTY_SELECTION' })
    render(<SelectionAssistantView />)
    const button = await screen.findByRole('button', { name: /复制为单行/ })
    // Disabled while there is no captured text: the button must not look actionable.
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes through IPC when the close button is used', async () => {
    render(<SelectionAssistantView />)
    fireEvent.click(await screen.findByRole('button', { name: '关闭' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
  })
})
