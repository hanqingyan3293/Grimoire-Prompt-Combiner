import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CompatSettingsActionBoundary } from './CompatSettingsActionBoundary'

// Native-fieldset fixtures only, NOT source-presentation/parity evidence. The
// family tests separately import the real pages, UI and rejected query hooks.
function Boundary({ children }: { children: ReactNode }) {
  return (
    <>
      <p id="boundary-note">In-page form actions are unavailable; sidebar navigation remains.</p>
      <CompatSettingsActionBoundary label="source family" describedBy="boundary-note">
        {children}
      </CompatSettingsActionBoundary>
    </>
  )
}

describe('React-rendered native skill/task fieldset boundary', () => {
  it('disables in-page form actions without rewriting the source controls own properties or attributes', async () => {
    const action = vi.fn()
    render(
      <Boundary>
        <button type="button" onClick={action}>source action</button>
        <button type="button" role="switch" aria-checked="false" onClick={action}>source status</button>
        <button type="button" role="tab" onClick={action}>source scope</button>
        <button type="button" onClick={action}>source retry</button>
        <button type="button" onClick={action}>source back</button>
        <input aria-label="source search" defaultValue="" onChange={action} />
      </Boundary>
    )
    const fieldset = screen.getByRole('group', { name: 'source family' })
    expect(fieldset).toBeDisabled()
    expect(fieldset).toHaveAttribute('aria-describedby', 'boundary-note')
    const sourceButton = within(fieldset).getByRole('button', { name: 'source action' }) as HTMLButtonElement
    // Native inherited disability, not a fabricated button.disabled attribute.
    expect(sourceButton.disabled).toBe(false)
    expect(sourceButton).not.toHaveAttribute('disabled')
    const user = userEvent.setup()
    for (const control of [
      sourceButton,
      screen.getByRole('switch', { name: 'source status' }),
      screen.getByRole('tab', { name: 'source scope' }),
      screen.getByRole('button', { name: 'source retry' }),
      screen.getByRole('button', { name: 'source back' })
    ]) {
      expect(control).toBeDisabled()
      await user.click(control)
    }
    const search = screen.getByRole('textbox', { name: 'source search' })
    expect(search).toBeDisabled()
    await user.type(search, 'find')
    expect(search).toHaveValue('')
    expect(action).not.toHaveBeenCalled()
  })

  it('applies native inheritance immediately to controls rendered after source loading resolves', () => {
    const view = render(<Boundary><p role="status">source loading</p></Boundary>)
    const fieldset = screen.getByRole('group', { name: 'source family' })
    expect(fieldset).toBeDisabled()
    view.rerender(<Boundary><button type="button">new source action</button></Boundary>)
    const button = within(fieldset).getByRole('button', { name: 'new source action' }) as HTMLButtonElement
    expect(button).toBeDisabled()
    expect(button.disabled).toBe(false)
    expect(button).not.toHaveAttribute('disabled')
  })

  it('leaves source React disabled-prop updates intact instead of overriding their DOM state', () => {
    const view = render(<Boundary><button type="button" disabled>source control</button></Boundary>)
    const button = screen.getByRole('button', { name: 'source control' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    view.rerender(<Boundary><button type="button" disabled={false}>source control</button></Boundary>)
    expect(button.disabled).toBe(false)
    expect(button).not.toHaveAttribute('disabled')
    expect(button).toBeDisabled()
    expect(screen.getByRole('group', { name: 'source family' })).toBeDisabled()
  })

  it('preserves safe anchors and the sidebar outside the disabled native boundary', async () => {
    const anchorAction = vi.fn()
    const sidebarAction = vi.fn()
    render(
      <>
        <Boundary>
          <a href="#/settings/skills" onClick={event => { event.preventDefault(); anchorAction() }}>safe source detail link</a>
        </Boundary>
        <button type="button" onClick={sidebarAction}>settings sidebar</button>
      </>
    )
    const anchor = screen.getByRole('link', { name: 'safe source detail link' })
    const sidebar = screen.getByRole('button', { name: 'settings sidebar' })
    expect(anchor).not.toBeDisabled()
    expect(sidebar).not.toBeDisabled()
    // user-event's disabled-ancestor check also suppresses anchors under a
    // fieldset. Exercise the unchanged React anchor handler with a synthetic
    // click; actual browser pointer/CSS acceptance remains the parent's audit.
    // No disabled attribute or other element state is changed for this test.
    fireEvent.click(anchor)
    await userEvent.setup().click(sidebar)
    expect(anchorAction).toHaveBeenCalledOnce()
    expect(sidebarAction).toHaveBeenCalledOnce()
  })
})
