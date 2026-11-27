import { useEffect, useMemo, useState } from 'react'
import type { EditorTransferRecord } from '../../../shared/editor-transfer'
import { useWorkspaceStore } from '../../stores/workspace.store'

export const editorTransferPanelKey = (workspaceId: string, panelId: string) => JSON.stringify([workspaceId, panelId])
const terminal = (record: EditorTransferRecord) => record.phase === 'aborted' || record.phase === 'committed'
const phaseOrder = { waiting: 0, ready: 1, transferred: 2, committed: 3, aborted: 3 }
/** Read responses and pushed events share a monotonic ledger; neither can resurrect a terminal move. */
class TransferLedger {
  private records = new Map<string, EditorTransferRecord>()
  private panels = new Map<string, EditorTransferRecord>()
  accept(record: EditorTransferRecord): boolean {
    const previous = this.records.get(record.transferId)
    if (previous && (terminal(previous) || phaseOrder[record.phase] <= phaseOrder[previous.phase])) return false
    const key = editorTransferPanelKey(record.workspaceId, record.panelId)
    const latest = this.panels.get(key)
    if (latest && latest.transferId !== record.transferId && latest.sequence > record.sequence) return false
    this.records.set(record.transferId, record); this.panels.set(key, record)
    const ended = [...this.records.entries()].filter(([, value]) => terminal(value))
    for (const [id] of ended.slice(0, Math.max(0, ended.length - 128))) this.records.delete(id)
    return true
  }
}

export function useIncomingEditorTransfers(): Record<string, EditorTransferRecord> {
  const [transfers, setTransfers] = useState<Record<string, EditorTransferRecord>>({})
  const ledger = useMemo(() => new TransferLedger(), [])
  useEffect(() => {
    let alive = true
    const previousMaximized = new Map<string, { workspaceId: string; panelId: string }>()
    const receive = (record: EditorTransferRecord) => {
      if (!alive || record.direction !== 'return' || !ledger.accept(record)) return
      const store = useWorkspaceStore.getState()
      if (!terminal(record)) {
        if (store.activeWorkspaceId !== record.workspaceId) store.setActiveWorkspace(record.workspaceId)
        const maximized = store.maximizedPanels[record.workspaceId]
        if (maximized && maximized !== record.panelId) { previousMaximized.set(record.transferId, { workspaceId: record.workspaceId, panelId: maximized }); store.setMaximizedPanel(record.workspaceId, null) }
      }
      if (record.phase === 'committed') {
        useWorkspaceStore.getState().setPopoutPanel(record.workspaceId, record.panelId, false)
        if (record.recovery) window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { type: 'info', message: '独立窗口已停止，已恢复最后保存的草稿。' } }))
      }
      if (terminal(record)) {
        const old = previousMaximized.get(record.transferId)
        if (record.phase === 'aborted' && old && !store.maximizedPanels[old.workspaceId]) store.setMaximizedPanel(old.workspaceId, old.panelId)
        previousMaximized.delete(record.transferId)
      }
      const key = editorTransferPanelKey(record.workspaceId, record.panelId)
      setTransfers(previous => {
        if (terminal(record)) { const next = { ...previous }; if (next[key]?.transferId === record.transferId) delete next[key]; return next }
        return { ...previous, [key]: record }
      })
    }
    const unsubscribe = window.api.workspace.onTransferChanged?.(event => { if (event.role === 'target') receive(event.transfer) })
    void window.api.workspace.pendingTransfers?.().then(records => { for (const record of records) receive(record) }).catch(error => console.warn('Pending editor transfers could not be read', error instanceof Error ? error.message : String(error)))
    return () => { alive = false; unsubscribe?.() }
  }, [ledger])
  return transfers
}

export function useTransferredEditorRecord(transferId: string): EditorTransferRecord | null {
  const [record, setRecord] = useState<EditorTransferRecord | null>(null)
  const ledger = useMemo(() => new TransferLedger(), [transferId])
  useEffect(() => {
    if (!transferId) return
    let alive = true
    const receive = (value: EditorTransferRecord | null) => { if (alive && value?.transferId === transferId && ledger.accept(value)) setRecord(value) }
    const unsubscribe = window.api.workspace.onTransferChanged?.(event => { if (event.role === 'target') receive(event.transfer) })
    void window.api.workspace.getTransfer(transferId).then(receive).catch(error => console.warn('Editor transfer state could not be read', error instanceof Error ? error.message : String(error)))
    return () => { alive = false; unsubscribe?.() }
  }, [transferId, ledger])
  return record
}
