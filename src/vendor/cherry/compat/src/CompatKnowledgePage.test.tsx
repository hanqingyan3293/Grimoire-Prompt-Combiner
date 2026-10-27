import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../source/src/renderer/pages/knowledge/KnowledgePage', () => ({
  default: ({ baseId, onBaseIdChange }: { baseId?: string; onBaseIdChange: (id?: string) => void }) => (
    <div>
      <span data-testid="selected-base">{baseId || 'none'}</span>
      <button onClick={() => onBaseIdChange('base/二')}>select base</button>
      <button onClick={() => onBaseIdChange()}>clear base</button>
    </div>
  )
}))

import CompatKnowledgePage from './CompatKnowledgePage'

function setRoute(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

afterEach(() => { setRoute('#/app/chat') })

describe('knowledge route adapter', () => {
  it('passes the deep-linked base through the source search parser', () => {
    setRoute('#/app/knowledge?baseId=base-1')
    render(<CompatKnowledgePage />)
    expect(screen.getByTestId('selected-base').textContent).toBe('base-1')
  })

  it('replaces the route on selection and clearing without adding history entries', async () => {
    setRoute('#/app/knowledge?baseId=base-1&unrelated=old')
    const historyLength = window.history.length
    render(<CompatKnowledgePage />)
    fireEvent.click(screen.getByText('select base'))
    await waitFor(() => expect(screen.getByTestId('selected-base').textContent).toBe('base/二'))
    expect(new URLSearchParams(window.location.hash.split('?')[1]).get('baseId')).toBe('base/二')
    expect(window.history.length).toBe(historyLength)
    fireEvent.click(screen.getByText('clear base'))
    await waitFor(() => expect(screen.getByTestId('selected-base').textContent).toBe('none'))
    expect(window.location.hash).toBe('#/app/knowledge')
    expect(window.history.length).toBe(historyLength)
  })

  it('treats an empty baseId as unset', () => {
    setRoute('#/app/knowledge?baseId=')
    render(<CompatKnowledgePage />)
    expect(screen.getByTestId('selected-base').textContent).toBe('none')
  })
})
