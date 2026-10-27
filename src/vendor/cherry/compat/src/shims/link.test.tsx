import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Link } from './tanstack-router'

function route(hash: string) {
  window.history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

afterEach(() => route('#/app/chat'))

describe('source route Link compatibility', () => {
  it('renders a real anchor and preserves screenshot shortcut search on navigation', async () => {
    route('#/settings/screenshot')
    render(<Link to="/settings/shortcut" search={{ command: 'screenshot.capture' }} className="source-link" style={{ color: 'red' }}>配置快捷键</Link>)
    const link = screen.getByRole('link', { name: '配置快捷键' })
    expect(link).toHaveAttribute('href', '#/settings/shortcut?command=screenshot.capture')
    expect(link).toHaveClass('source-link')
    expect(link).toHaveStyle({ color: 'rgb(255, 0, 0)' })
    fireEvent.click(link)
    await waitFor(() => expect(window.location.hash).toBe('#/settings/shortcut?command=screenshot.capture'))
  })

  it('resolves detail parameters and applies functional search updates at click time', async () => {
    route('#/settings/skills?focusId=old&panel=details')
    render(<Link to="/settings/skills/$skillId" params={{ skillId: 'skill a' }} search={previous => { const next = { ...previous }; delete next.focusId; return next }} replace>技能详情</Link>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '#/settings/skills/skill%20a?panel=details')
    act(() => route('#/settings/skills?focusId=new&panel=source'))
    fireEvent.click(screen.getByRole('link'))
    await waitFor(() => expect(window.location.hash).toBe('#/settings/skills/skill%20a?panel=source'))
  })

  it('does not override modified clicks, another target or caller cancellation', () => {
    route('#/settings/screenshot')
    const cancelled = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault())
    const view = render(<Link to="/settings/shortcut" onClick={cancelled}>快捷键</Link>)
    fireEvent.click(screen.getByRole('link'))
    expect(cancelled).toHaveBeenCalledOnce()
    expect(window.location.hash).toBe('#/settings/screenshot')
    view.rerender(<Link to="/settings/shortcut" target="_blank">快捷键</Link>)
    expect(fireEvent.click(screen.getByRole('link'))).toBe(true)
    view.rerender(<Link to="/settings/shortcut">快捷键</Link>)
    expect(fireEvent.click(screen.getByRole('link'), { ctrlKey: true })).toBe(true)
  })

  it('keeps navigation links usable inside a read-only native form boundary', async () => {
    route('#/settings/screenshot')
    render(<fieldset disabled><button>未接入操作</button><Link to="/settings/local-models">本地模型</Link></fieldset>)
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('link'))
    await waitFor(() => expect(window.location.hash).toBe('#/settings/local-models'))
  })
})
