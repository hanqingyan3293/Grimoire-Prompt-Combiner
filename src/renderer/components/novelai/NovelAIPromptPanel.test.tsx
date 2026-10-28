// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NovelAIPromptPanel } from './NovelAIPromptPanel'

// The panel is presentation only: the branching/revision rules are tested in the main service.
// These tests pin the two things that would silently rot: the block list must come from the real
// parser, and saving must send the revision the server gave us.
const bundle = {
  work: { id: 'w1', name: '黄昏', lastVersionId: 'v2', revision: 3, lastUsedAt: '2026-10-27' },
  line: [
    { id: 'v1', workId: 'w1', parentId: null, number: 1, branchId: 'v1', branchNumber: 1, snapshot: '1girl, {{long hair}}', source: 'user', operation: 'create', createdAt: '2026-10-27', deletedAt: null },
    { id: 'v2', workId: 'w1', parentId: 'v1', number: 2, branchId: 'v1', branchNumber: 1, snapshot: '1girl, {{long hair}}, __sky*2__', source: 'user', operation: '编辑', createdAt: '2026-10-27', deletedAt: null },
  ],
  branchName: '主线',
  deleted: [],
    branches: [],
}

const api = {
  listWorks: vi.fn(async () => [bundle.work]),
  bundle: vi.fn(async () => bundle),
  createWork: vi.fn(),
  createVersion: vi.fn(async () => ({ version: bundle.line[1], branched: false, unchanged: false })),
  deleteVersion: vi.fn(async () => ({ deleted: ['v2'] })),
  restoreVersion: vi.fn(),
  renameBranch: vi.fn(async () => true),
  metadata: {
    exportTo: vi.fn(async () => ({ canceled: false, writtenPath: 'C:/tmp/image.meta.png' })),
    readFrom: vi.fn(async () => ({ canceled: false, decoded: { params: { prompt: 'from png' } } })),
  },
}

// Without an explicit cleanup the previous render leaks into the next test and every query
// matches twice (this project runs vitest without globals, so auto-cleanup is not registered).
afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: { novelai: typeof api } }).api = { novelai: api }
})

describe('NovelAI prompt workbench (M6 UI)', () => {
  it('loads the latest line and renders blocks from the real parser', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    const textarea = screen.getByLabelText('提示词原文') as HTMLTextAreaElement
    expect(textarea.value).toBe('1girl, {{long hair}}, __sky*2__')
    await waitFor(() => expect(screen.getAllByText('标签块').length).toBeGreaterThan(0))
    expect(screen.getAllByText('随机块').length).toBe(1)
    // `{{long hair}}` is two levels of weighting: +5% each.
    expect(screen.getByText('+10%')).toBeTruthy()
  })

  it('saves a new version with the revision the server reported', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '1girl, solo' } })
    fireEvent.click(screen.getByRole('button', { name: /保存为新版本/ }))
    await waitFor(() => expect(api.createVersion).toHaveBeenCalledTimes(1))
    expect(api.createVersion).toHaveBeenCalledWith(expect.objectContaining({ workId: 'w1', parentVersionId: 'v2', snapshot: '1girl, solo', expectedRevision: 3 }))
  })
  it('exports the current prompt into a PNG and reads parameters back', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /参数写入 PNG/ }))
    await waitFor(() => expect(api.metadata.exportTo).toHaveBeenCalledWith(expect.objectContaining({ prompt: '1girl, {{long hair}}, __sky*2__' })))
    await waitFor(() => expect(screen.getByText(/已写入/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /从 PNG 读取/ }))
    await waitFor(() => expect(api.metadata.readFrom).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('from png'))
  })
  it('branches from an older version instead of always extending the tip', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '从 v1 开新分支' }))
    await waitFor(() => expect(screen.getByText(/将从 v1 开新分支/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '1girl, long hair' } })
    fireEvent.click(screen.getByRole('button', { name: /保存为新版本/ }))
    await waitFor(() => expect(api.createVersion).toHaveBeenCalledWith(expect.objectContaining({ parentVersionId: 'v1', operation: '开分支' })))
  })
})
