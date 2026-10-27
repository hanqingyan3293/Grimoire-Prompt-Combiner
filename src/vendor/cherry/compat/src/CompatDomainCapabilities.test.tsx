import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CherryHostProvider } from './shims/cherry-host-provider'
import { CompatDomainCapabilities } from './CompatDomainCapabilities'

/**
 * The panel must report what the bridge says, not a list of its own. These drive it with
 * a fake bridge so the assertions are about the panel's behaviour rather than about
 * whichever domains happen to be blocked today.
 */
function renderWithDomains(domains: Record<string, unknown>) {
  return render(
    <CherryHostProvider bridge={{ domains } as never}>
      <CompatDomainCapabilities />
    </CherryHostProvider>
  )
}

const available = (id: string) => ({ status: async () => ({ id, state: 'available', message: id + ' ok' }) })
const blocked = (id: string) => ({
  status: async () => ({ id, state: 'blocked', message: id + ' missing', nextAction: '接入后解除阻塞。' })
})

describe('CompatDomainCapabilities', () => {
  it('reports each domain from the bridge, with the counts', async () => {
    renderWithDomains({ files: available('files'), browser: blocked('browser') })
    await waitFor(() => expect(screen.getByText('文件')).toBeTruthy())
    expect(screen.getByText('浏览器')).toBeTruthy()
    expect(screen.getByText('可用')).toBeTruthy()
    expect(screen.getByText('未接入')).toBeTruthy()
    // The next-action line is shown only for a blocked domain.
    expect(screen.getByText('接入后解除阻塞。')).toBeTruthy()
    expect(screen.getByText(/共 2 个产品域，其中 1 个尚未接入/)).toBeTruthy()
  })

  it('lists available domains before blocked ones', async () => {
    // Declared blocked-first so ordering cannot pass by insertion accident.
    renderWithDomains({ zeta: blocked('zeta'), alpha: available('alpha') })
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy())
    const text = document.body.textContent || ''
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'))
  })

  it('surfaces a status call that throws rather than blanking the panel', async () => {
    renderWithDomains({
      files: available('files'),
      broken: { status: async () => { throw new Error('bridge exploded') } }
    })
    await waitFor(() => expect(screen.getByText('文件')).toBeTruthy())
    // The failure is shown as its own entry — a domain whose status cannot be read is a
    // fact worth reporting, not a reason to render nothing.
    expect(screen.getByText('bridge exploded')).toBeTruthy()
    expect(screen.getByText('broken')).toBeTruthy()
  })

  it('says so when the bridge exposes no domains map at all', async () => {
    render(<CherryHostProvider bridge={{ domains: undefined } as never}><CompatDomainCapabilities /></CherryHostProvider>)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain('Host Bridge 未提供 domains')
  })
})
