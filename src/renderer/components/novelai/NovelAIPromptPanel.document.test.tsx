// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNovelaiDocument } from '@shared/novelai-document'
import { commitNovelaiDraft, createNovelaiDraftState, type NovelaiDraftState } from '../../stores/novelai-draft.store'
import { WorkspaceEditorHost } from '../workspace/WorkspaceEditorHost'
import { NovelAIPromptPanel } from './NovelAIPromptPanel'

vi.mock('../workspace/PanelRegistry', () => ({ getEditorDefinition: () => ({ stateKeyFactory: () => 'n1-editor' }) }))
const version = { id: 'v1', workId: 'work', parentId: null, number: 1, branchId: 'v1', branchNumber: 1, snapshot: '  sky ,\r\nlong  hair, \t🌙,  ', source: 'user', operation: 'create', createdAt: 'now', deletedAt: null }
const bundle = { work: { id: 'work', name: '角色练习', lastVersionId: 'v1', revision: 3, lastUsedAt: 'now' }, line: [version], branches: [], deleted: [], branchName: null }
const api = {
  novelai: { listWorks: vi.fn(async () => [bundle.work]), bundle: vi.fn(async () => bundle), createVersion: vi.fn(), proposeOrganize: vi.fn(), metadata: { readFrom: vi.fn(), exportTo: vi.fn() } },
  workspace: { loadEditorState: vi.fn(), saveEditorState: vi.fn(), onEditorStateChanged: vi.fn(() => () => {}), acquireEditLease: vi.fn(), heartbeatEditLease: vi.fn(), releaseEditLease: vi.fn() },
}
const canonical = (journal: NovelaiDraftState) => ({ kind: 'novelai-workbench', version: 2, activeWorkId: 'work', works: { work: { journal, selectedVersionId: 'v1', selectedBranchId: 'v1' } } })
const displayed = (raw: string) => raw.replace(/\r\n?/g, '\n')
const seed = (journal = createNovelaiDraftState(createNovelaiDocument({ primary: version.snapshot }))) => {
  api.workspace.loadEditorState.mockResolvedValue({ editorKey: 'n1-editor', revision: 5, state: canonical(journal) })
}
async function view() {
  const result = render(<WorkspaceEditorHost workspaceId='ws' editorId='ed' type='novelai-workbench'><NovelAIPromptPanel /></WorkspaceEditorHost>)
  await screen.findByLabelText('提示词原文')
  await waitFor(() => expect(screen.getByLabelText('提示词原文')).toHaveProperty('readOnly', false))
  return result
}
const saved = () => api.workspace.saveEditorState.mock.calls.at(-1)?.[2] as ReturnType<typeof canonical>
beforeEach(() => {
  vi.clearAllMocks()
  seed()
  api.workspace.saveEditorState.mockImplementation(async (editorKey, revision, state) => ({ saved: true, value: { editorKey, revision: revision + 1, state } }))
  api.workspace.acquireEditLease.mockResolvedValue({ ok: true, lease: { resource: { kind: 'work', id: 'work' }, leaseId: 'public-fixture-n1', expiresAt: Date.now() + 30000 } })
  api.workspace.releaseEditLease.mockResolvedValue({ ok: true, released: true })
  ;(window as unknown as { api: unknown }).api = api
})
afterEach(cleanup)

