// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspacePopoutWindow } from './WorkspacePopoutWindow'
import type { EditorTransferRecord } from '../../../shared/editor-transfer'

const state = vi.hoisted(() => ({ transfer: null as unknown, hydrated: false, layouts: {}, getLayout: () => null }))
const flow=vi.hoisted(()=>({perform:vi.fn(async()=>({phase:'committed'})),closeSource:vi.fn(async()=>true)}))
let closeDescriptor: PropertyDescriptor | undefined
vi.mock('./editor-transfer-client',()=>({performEditorTransfer:flow.perform}))
vi.mock('./use-editor-transfer', () => ({ useTransferredEditorRecord: () => state.transfer }))
vi.mock('../../stores/workspace.store', () => ({ useWorkspaceStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }), findPanelNode: () => null, normalizePanelTabs: () => [] }))
vi.mock('./PanelRegistry', () => ({ PANEL_DEFINITIONS: { canvas: { title: 'Canvas' } }, renderPanel: () => <div data-testid='business'>Canvas business</div> }))
vi.mock('./WorkspaceEditorHost', () => ({ WorkspaceEditorHost: ({ children, transfer }: { children: React.ReactNode; transfer?: EditorTransferRecord }) => <div data-testid='host' data-phase={transfer?.phase}>{children}</div> }))
beforeEach(() => { vi.clearAllMocks(); closeDescriptor=Object.getOwnPropertyDescriptor(window,'close'); window.location.hash = 'workspace-popout?transferId=transfer&editorId=editor'; state.transfer = null; Object.assign(window, { api: { workspace: { onTransferReturnRequested: () => () => {}, closeTransferredSource:flow.closeSource } } }) })
afterEach(() => { cleanup(); if(closeDescriptor)Object.defineProperty(window,'close',closeDescriptor); vi.restoreAllMocks(); window.location.hash = '' })

it('does not mount business state before receiving its directed transfer record', () => {
  const component = <WorkspacePopoutWindow popoutId='w:panel' panelType='canvas' title='Canvas' />
  const view = render(component)
  expect(screen.queryByTestId('business')).toBeNull()
  state.transfer = { direction: 'popout', workspaceId: 'w', panelId: 'panel', editorId: 'editor', editorKey: 'w:editor:canvas', panelType: 'canvas', title: 'Canvas', transferId: 'transfer', sequence: 1, phase: 'waiting', committedRevision: 1, expiresAt: 10_000 } satisfies EditorTransferRecord
  view.rerender(<WorkspacePopoutWindow popoutId='w:panel' panelType='canvas' title='Canvas' />)
  expect(screen.getByTestId('business')).toBeTruthy()
  expect(screen.getByTestId('host').dataset.phase).toBe('waiting')
})

it('routes page window.close through the committed editor return protocol',async()=>{
  const originalClose=vi.fn()
  // Model the browser's writable method; spying on Vitest's bound global getter masks method replacement.
  Object.defineProperty(window,'close',{value:originalClose,writable:true,configurable:true})
  state.transfer={direction:'popout',workspaceId:'w',panelId:'panel',editorId:'editor',editorKey:'w:editor:canvas',panelType:'canvas',title:'Canvas',transferId:'transfer',sequence:1,phase:'committed',committedRevision:1,expiresAt:10000} satisfies EditorTransferRecord
  render(<WorkspacePopoutWindow popoutId='w:panel' panelType='canvas' title='Canvas' />)
  expect(window.location.hash).toContain('transferId=transfer')
  expect(window.close).not.toBe(originalClose)
  await act(async()=>{window.close()})
  await waitFor(()=>expect(flow.perform).toHaveBeenCalledOnce())
  expect(flow.perform).toHaveBeenCalledWith(expect.objectContaining({direction:'return',editorKey:'w:editor:canvas'}),expect.anything(),expect.any(Function),expect.any(Function))
  expect(originalClose).not.toHaveBeenCalled()
  expect(flow.closeSource).toHaveBeenCalledOnce()
})
