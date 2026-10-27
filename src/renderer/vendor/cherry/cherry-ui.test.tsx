// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CherryAgentShell } from './AgentShell'
import { CherryComposer } from './ComposerSurface'

describe('Cherry AI UI adapter', () => {
  it('sends on Enter and preserves multiline input with Shift+Enter', () => {
    const onSend = vi.fn()
    const onChange = vi.fn()
    render(<CherryComposer value="hello" onChange={onChange} onSend={onSend} busy={false} />)
    const input = screen.getByRole('textbox', { name: 'Agent 消息输入框' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('renders the three-pane shell and supports collapsing a side pane', () => {
    render(<CherryAgentShell header={<div>header</div>} sidebar={<div>sessions</div>} center={<div>conversation</div>} context={<div>context</div>} />)
    expect(screen.getByText('sessions')).toBeTruthy()
    expect(screen.getByText('conversation')).toBeTruthy()
    expect(screen.getByText('context')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起会话侧栏' }))
    expect(screen.queryByText('sessions')).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开会话侧栏' })).toBeTruthy()
  })
})
