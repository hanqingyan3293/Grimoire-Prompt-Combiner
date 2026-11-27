// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  deleteVersions: vi.fn(async () => ({ deleted: [] })),
  restoreVersions: vi.fn(async () => []),
  purgeVersions: vi.fn(async () => 0),
  renameBranch: vi.fn(async () => true),
  proposeOrganize: vi.fn(async (): Promise<unknown> => ({ ok: true, changes: [], workRevision: 3, versionId: 'v2' })),
  metadata: {
    exportTo: vi.fn(async () => ({ canceled: false, writtenPath: 'C:/tmp/image.meta.png' })),
    readFrom: vi.fn(async (): Promise<unknown> => ({ canceled: false, decoded: { params: { prompt: 'from png' } } })),
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
    // Export writes the sibling .meta.png path returned by the main process; the original is untouched.
    expect(screen.getByText(/image\.meta\.png/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /从 PNG 读取/ }))
    await waitFor(() => expect(api.metadata.readFrom).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('from png'))
  })
  it('exports every editable generation metadata field', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('反向提示词'), { target: { value: 'lowres, bad anatomy' } })
    fireEvent.change(screen.getByLabelText('步数'), { target: { value: '28' } })
    fireEvent.change(screen.getByLabelText('CFG'), { target: { value: '7.5' } })
    fireEvent.change(screen.getByLabelText('种子'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('采样器'), { target: { value: 'k_euler_ancestral' } })
    fireEvent.change(screen.getByLabelText('调度器'), { target: { value: 'native' } })
    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '832' } })
    fireEvent.change(screen.getByLabelText('高度'), { target: { value: '1216' } })
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'nai-diffusion-3' } })
    fireEvent.change(screen.getByLabelText('检查点'), { target: { value: 'anime-v4' } })
    fireEvent.change(screen.getByLabelText('LoRA（逗号分隔）'), { target: { value: 'styleA, styleB' } })

    fireEvent.click(screen.getByRole('button', { name: /参数写入 PNG/ }))
    await waitFor(() => expect(api.metadata.exportTo).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '1girl, {{long hair}}, __sky*2__',
      negativePrompt: 'lowres, bad anatomy',
      steps: 28,
      cfg: 7.5,
      seed: 123456,
      sampler: 'k_euler_ancestral',
      scheduler: 'native',
      width: 832,
      height: 1216,
      model: 'nai-diffusion-3',
      checkpoint: 'anime-v4',
      loras: ['styleA', 'styleB'],
    })))
  })
  it('imports every generation metadata field and keeps unknown keys for the next export', async () => {
    api.metadata.readFrom.mockResolvedValueOnce({
      canceled: false,
      decoded: {
        params: {
          prompt: 'imported prompt',
          negativePrompt: 'bad hands',
          steps: 30,
          cfg: 5.5,
          seed: 42,
          sampler: 'dpmpp_2m',
          scheduler: 'karras',
          width: 512,
          height: 768,
          model: 'nai-diffusion-4',
          checkpoint: 'imported-checkpoint',
          loras: ['detail', 'lineart'],
        },
        unknown: { futureField: 'kept', nestedOption: { enabled: true } },
        version: 1,
      },
    })
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /从 PNG 读取/ }))

    await waitFor(() => expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('imported prompt'))
    expect((screen.getByLabelText('反向提示词') as HTMLInputElement).value).toBe('bad hands')
    expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('CFG') as HTMLInputElement).value).toBe('5.5')
    expect((screen.getByLabelText('种子') as HTMLInputElement).value).toBe('42')
    expect((screen.getByLabelText('采样器') as HTMLInputElement).value).toBe('dpmpp_2m')
    expect((screen.getByLabelText('调度器') as HTMLInputElement).value).toBe('karras')
    expect((screen.getByLabelText('宽度') as HTMLInputElement).value).toBe('512')
    expect((screen.getByLabelText('高度') as HTMLInputElement).value).toBe('768')
    expect((screen.getByLabelText('模型') as HTMLInputElement).value).toBe('nai-diffusion-4')
    expect((screen.getByLabelText('检查点') as HTMLInputElement).value).toBe('imported-checkpoint')
    expect((screen.getByLabelText('LoRA（逗号分隔）') as HTMLInputElement).value).toBe('detail, lineart')
    // The UI has no field for these keys, so they live only in the draft metadata object.
    expect(screen.queryByLabelText('futureField')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /参数写入 PNG/ }))
    await waitFor(() => expect(api.metadata.exportTo).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'imported prompt',
      negativePrompt: 'bad hands',
      steps: 30,
      cfg: 5.5,
      seed: 42,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      width: 512,
      height: 768,
      model: 'nai-diffusion-4',
      checkpoint: 'imported-checkpoint',
      loras: ['detail', 'lineart'],
      futureField: 'kept',
      nestedOption: { enabled: true },
    })))
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
  it('diffs two versions in place when 对比 is used', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '对比 v1' }))
    const panel = screen.getByLabelText('版本对比')
    // In the fixture, v2 is v1 plus the random block, so exactly one addition is reported.
    expect(panel.textContent).toContain('+1')
    expect(panel.textContent).toContain('+ __sky*2__')
  })
  it('batches recycle-bin restore when several versions are selected', async () => {
    // Only this test needs recycle-bin entries, so the fixture is extended per test rather than globally.
    ;(api.bundle as unknown as { mockResolvedValueOnce: (value: unknown) => void }).mockResolvedValueOnce({
      ...bundle,
      deleted: [
        { id: 'v2', number: 2, branchNumber: 1, branchId: 'b1', workId: 'w1', parentId: 'v1', snapshot: 'x', source: 'user', operation: 'edit', revision: 1, createdAt: '', deletedAt: 'now' },
        { id: 'v1', number: 1, branchNumber: 1, branchId: 'b1', workId: 'w1', parentId: null, snapshot: 'y', source: 'user', operation: 'create', revision: 1, createdAt: '', deletedAt: 'now' },
      ],
    })
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('选择 v2'))
    fireEvent.click(screen.getByLabelText('选择 v1'))
    fireEvent.click(screen.getByRole('button', { name: /恢复选中/ }))
    await waitFor(() => expect(api.restoreVersions).toHaveBeenCalledWith(['v2', 'v1']))
  })
  it('permanently purges the selected versions instead of soft-deleting them again', async () => {
    ;(api.bundle as unknown as { mockResolvedValueOnce: (value: unknown) => void }).mockResolvedValueOnce({
      ...bundle,
      deleted: [
        { id: 'v2', number: 2, branchNumber: 1, branchId: 'b1', workId: 'w1', parentId: 'v1', snapshot: 'x', source: 'user', operation: 'edit', revision: 1, createdAt: '', deletedAt: 'now' },
        { id: 'v1', number: 1, branchNumber: 1, branchId: 'b1', workId: 'w1', parentId: null, snapshot: 'y', source: 'user', operation: 'create', revision: 1, createdAt: '', deletedAt: 'now' },
      ],
    })
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('选择 v2'))
    fireEvent.click(screen.getByLabelText('选择 v1'))
    fireEvent.click(screen.getByRole('button', { name: /永久删除选中/ }))
    // 永久删除 must purge; calling the soft delete again would leave the rows where they are.
    await waitFor(() => expect(api.purgeVersions).toHaveBeenCalledWith(['v2', 'v1']))
    expect(api.deleteVersions).not.toHaveBeenCalled()
  })

  it('previews dedupe, sort and cleanup locally before applying them', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: ' b , a ,  b ' } })

    fireEvent.click(screen.getByRole('button', { name: '去重' }))
    expect(screen.getByLabelText('本地整理预览').textContent).toContain('b, a')
    fireEvent.click(screen.getByRole('button', { name: '取消预览' }))

    fireEvent.click(screen.getByRole('button', { name: '排序' }))
    expect(screen.getByLabelText('本地整理预览').textContent).toContain('a, b, b')
    fireEvent.click(screen.getByRole('button', { name: '取消预览' }))

    fireEvent.click(screen.getByRole('button', { name: '清理' }))
    expect(screen.getByLabelText('本地整理预览').textContent).toContain('b, a, b')
    fireEvent.click(screen.getByRole('button', { name: '应用预览' }))
    await waitFor(() => expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('b, a, b'))
    expect(api.proposeOrganize).not.toHaveBeenCalled()
  })

  it('refuses to apply a local preview after the draft changed', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: 'b, a, b' } })
    fireEvent.click(screen.getByRole('button', { name: '去重' }))
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: 'edited after preview' } })
    fireEvent.click(screen.getByRole('button', { name: '应用预览' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('预览已失效'))
    expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('edited after preview')
  })

  it('requests user confirmation, then shows before/after per proposal with accept and reject', async () => {
    api.proposeOrganize.mockResolvedValueOnce({
      ok: true,
      changes: [
        { block: 1, before: 'long  hair', after: 'long hair', title: '合并空格', reason: '多余的空白' },
        { block: 2, before: 'solo.', after: 'solo', title: '去掉句号', reason: '标签不需要句号' },
      ],
      workRevision: 3,
      versionId: 'v2',
    })
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '1girl, long  hair, solo.' } })

    fireEvent.click(screen.getByRole('button', { name: 'AI 整理' }))
    expect(api.proposeOrganize).not.toHaveBeenCalled()
    expect(screen.getByText(/将把当前草稿/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))

    await waitFor(() => expect(api.proposeOrganize).toHaveBeenCalledWith({
      workId: 'w1', versionId: 'v2', expectedRevision: 3, draft: '1girl, long  hair, solo.',
    }))
    await waitFor(() => expect(screen.getByLabelText('整理建议 1')).toBeTruthy())
    const first = screen.getByLabelText('整理建议 1')
    expect(first.textContent).toContain('long  hair')
    expect(first.textContent).toContain('long hair')

    const second = screen.getByLabelText('整理建议 2')
    fireEvent.click(within(second).getByRole('button', { name: '拒绝' }))
    expect(screen.queryByLabelText('整理建议 2')).toBeNull()

    fireEvent.click(within(first).getByRole('button', { name: '接受' }))
    await waitFor(() => expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('1girl, long hair, solo.'))
    expect(screen.queryByLabelText('整理建议 1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /保存为新版本/ }))
    await waitFor(() => expect(api.createVersion).toHaveBeenCalledWith(expect.objectContaining({
      workId: 'w1', parentVersionId: 'v2', snapshot: '1girl, long hair, solo.', expectedRevision: 3,
    })))
  })

  it('discards a proposal that arrives after the user switches to another version', async () => {
    let resolveProposal: (value: unknown) => void = () => undefined
    api.proposeOrganize.mockReturnValueOnce(new Promise(resolve => { resolveProposal = resolve }))
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '1girl, long  hair, solo' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(api.proposeOrganize).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /^v1 · / }))
    await waitFor(() => expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('1girl, {{long hair}}'))
    resolveProposal({
      ok: true,
      changes: [{ block: 1, before: 'long  hair', after: 'long hair', title: '合并空格', reason: '多余的空白' }],
      workRevision: 3,
      versionId: 'v2',
    })

    await waitFor(() => expect(screen.getByText(/已丢弃/)).toBeTruthy())
    expect(screen.queryByLabelText('整理建议 1')).toBeNull()
    expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('1girl, {{long hair}}')
  })

  it('discards a proposal that arrives after the draft was edited while waiting', async () => {
    let resolveProposal: (value: unknown) => void = () => undefined
    api.proposeOrganize.mockReturnValueOnce(new Promise(resolve => { resolveProposal = resolve }))
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '1girl, long  hair, solo' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(api.proposeOrganize).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '1girl, short hair, solo' } })
    resolveProposal({
      ok: true,
      changes: [{ block: 1, before: 'long  hair', after: 'long hair', title: '合并空格', reason: '多余的空白' }],
      workRevision: 3,
      versionId: 'v2',
    })

    await waitFor(() => expect(screen.getByText(/已丢弃/)).toBeTruthy())
    expect(screen.queryByLabelText('整理建议 1')).toBeNull()
    expect((screen.getByLabelText('提示词原文') as HTMLTextAreaElement).value).toBe('1girl, short hair, solo')
  })

  it('shows a malformed provider payload as a visible error', async () => {
    api.proposeOrganize.mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_PLAN',
      message: 'invalid organize plan (NOT_JSON): provider returned invalid JSON',
    })
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('INVALID_PLAN'))
    expect(screen.getByRole('alert').textContent).toContain('provider returned invalid JSON')
  })

  it('refuses to save a dirty but empty draft', async () => {
    render(<NovelAIPromptPanel />)
    await waitFor(() => expect(screen.getByLabelText('提示词原文')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /保存为新版本/ }))
    expect(api.createVersion).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '   ' } })
    const save = screen.getByRole('button', { name: /保存为新版本/ })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.click(save)
    expect(api.createVersion).not.toHaveBeenCalled()
  })
})
