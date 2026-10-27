import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../source/src/renderer/pages/browser/BrowserPage', () => ({
  BrowserPage: ({ initialUrl }: { initialUrl: string }) => <span data-testid="browser-entry">{initialUrl}</span>
}))

import CompatBrowserPage, { browserEntryFromSearch } from './CompatBrowserPage'

function setRoute(url?: string) {
  const query = url === undefined ? '' : '?' + new URLSearchParams({ url }).toString()
  window.history.replaceState(null, '', '#/app/browser' + query)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

afterEach(() => { window.history.replaceState(null, '', '#/app/chat') })

describe('browser route adapter', () => {
  it.each([{}, { url: '' }, { url: ' ' }, { url: 'about:blank' }, { url: 123 }])('uses the source blank-entry default for %j', search => {
    expect(browserEntryFromSearch(search)).toBe('about:blank')
  })

  it('passes normalized deep links to the source page and reacts to navigation', () => {
    setRoute('https://example.invalid/one')
    render(<CompatBrowserPage />)
    expect(screen.getByTestId('browser-entry').textContent).toBe('https://example.invalid/one')
    act(() => setRoute('http://127.0.0.1:4321/two'))
    expect(screen.getByTestId('browser-entry').textContent).toBe('http://127.0.0.1:4321/two')
  })

  it.each(['javascript:alert(1)', 'https://user:secret@example.invalid/', 'file://remote/share/page.html', 'file:///C:/private.txt'])('rejects invalid source entry %s', url => {
    expect(() => browserEntryFromSearch({ url })).toThrow()
  })
})