describe('N1 complete workbench document in the existing draft host', () => {
  it('migrates legacy raw, empty parameters, unknown metadata and selection without guessing roles', async () => {
    api.workspace.loadEditorState.mockResolvedValue({ editorKey: 'n1-editor', revision: 5, state: { kind: 'novelai-workbench', version: 1, activeWorkId: 'work', works: { work: { draft: version.snapshot, metadata: { negativePrompt: ' lowres,  ', steps: '', seed: '0007', model: '', unknown: { characters: [{ name: 'not a historical role' }], future: { value: null } } }, selectedVersionId: 'v1' } } } })
    await view()
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', displayed(version.snapshot))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved()).toMatchObject({ version: 2, activeWorkId: 'work', works: { work: { selectedVersionId: 'v1', journal: { document: { primary: version.snapshot, negative: ' lowres,  ', characters: [], generation: { steps: '', seed: '0007', model: '' }, metadataUnknown: { characters: [{ name: 'not a historical role' }], future: { value: null } } } } } } })
    expect(api.novelai.createVersion).not.toHaveBeenCalled()
  })

  it('keeps block names and own-line layout outside raw, and weights only the exact block', async () => {
    await view()
    fireEvent.change(screen.getByLabelText('块 2 名称'), { target: { value: '发型' } })
    fireEvent.click(screen.getByLabelText('块 2 单独成行'))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', displayed(version.snapshot))
    fireEvent.click(screen.getByRole('button', { name: '块 2 加权 5%' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', '  sky ,\n{long  hair}, \t🌙,  ')
    fireEvent.click(screen.getByRole('button', { name: '块 2 减权 5%' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', displayed(version.snapshot))
    fireEvent.change(screen.getByLabelText('块 2 数字权重'), { target: { value: '1.25' } })
    fireEvent.click(screen.getByRole('button', { name: '应用块 2 数字权重' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', '  sky ,\n1.25::long  hair::, \t🌙,  ')
    expect(screen.getByLabelText('块 2 名称')).toHaveProperty('value', '发型')
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved().works.work.journal.document.blockMeta).toEqual([expect.objectContaining({ name: '发型', ownLine: true, expectedText: '1.25::long  hair::' })])
  })

  it('edits multiple stable-ID characters and the main negative independently across hydration', async () => {
    await view()
    fireEvent.change(screen.getByLabelText('反向提示词'), { target: { value: ' global negative ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    fireEvent.change(screen.getByLabelText('角色 1 名称'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('角色 1 正面提示词'), { target: { value: '  blue eyes,  ' } })
    fireEvent.change(screen.getByLabelText('角色 1 负面提示词'), { target: { value: '[bad hands]' } })
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    fireEvent.change(screen.getByLabelText('角色 2 正面提示词'), { target: { value: '1.2::coat::' } })
    fireEvent.change(screen.getByLabelText('步数'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    const snapshot = saved()
    const ids = snapshot.works.work.journal.document.characters.map(character => character.id)
    expect(new Set(ids).size).toBe(2)
    cleanup()
    api.workspace.loadEditorState.mockResolvedValue({ editorKey: 'n1-editor', revision: 6, state: JSON.parse(JSON.stringify(snapshot)) })
    await view()
    expect(screen.getByLabelText('角色 1 正面提示词')).toHaveProperty('value', '  blue eyes,  ')
    expect(screen.getByLabelText('角色 1 负面提示词')).toHaveProperty('value', '[bad hands]')
    expect(screen.getByLabelText('角色 2 正面提示词')).toHaveProperty('value', '1.2::coat::')
    expect(screen.getByLabelText('反向提示词')).toHaveProperty('value', ' global negative ')
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saved().works.work.journal.document.characters.map(character => character.id)).toEqual(ids))
    expect(api.novelai.createVersion).not.toHaveBeenCalled()
  })

  it('previews one seeded option per pool and keeps unknown or empty pool failures at zero writes', async () => {
    seed(createNovelaiDraftState(createNovelaiDocument({ primary: '  __sky__, tail,  ', generation: { seed: '0007' }, randomPools: [{ id: 'pool', name: 'sky', options: ['sun', 'rain', 'cloud'] }] })))
    await view()
    fireEvent.click(screen.getByRole('button', { name: '预览随机抽样' }))
    const preview = screen.getByLabelText('随机抽样预览').textContent
    expect(preview).toMatch(/^  (sun|rain|cloud), tail,  $/)
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', '  __sky__, tail,  ')
    fireEvent.click(screen.getByRole('button', { name: '预览随机抽样' }))
    expect(screen.getByLabelText('随机抽样预览').textContent).toBe(preview)
    fireEvent.click(screen.getByRole('button', { name: '应用抽样' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', preview)
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '__unknown__' } })
    fireEvent.click(screen.getByRole('button', { name: '预览随机抽样' }))
    expect(screen.getByRole('alert').textContent).toContain('UNKNOWN_RANDOM_POOL')
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', '__unknown__')
    fireEvent.change(screen.getByLabelText('随机池 1 选项（每行一个）'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '__sky__' } })
    fireEvent.click(screen.getByRole('button', { name: '预览随机抽样' }))
    expect(screen.getByRole('alert').textContent).toContain('EMPTY_RANDOM_POOL')
  })

  it('automatically appends enabled quality tokens once and can undo the combined action', async () => {
    seed(createNovelaiDraftState(createNovelaiDocument({ primary: 'sky', quality: { enabled: false, tokens: ['best quality', 'very aesthetic'] } })))
    await view()
    fireEvent.click(screen.getByLabelText('自动追加质量词'))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'sky, best quality, very aesthetic')
    fireEvent.click(screen.getByRole('button', { name: '追加质量词' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'sky, best quality, very aesthetic')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'sky')
    expect(screen.getByLabelText('自动追加质量词')).toHaveProperty('checked', false)
  })

  it('groups a focused typing gesture and hydrates selective Agent undo without touching later user input', async () => {
    let journal = createNovelaiDraftState(createNovelaiDocument({ primary: 'sky, long  hair, tail' }))
    const agent = commitNovelaiDraft(journal, { expectedRevision: 0, transactionId: 'agent-tx', source: 'agent', operation: 'AI 整理', changes: [{ kind: 'text', target: 'primary', range: { start: 5, end: 15 }, expectedText: 'long  hair', text: 'long hair' }] })
    if (!agent.ok) throw new Error(agent.code)
    journal = agent.state
    seed(journal)
    await view()
    fireEvent.focus(screen.getByLabelText('提示词原文'))
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: 'user sky, long hair, tail' } })
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: 'user! sky, long hair, tail' } })
    fireEvent.blur(screen.getByLabelText('提示词原文'))
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'sky, long hair, tail')
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'user! sky, long hair, tail')
    fireEvent.click(screen.getByRole('button', { name: '撤销 Agent 改动' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'user! sky, long  hair, tail')
  })

  it('accepts AI proposals as Agent transactions and refuses a suggestion invalidated by another document field', async () => {
    api.novelai.proposeOrganize.mockResolvedValue({ ok: true, changes: [{ block: 1, before: 'long  hair', after: 'long hair', title: '发型空白', reason: '合并空格' }], workRevision: 3, versionId: 'v1' })
    await view()
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    const proposal = await screen.findByLabelText('整理建议 1')
    fireEvent.click(within(proposal).getByRole('button', { name: '接受' }))
    fireEvent.click(screen.getByRole('button', { name: '撤销 Agent 改动' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', displayed(version.snapshot))
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    const stale = await screen.findByLabelText('整理建议 1')
    fireEvent.change(screen.getByLabelText('反向提示词'), { target: { value: 'new negative' } })
    fireEvent.click(within(stale).getByRole('button', { name: '接受' }))
    expect(screen.getByRole('alert').textContent).toMatch(/失效|STALE/)
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', displayed(version.snapshot))
  })

  it('retains incomplete typing while guarded block actions refuse it', async () => {
    await view()
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '{typing' } })
    fireEvent.click(screen.getByRole('button', { name: '块 1 加权 5%' }))
    expect(screen.getByRole('alert').textContent).toContain('INVALID_SYNTAX')
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', '{typing')
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved().works.work.journal.document.primary).toBe('{typing')
    expect(api.novelai.createVersion).not.toHaveBeenCalled()
  })

  it('uses typed block text verbatim instead of treating it as a weight command', async () => {
    await view()
    fireEvent.change(screen.getByLabelText('块 2 原文'), { target: { value: '1.25::braided hair::' } })
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', '  sky ,\n1.25::braided hair::, \t🌙,  ')
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved().works.work.journal.document.primary).toBe('  sky ,\r\n1.25::braided hair::, \t🌙,  ')
  })

  it('keeps enabled quality settings in the same focused typing undo group', async () => {
    seed(createNovelaiDraftState(createNovelaiDocument({ primary: 'sky, best quality', quality: { enabled: true, tokens: ['best quality'] } })))
    await view()
    fireEvent.focus(screen.getByLabelText('提示词原文'))
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: 'rain' } })
    fireEvent.blur(screen.getByLabelText('提示词原文'))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'rain, best quality')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByLabelText('提示词原文')).toHaveProperty('value', 'sky, best quality')
    expect(screen.getByLabelText('自动追加质量词')).toHaveProperty('checked', true)
  })

  it('preserves raw CRLF during textarea input and does not checkpoint a draft flush', async () => {
    await view()
    fireEvent.change(screen.getByLabelText('提示词原文'), { target: { value: '  sky ,\nshort hair, \t🌙,  '} })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved().works.work.journal.document.primary).toBe('  sky ,\r\nshort hair, \t🌙,  ')
    expect(api.novelai.createVersion).not.toHaveBeenCalled()
  })

  it('keeps the full draft while refreshing a successfully saved raw business version', async () => {
    api.novelai.createVersion.mockResolvedValue({ version, unchanged: false, branched: false })
    seed(createNovelaiDraftState(createNovelaiDocument({ primary: 'edited primary', negative: 'retained negative', characters: [{ id: 'role', name: 'Role', positive: 'role raw', negative: 'role negative' }], metadataUnknown: { future: null }, generation: { seed: '0007', cfg: '' } })))
    await view()
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }))
    await waitFor(() => expect(api.novelai.createVersion).toHaveBeenCalled())
    await waitFor(() => expect(api.novelai.bundle.mock.calls.length).toBeGreaterThan(1))
    expect(screen.getByLabelText('角色 1 正面提示词')).toHaveProperty('value', 'role raw')
    expect(screen.getByLabelText('反向提示词')).toHaveProperty('value', 'retained negative')
    fireEvent.change(screen.getByLabelText('种子'), { target: { value: '0008' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved().works.work.journal.document).toMatchObject({ primary: 'edited primary', metadataUnknown: { future: null }, generation: { seed: '0008', cfg: '' } })
  })

  it('refuses a future workbench DTO without writing an empty replacement', async () => {
    api.workspace.loadEditorState.mockResolvedValue({ editorKey: 'n1-editor', revision: 5, state: { ...canonical(createNovelaiDraftState(createNovelaiDocument({ primary: 'retain future raw' }))), version: 3 } })
    render(<WorkspaceEditorHost workspaceId='ws' editorId='ed' type='novelai-workbench'><NovelAIPromptPanel /></WorkspaceEditorHost>)
    await waitFor(() => expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('UNSUPPORTED_WORKBENCH_VERSION'))).toBe(true))
    expect(screen.getByRole('button', { name: '保存草稿' })).toHaveProperty('disabled', true)
    expect(api.workspace.saveEditorState).not.toHaveBeenCalled()
    expect(api.novelai.createVersion).not.toHaveBeenCalled()
  })

  it.each([
    ['a', 'aa', 0, 'insertText', 0, '', 'a'],
    ['aaa', 'aa', 1, 'deleteContentBackward', 0, 'a', ''],
  ] as const)('records the native before-input origin for %s → %s', async (before, after, caret, inputType, start, removed, inserted) => {
    seed(createNovelaiDraftState(createNovelaiDocument({ primary: before })))
    await view()
    const field = screen.getByLabelText('提示词原文') as HTMLTextAreaElement
    fireEvent.focus(field); field.setSelectionRange(caret, caret)
    fireEvent(field, new InputEvent('beforeinput', { bubbles: true, inputType, data: inserted || null }))
    fireEvent.input(field, { target: { value: after } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(api.workspace.saveEditorState).toHaveBeenCalled())
    expect(saved().works.work.journal.history[0].entries[0].changes[0]).toMatchObject({ kind: 'text', target: 'primary', start, before: removed, after: inserted })
  })

  it('routes standard undo and redo keys through the focused document journal', async () => {
    seed(createNovelaiDraftState(createNovelaiDocument({ primary: 'original' })))
    await view()
    const field = screen.getByLabelText('提示词原文')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'first' } })
    fireEvent.change(field, { target: { value: 'second' } })
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
    expect(field).toHaveProperty('value', 'original')
    fireEvent.keyDown(field, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(field).toHaveProperty('value', 'second')
  })
})
