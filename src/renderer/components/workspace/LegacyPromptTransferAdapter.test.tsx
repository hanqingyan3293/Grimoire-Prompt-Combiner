// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyPromptTransferAdapter } from './LegacyPromptTransferAdapter'
import { MainContent } from '../layout/MainContent'
import { usePromptsStore } from '../../stores/prompts.store'
import type { WorkspaceEditorTransferAdapter } from './editor-types'
const editor = vi.hoisted(() => ({ stateKey: 'w:a:prompt-workbench', status: 'ready', frozen: false, transferTarget: false, state: null as unknown, setState: vi.fn(), registerTransferAdapter: vi.fn() }))
const EditorContext = React.createContext(editor)
vi.mock('./WorkspaceEditorHost', () => ({ useOptionalWorkspaceEditorState: () => React.useContext(EditorContext) }))
vi.mock('../../i18n/context', () => ({ useI18n: () => ({ t: (text: string) => text }) }))
vi.mock('../tags/TagCards', () => ({ TagCards: () => null }))
vi.mock('../tags/ImpliedTagStrip', () => ({ ImpliedTagStrip: () => null }))
const tag = { tag: { id: 'tag', subcategory_id: 'sub', en: 'raw tag', zh: '标签', sort_order: 0, source: 'custom' as const, created_at: 'now' }, weight: 1.3, category: 'cat', subcategory: 'sub', breakBefore: true }
const saved = { kind: 'legacy-prompts', version: 1, positive: [tag], negative: [], undoStack: [], redoStack: [], impliedExcluded: ['excluded-tag'] }
const api = { getEditorAccess: vi.fn(async (_key: string) => ({ writable: true, reason: 'owned' })), onEditorAccessChanged: vi.fn(() => () => {}) }
beforeEach(() => { vi.clearAllMocks(); api.getEditorAccess.mockResolvedValue({ writable: true, reason: 'owned' }); editor.state = null; editor.status = 'ready'; editor.frozen = false; editor.transferTarget = false; Object.assign(window, { api: { workspace: api } }); usePromptsStore.setState({ positive: [], negative: [], undoStack: [], redoStack: [], impliedExcluded: [], editingLocked: false }) })
afterEach(() => { cleanup(); usePromptsStore.setState({ positive: [], negative: [], undoStack: [], redoStack: [], impliedExcluded: [], editingLocked: false }) })
describe('legacy singleton draft lifecycle', () => {
  it('hydrates its normal reopened editor from the same workspace snapshot', async () => {
    editor.state = saved; render(<LegacyPromptTransferAdapter><MainContent /></LegacyPromptTransferAdapter>)
    await waitFor(() => expect(usePromptsStore.getState().positive).toEqual([tag]))
    expect(usePromptsStore.getState().impliedExcluded).toEqual(['excluded-tag'])
  })
  it('commits the real pending weight input before capturing and locking the store', async () => {
    usePromptsStore.setState({ positive: [tag] })
    render(<LegacyPromptTransferAdapter><MainContent /></LegacyPromptTransferAdapter>)
    const field = document.querySelector('.ui-prompt-chip-positive input[type=text]') as HTMLInputElement
    await waitFor(() => expect(usePromptsStore.getState().editingLocked).toBe(false))
    act(() => field.focus()); fireEvent.change(field, { target: { value: '1.5' } })
    const adapter = editor.registerTransferAdapter.mock.calls.at(-1)![0] as WorkspaceEditorTransferAdapter
    await act(async () => { await adapter.freeze?.() })
    expect((await adapter.capture!() as typeof saved).positive[0].weight).toBe(1.5)
  })

  it.each([false,true])('keeps late sibling ACKs from changing the captured singleton, detached source=%s', async detached => {
    const sibling = { ...editor, stateKey: 'w:a:negative-prompts', registerTransferAdapter: vi.fn() }
    let release!: (value: { writable: boolean; reason: string }) => void
    const held = new Promise<{ writable: boolean; reason: string }>(resolve => { release = resolve })
    api.getEditorAccess.mockImplementation(key => key === sibling.stateKey ? held : Promise.resolve({ writable: true, reason: 'owned' }))
    usePromptsStore.setState({ positive: [tag] })
    const tree=(showSource:boolean)=><>
      {showSource&&<EditorContext.Provider key="source" value={editor}><LegacyPromptTransferAdapter><span>source</span></LegacyPromptTransferAdapter></EditorContext.Provider>}
      <EditorContext.Provider key="sibling" value={sibling}><LegacyPromptTransferAdapter><span>sibling</span></LegacyPromptTransferAdapter></EditorContext.Provider>
    </>
    const view=render(tree(true))
    await waitFor(() => expect(sibling.registerTransferAdapter).toHaveBeenCalled())
    const adapter = editor.registerTransferAdapter.mock.calls.at(-1)![0] as WorkspaceEditorTransferAdapter
    await act(async () => { await adapter.freeze?.() })
    const captured = await adapter.capture!() as typeof saved
    if(detached)view.rerender(tree(false))
    await act(async () => { release({ writable: true, reason: 'owned' }); await held })
    expect(usePromptsStore.getState().editingLocked).toBe(true)
    usePromptsStore.getState().clearPositive()
    expect(usePromptsStore.getState().positive).toEqual(captured.positive)
  })

  it('never adds an unmounted view to the frozen family after its permission response arrives', async () => {
    const view=render(<LegacyPromptTransferAdapter><span>source</span></LegacyPromptTransferAdapter>)
    await waitFor(()=>expect(usePromptsStore.getState().editingLocked).toBe(false))
    const adapter=editor.registerTransferAdapter.mock.calls.at(-1)![0] as WorkspaceEditorTransferAdapter
    let release!: (value:{writable:boolean;reason:string})=>void
    const held=new Promise<{writable:boolean;reason:string}>(resolve=>{release=resolve})
    api.getEditorAccess.mockImplementation(()=>held)
    const freezing=adapter.freeze!();void freezing.catch(()=>undefined)
    view.unmount();release({writable:true,reason:'owned'})
    try { await expect(freezing).rejects.toThrow('EDITOR_TRANSFER_ABORTED') }
    finally { adapter.thaw?.();api.getEditorAccess.mockResolvedValue({writable:true,reason:'owned'}) }
    render(<LegacyPromptTransferAdapter><span>new owner view</span></LegacyPromptTransferAdapter>)
    await waitFor(()=>expect(usePromptsStore.getState().editingLocked).toBe(false))
  })
})
