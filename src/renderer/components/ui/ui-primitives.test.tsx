// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Copy } from 'lucide-react'
import { Button, IconButton } from './Button'
import { Badge } from './Badge'
import { Modal } from './Modal'
import { Toast } from './Toast'
import { EmptyState, ProgressBar, StatusBadge } from './Feedback'

describe('UI primitives', () => {
  it('renders semantic button variants and accessible icon buttons', () => {
    render(<><Button variant='primary' icon={Copy}>复制</Button><IconButton icon={Copy} label='复制提示词' /><Badge tone='success'>完成</Badge></>)
    expect(screen.getByRole('button', { name: '复制' }).className).toContain('ui-button-primary')
    expect(screen.getByRole('button', { name: '复制提示词' }).getAttribute('title')).toBe('复制提示词')
    expect(screen.getByText('完成').className).toContain('ui-badge-success')
  })

  it('closes a modal with Escape', () => {
    const onClose = vi.fn()
    render(<Modal title='测试弹窗' open onClose={onClose}><p>内容</p></Modal>)
    expect(screen.getByRole('dialog', { name: '测试弹窗' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('announces toast messages with semantic tone classes', () => {
    render(<Toast message='保存成功' type='success' onClose={() => {}} duration={60_000} />)
    expect(screen.getByRole('status').textContent).toContain('保存成功')
    expect(screen.getByText('保存成功').className).toContain('ui-toast-success')
  })

  it('renders accessible feedback states', () => {
    render(<><EmptyState icon={Copy} title='暂无内容' description='请先导入文件' /><StatusBadge tone='warning'>已暂停</StatusBadge><ProgressBar value={1.4} label='任务进度' /></>)
    expect(screen.getByText('暂无内容')).toBeTruthy()
    expect(screen.getByText('已暂停').className).toContain('ui-badge-warning')
    expect(screen.getByRole('progressbar', { name: '任务进度' }).getAttribute('aria-valuenow')).toBe('100')
  })
})
