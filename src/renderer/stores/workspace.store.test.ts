// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getDefaultLayout, isPersistablePanelType, useWorkspaceStore, type WorkspacePanelRect } from './workspace.store'

function resetWorkspace() {
  window.localStorage.clear()
  useWorkspaceStore.setState({
    activeWorkspaceId: 'compose',
    workspaces: useWorkspaceStore.getState().workspaces.filter(workspace => !workspace.id.startsWith('workspace_')),
    layouts: {},
    maximizedPanels: {},
    layoutPresets: [],
  })
}

afterEach(resetWorkspace)

describe('workspace panel persistence', () => {
  it('accepts all enabled tool panel types used by saved layouts', () => {
    for (const type of ['tasks', 'wd14', 'comfyui', 'canvas', 'prompt-assets']) {
      expect(isPersistablePanelType(type)).toBe(true)
    }
  })

  it('rejects unknown panel types', () => {
    expect(isPersistablePanelType('remote-code-plugin')).toBe(false)
  })

  it('splits, maximizes, changes and closes a panel while preserving a usable layout', () => {
    resetWorkspace()
    const store = useWorkspaceStore.getState()
    store.splitPanel('compose', 'main-workbench', 'vertical', 'canvas')
    const splitLayout = useWorkspaceStore.getState().getLayout('compose')
    const canvasPanel = findPanelByType(splitLayout, 'canvas')
    expect(canvasPanel).toBeTruthy()

    useWorkspaceStore.getState().setMaximizedPanel('compose', canvasPanel!.id)
    expect(useWorkspaceStore.getState().getMaximizedPanelId('compose')).toBe(canvasPanel!.id)
    useWorkspaceStore.getState().setPanelType('compose', canvasPanel!.id, 'wd14')
    expect(useWorkspaceStore.getState().findPanel('compose', canvasPanel!.id)?.type).toBe('wd14')

    useWorkspaceStore.getState().closePanel('compose', canvasPanel!.id)
    expect(useWorkspaceStore.getState().findPanel('compose', canvasPanel!.id)).toBeNull()
    expect(useWorkspaceStore.getState().getMaximizedPanelId('compose')).toBeNull()
  })

  it('merges adjacent panel rectangles and copies the result to another workspace', () => {
    resetWorkspace()
    const rects: WorkspacePanelRect[] = [
      { id: 'left', type: 'tag-sidebar', left: 0, top: 0, right: 0.5, bottom: 1 },
      { id: 'right', type: 'prompt-workbench', left: 0.5, top: 0, right: 1, bottom: 1 },
    ]
    expect(useWorkspaceStore.getState().mergePanelByRects('compose', 'left', 'right', 'right', rects)).toBe(true)
    expect(useWorkspaceStore.getState().getLayout('compose')).toMatchObject({ kind: 'panel', id: 'left' })

    useWorkspaceStore.getState().copyWorkspaceLayout('compose', 'ai')
    expect(useWorkspaceStore.getState().getLayout('ai')).toEqual(useWorkspaceStore.getState().getLayout('compose'))
  })

  it('restores the default layout after resetting the active workspace', () => {
    resetWorkspace()
    useWorkspaceStore.getState().splitPanel('compose', 'main-workbench', 'vertical', 'canvas')
    useWorkspaceStore.getState().resetWorkspace()
    expect(useWorkspaceStore.getState().getLayout('compose')).toEqual(getDefaultLayout('compose'))
  })
})

function findPanelByType(node: ReturnType<typeof getDefaultLayout>, type: string): { id: string; type: string } | null {
  if (node.kind === 'panel') return node.type === type ? node : null
  return findPanelByType(node.first, type) || findPanelByType(node.second, type)
}
