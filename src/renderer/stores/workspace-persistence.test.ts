// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspacePersistenceDocument, useWorkspaceStore } from './workspace.store'
import { startWorkspacePersistence } from './workspace-persistence'

vi.mock('../components/workspace/PanelRegistry', () => ({ PANEL_DEFINITIONS: { 'novelai-workbench': { title: 'workbench' }, logs: { title: 'logs' } } }))
const api = {
  loadDocument: vi.fn(), saveDocument: vi.fn(async () => ({ saved: true, value: { revision: 4 } })),
  onDocumentChanged: vi.fn(() => () => {}), onPopoutClosed: vi.fn((_callback: (event:{popoutId:string;bounds?:{x:number;y:number;width:number;height:number}})=>void) => () => {}), openPopout: vi.fn(async () => true), isPopoutOpen: vi.fn(async () => false),
}
let stop: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();api.isPopoutOpen.mockResolvedValue(false)
  useWorkspaceStore.setState({ activeWorkspaceId: 'compose', layouts: {}, popoutPanels: {}, restoringPopouts: {}, popoutBounds: {}, persistenceRevision: 0, hydrated: false })
  Object.assign(window, { api: { workspace: api } })
})
afterEach(() => { stop?.(); stop=undefined; useWorkspaceStore.setState({ layouts: {}, popoutPanels: {}, restoringPopouts: {}, popoutBounds: {}, hydrated: false }); localStorage.clear() })

describe('workspace popout restart admission', () => {
  it('keeps an editor popout intent and bounds while awaiting its formal source adapter', async () => {
    const state = useWorkspaceStore.getState()
    state.setPanelType('compose', 'main-workbench', 'novelai-workbench')
    state.setPopoutPanel('compose', 'main-workbench', true)
    state.setPopoutBounds('compose', 'main-workbench', { x: 100, y: 80, width: 900, height: 700 })
    api.loadDocument.mockResolvedValue({ workspaceId: 'grimoire-main', revision: 3, document: createWorkspacePersistenceDocument() })
    stop = startWorkspacePersistence()
    await vi.waitFor(() => expect(useWorkspaceStore.getState().hydrated).toBe(true))
    expect(api.openPopout).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().popoutPanels.compose).toContain('main-workbench')
    expect(useWorkspaceStore.getState().restoringPopouts.compose).toContain('main-workbench')
    expect(useWorkspaceStore.getState().popoutBounds.compose['main-workbench']).toMatchObject({ width: 900, height: 700 })
    expect(createWorkspacePersistenceDocument()).not.toHaveProperty('restoringPopouts')
  })

  it('continues to restore a non-editor window through the existing legacy lifecycle', async () => {
    const state = useWorkspaceStore.getState()
    state.setPanelType('compose', 'main-workbench', 'logs')
    state.setPopoutPanel('compose', 'main-workbench', true)
    api.loadDocument.mockResolvedValue({ workspaceId: 'grimoire-main', revision: 3, document: createWorkspacePersistenceDocument() })
    stop = startWorkspacePersistence()
    await vi.waitFor(() => expect(api.openPopout).toHaveBeenCalledWith(expect.objectContaining({ popoutId: 'compose:main-workbench', panelType: 'logs' })))
  })

  it('does not restore an editor again when its native window is still alive during main reload', async () => {
    const state=useWorkspaceStore.getState();state.setPanelType('compose','main-workbench','novelai-workbench');state.setPopoutPanel('compose','main-workbench',true)
    api.loadDocument.mockResolvedValue({workspaceId:'grimoire-main',revision:3,document:createWorkspacePersistenceDocument()});api.isPopoutOpen.mockResolvedValue(true)
    stop=startWorkspacePersistence();await vi.waitFor(()=>expect(useWorkspaceStore.getState().hydrated).toBe(true))
    expect(useWorkspaceStore.getState().restoringPopouts.compose || []).toEqual([])
    expect(useWorkspaceStore.getState().popoutPanels.compose).toContain('main-workbench')
  })

  it('removes a pending restore when the native close notification revokes its open intent', async () => {
    const state=useWorkspaceStore.getState();state.setPanelType('compose','main-workbench','novelai-workbench');state.setPopoutPanel('compose','main-workbench',true)
    api.loadDocument.mockResolvedValue({workspaceId:'grimoire-main',revision:3,document:createWorkspacePersistenceDocument()})
    stop=startWorkspacePersistence();await vi.waitFor(()=>expect(useWorkspaceStore.getState().restoringPopouts.compose).toContain('main-workbench'))
    api.onPopoutClosed.mock.calls.at(-1)![0]({popoutId:'compose:main-workbench'})
    expect(useWorkspaceStore.getState().restoringPopouts.compose || []).toEqual([])
    expect(useWorkspaceStore.getState().popoutPanels.compose).not.toContain('main-workbench')
  })
})
