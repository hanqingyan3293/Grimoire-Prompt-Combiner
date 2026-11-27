import { ipcMain, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { EditorTransferInput, EditorTransferRecord, EditorTransferResult } from '../../shared/editor-transfer'
import { EditorTransferManager, EditorTransferError } from '../services/editor-transfer.service'
import { novelaiEditSessions } from '../services/novelai-edit-session.service'
import { getDatabase } from '../database'
import { logEvent } from '../services/logger.service'

export interface WorkspaceTransferWindows {
  validateSource(owner: WebContents, input: EditorTransferInput): void
  createTarget(record: EditorTransferRecord, source: WebContents, bind: (target: WebContents) => void): void
  closeTarget(owner: WebContents): void
  showTarget(owner: WebContents): void
  editorAccessChanged?(key: string): void
}
export function registerWorkspaceTransferIPC(windows: WorkspaceTransferWindows): EditorTransferManager {
  const manager = new EditorTransferManager({
    revision: key => {
      const row = getDatabase().exec('SELECT revision FROM workspace_editor_states WHERE editor_key=?', [key])[0]?.values?.[0]
      return row ? Number(row[0]) : null
    },
    freeze: (key, owner, id) => novelaiEditSessions.holdTransfer(key, owner, id),
    release: (key, owner, id) => novelaiEditSessions.abortTransfer(key, owner, id),
    move: (key, source, target, id) => novelaiEditSessions.commitTransfer(key, source, target, id),
    activate: (key, source, target, id) => novelaiEditSessions.completeTransfer(key, source, target, id),
    notify: (owner, transfer, role) => {
      try {
        ;(owner as WebContents).send(IPC_CHANNELS.WORKSPACE_TRANSFER_EVENT, { role, transfer })
      } catch (error) { logEvent('warn', 'editor-transfer', 'Editor transfer event could not be delivered', { errorCode: 'EDITOR_TRANSFER_DELIVERY_FAILED', context: error instanceof Error ? error.message : String(error), retryable: false }) }
      windows.editorAccessChanged?.(transfer.editorKey)
    },
    close: owner => windows.closeTarget(owner as WebContents),
    show: owner => windows.showTarget(owner as WebContents),
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_EDITOR_ACCESS, (event, key: string) => novelaiEditSessions.getEditorAccess(key, event.sender))
  const failure = (error: unknown): EditorTransferResult => ({ ok: false, code: error instanceof EditorTransferError || error && typeof error === 'object' && 'code' in error ? String(error.code) : 'EDITOR_TRANSFER_FAILED', message: error instanceof Error ? error.message : String(error) })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_PREPARE, (event, raw: unknown): EditorTransferResult => {
    let prepared: EditorTransferRecord | undefined
    try {
      const input = raw as EditorTransferInput
      windows.validateSource(event.sender, input)
      prepared = manager.prepare(input, event.sender)
      windows.createTarget(prepared, event.sender, target => {
        manager.bindTarget(prepared!.transferId, target)
      })
      return { ok: true, transfer: prepared }
    } catch (error) {
      if (prepared) manager.abort(prepared.transferId, event.sender)
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_GET, (event, id: string) => manager.get(id, event.sender))
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_PENDING, event => manager.pendingFor(event.sender))
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_READY, (event, value: { transferId: string; revision: number }): EditorTransferResult => {
    try { return { ok: true, transfer: manager.ready(value.transferId, event.sender, value.revision) } } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_COMMIT, (event, id: string): EditorTransferResult => {
    try { return { ok: true, transfer: manager.commit(id, event.sender) } } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_FINISH, (event, id: string): EditorTransferResult => {
    try { return { ok: true, transfer: manager.complete(id, event.sender) } } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_TRANSFER_ABORT, (event, id: string): EditorTransferResult => {
    try { return { ok: true, transfer: manager.abort(id, event.sender) } } catch (error) { return failure(error) }
  })
  return manager
}
