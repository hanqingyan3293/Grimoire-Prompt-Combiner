import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useNavigate, useSearch, useRouter } from './tanstack-router'

function setHash(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
afterEach(() => setHash('#/app/chat'))

describe('source settings router contracts', () => {
  it('applies functional query updates to current location without restoring removed keys', async () => {
    setHash('#/settings/provider?id=first&focusId=provider-api')
    const { result } = renderHook(() => ({ navigate: useNavigate(), search: useSearch() }))
    await act(async () => result.current.navigate({ to: '/settings/provider', search: previous => { const next = { ...previous }; delete next.id; return next }, replace: true }))
    await act(async () => result.current.navigate({ to: '/settings/provider', search: previous => { const next = { ...previous }; delete next.focusId; return next }, replace: true }))
    expect(window.location.hash).toBe('#/settings/provider')
    expect(result.current.search).toEqual({})
  })

  it('validates source search query bytes and preserves normal search', () => {
    setHash('#/settings/search?' + new URLSearchParams({ q: '模型' }))
    const { result } = renderHook(() => useSearch<{ q?: string }>({ from: '/settings/search' }))
    expect(result.current.q).toBe('模型')
    act(() => setHash('#/settings/search?' + new URLSearchParams({ q: '中'.repeat(10000) })))
    expect(result.current.q).toBeUndefined()
  })

  it('uses actual history navigation for the source search Escape journey', async () => {
    setHash('#/settings/provider')
    const { result } = renderHook(() => ({ navigate: useNavigate(), router: useRouter() }))
    await act(async () => result.current.navigate({ to: '/settings/search', search: { q: '外观' } }))
    await waitFor(() => expect(window.location.hash).toContain('/settings/search'))
    expect(result.current.router.history.canGoBack()).toBe(true)
    act(() => result.current.router.history.back())
    await waitFor(() => expect(window.location.hash).toBe('#/settings/provider'))
  })
})
