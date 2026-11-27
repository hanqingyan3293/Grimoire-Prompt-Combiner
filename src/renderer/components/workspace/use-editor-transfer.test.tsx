// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorTransferEvent, EditorTransferRecord } from '../../../shared/editor-transfer'
import { useIncomingEditorTransfers, useTransferredEditorRecord } from './use-editor-transfer'
import { Toast } from '../ui/Toast'

const store = vi.hoisted(() => {
  const state = { activeWorkspaceId: 'w', maximizedPanels: {} as Record<string, string | null>, setActiveWorkspace: vi.fn((id: string) => { state.activeWorkspaceId = id }), setPopoutPanel: vi.fn(), setMaximizedPanel: vi.fn((id: string, panelId: string | null) => { state.maximizedPanels[id] = panelId }) }
  return state
})
vi.mock('../../stores/workspace.store', () => ({ useWorkspaceStore: { getState: () => store } }))
let changed: (event: EditorTransferEvent) => void = () => {}
const api = { pendingTransfers: vi.fn(), getTransfer: vi.fn(), onTransferChanged: vi.fn((callback: typeof changed) => { changed = callback; return () => {} }) }
const record: EditorTransferRecord = { direction: 'return', workspaceId: 'w', panelId: 'panel', editorId: 'editor', editorKey: 'w:editor:novelai-workbench', panelType: 'novelai-workbench', title: 'work', transferId: 'transfer-1', sequence: 1, phase: 'waiting', committedRevision: 3, expiresAt: 10_000 }
function Incoming() { const transfers = useIncomingEditorTransfers(); return <output aria-label='incoming'>{JSON.stringify(Object.values(transfers))}</output> }
function Popout() { const transfer = useTransferredEditorRecord(record.transferId); return <output aria-label='phase'>{transfer?.phase}</output> }
function Notifications() {
  const [toast, setToast] = React.useState<React.ComponentProps<typeof Toast> | null>(null)
  React.useEffect(() => {
    const receive = (event: Event) => setToast({ ...(event as CustomEvent).detail, onClose: () => {} })
    window.addEventListener('grimoire:toast', receive)
    return () => window.removeEventListener('grimoire:toast', receive)
  }, [])
  return toast ? <Toast {...toast} /> : null
}
beforeEach(() => { vi.clearAllMocks(); store.activeWorkspaceId = 'w'; store.maximizedPanels = {}; api.pendingTransfers.mockResolvedValue([]); api.getTransfer.mockResolvedValue(record); Object.assign(window, { api: { workspace: api } }) })
afterEach(() => cleanup())
const incoming = () => JSON.parse(screen.getByLabelText('incoming').textContent!) as EditorTransferRecord[]

describe('W2 directed transfer snapshots', () => {
  it('renders the real recovery notification without crashing the restored application', async () => {
    render(<><Incoming /><Notifications /></>); await act(async () => {})
    act(() => changed({ role: 'target', transfer: { ...record, phase: 'committed', recovery: 'persisted-after-crash' } }))
    expect(screen.getByText('独立窗口已停止，已恢复最后保存的草稿。').closest('[role=status]')).not.toBeNull()
  })
  it('does not resurrect a completed return when an earlier pending query finishes late', async () => {
    let finish!: (value: EditorTransferRecord[]) => void
    api.pendingTransfers.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<Incoming />)
    act(() => changed({ role: 'target', transfer: { ...record, phase: 'committed' } }))
    await act(async () => finish([record]))
    expect(incoming()).toEqual([])
  })

  it('never regresses a received phase and isolates identical panel IDs in separate workspaces', async () => {
    render(<Incoming />); await act(async () => {})
    act(() => changed({ role: 'target', transfer: { ...record, phase: 'ready' } }))
    act(() => changed({ role: 'target', transfer: record }))
    expect(incoming()[0].phase).toBe('ready')
    act(() => changed({ role: 'target', transfer: { ...record, workspaceId: 'other', editorKey: 'other:editor:novelai-workbench', transferId: 'other-transfer' } }))
    expect(incoming()).toHaveLength(2)
  })

  it('does not let a late terminal event remove a newer transfer for the same panel', async () => {
    render(<Incoming />); await act(async () => {})
    const newer = { ...record, transferId: 'newer', sequence: 2, expiresAt: 20_000 }
    act(() => changed({ role: 'target', transfer: newer }))
    act(() => changed({ role: 'target', transfer: { ...record, phase: 'aborted' } }))
    expect(incoming()).toEqual([newer])
  })

  it('mounts an incoming return by leaving another maximized panel, and restores it on abort', async () => {
    store.maximizedPanels.w = 'other-panel'
    render(<Incoming />); await act(async () => {})
    act(() => changed({ role: 'target', transfer: record }))
    expect(store.setMaximizedPanel).toHaveBeenCalledWith('w', null)
    act(() => changed({ role: 'target', transfer: { ...record, phase: 'aborted' } }))
    expect(store.setMaximizedPanel).toHaveBeenLastCalledWith('w', 'other-panel')
  })

  it('does not roll back a popout terminal event with a delayed initial GET', async () => {
    let finish!: (value: EditorTransferRecord) => void
    api.getTransfer.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<Popout />)
    act(() => changed({ role: 'target', transfer: { ...record, phase: 'committed' } }))
    await act(async () => finish(record))
    expect(screen.getByLabelText('phase').textContent).toBe('committed')
  })
})
