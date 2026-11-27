import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"
import { IPC_CHANNELS } from "../../shared/types"
import { getDatabase, saveDatabase } from "../database"
import { requireId } from "../services/input-validation"
import { encodeWorkspaceEditorState, type SaveWorkspaceEditorStateResult } from "../../shared/workspace-editor-state"
import type { NovelaiEditResource } from "../../shared/novelai-edit-types"
import { novelaiEditSessions, NovelaiEditSessionError, type NovelaiEditOwner } from "../services/novelai-edit-session.service"
import { logEvent } from "../services/logger.service"

type StoredWorkspaceDocument = { workspaceId: string; revision: number; document: unknown }
type SaveWorkspaceDocumentResult = { saved: true; value: StoredWorkspaceDocument } | { saved: false; conflict: true; current: StoredWorkspaceDocument | null }
type StoredEditorState = { editorKey: string; revision: number; state: unknown }
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

function readDocument(workspaceId: string): StoredWorkspaceDocument | null {
  const row = getDatabase().exec("SELECT revision, data_json FROM workspace_documents WHERE workspace_id=?", [workspaceId])[0]?.values?.[0]
  if (!row) return null
  return { workspaceId, revision: Number(row[0]), document: JSON.parse(String(row[1])) }
}

function readEditorState(editorKey: string): StoredEditorState | null {
  const row = getDatabase().exec("SELECT revision, data_json FROM workspace_editor_states WHERE editor_key=?", [editorKey])[0]?.values?.[0]
  return row ? { editorKey, revision: Number(row[0]), state: JSON.parse(String(row[1])) } : null
}

function editInput(event: IpcMainInvokeEvent, raw: unknown): { resource: NovelaiEditResource; owner: NovelaiEditOwner; leaseId: string } {
  if (!raw || typeof raw !== 'object') throw new NovelaiEditSessionError('EDIT_RESOURCE_INVALID', '编辑租约参数无效')
  const input = raw as { resource?: NovelaiEditResource; editorKey?: unknown; leaseId?: unknown }
  if (!input.resource) throw new NovelaiEditSessionError('EDIT_RESOURCE_INVALID', '编辑资源缺失')
  return { resource: input.resource, owner: { kind: 'window', sender: event.sender, editorKey: requireId(input.editorKey, '编辑器状态键') }, leaseId: typeof input.leaseId === 'string' ? input.leaseId : '' }
}
function leaseFailure(error: unknown) {
  return { ok: false as const, code: error instanceof NovelaiEditSessionError ? error.code : 'EDIT_RESOURCE_INVALID', message: error instanceof Error ? error.message : String(error) }
}

export function registerWorkspaceIPC(): void {
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_EDIT_ACQUIRE, async (event, input: unknown) => {
    try { const value = editInput(event, input); return { ok: true, lease: novelaiEditSessions.acquire(value.resource, value.owner) } } catch (error) { return leaseFailure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_EDIT_HEARTBEAT, async (event, input: unknown) => {
    try { const value = editInput(event, input); return { ok: true, lease: novelaiEditSessions.heartbeat(value.resource, value.leaseId, value.owner) } } catch (error) { return leaseFailure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_EDIT_RELEASE, async (event, input: unknown) => {
    try { const value = editInput(event, input); return { ok: true, released: novelaiEditSessions.release(value.resource, value.leaseId, value.owner) } } catch (error) { return leaseFailure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LOAD_DOCUMENT, async (_event, id: unknown) => {
    const workspaceId = requireId(id, "工作区 ID")
    return readDocument(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SAVE_DOCUMENT, async (_event, input: unknown): Promise<SaveWorkspaceDocumentResult> => {
    if (!input || typeof input !== "object") throw new Error("工作区文档无效")
    const value = input as Record<string, unknown>
    const workspaceId = requireId(value.workspaceId, "工作区 ID")
    const expectedRevision = Number(value.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("工作区 revision 无效")
    if (!value.document || typeof value.document !== "object" || Array.isArray(value.document)) throw new Error("工作区文档结构无效")
    const serialized = JSON.stringify(value.document)
    if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) throw new Error("工作区文档超过 5MB 限制")

    const database = getDatabase()
    const current = readDocument(workspaceId)
    const currentRevision = current?.revision || 0
    if (currentRevision !== expectedRevision) return { saved: false, conflict: true, current }

    const nextRevision = currentRevision + 1
    const updatedAt = new Date().toISOString()
    if (current) {
      const result = database.run("UPDATE workspace_documents SET revision=?, data_json=?, updated_at=? WHERE workspace_id=? AND revision=?", [nextRevision, serialized, updatedAt, workspaceId, expectedRevision])
      if (Number(result.changes || 0) !== 1) return { saved: false, conflict: true, current: readDocument(workspaceId) }
    } else {
      database.run("INSERT INTO workspace_documents (workspace_id, revision, data_json, updated_at) VALUES (?,?,?,?)", [workspaceId, nextRevision, serialized, updatedAt])
    }
    saveDatabase()
    const saved: StoredWorkspaceDocument = { workspaceId, revision: nextRevision, document: value.document }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WORKSPACE_DOCUMENT_CHANGED, saved)
    }
    return { saved: true, value: saved }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LOAD_EDITOR_STATE, async (_event, key: unknown) => {
    return readEditorState(requireId(key, "编辑器状态键"))
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE, async (event, input: unknown): Promise<SaveWorkspaceEditorStateResult> => {
    try {
      if (!input || typeof input !== 'object') throw new Error('EDITOR_STATE_INVALID: 编辑器状态参数无效')
      const value = input as Record<string, unknown>
      const editorKey = requireId(value.editorKey, '编辑器状态键')
      const expectedRevision = value.expectedRevision
      if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('EDITOR_REVISION_INVALID: 编辑器状态revision无效')
      const serialized = encodeWorkspaceEditorState(value.state)
      const db = getDatabase(), current = readEditorState(editorKey)
      if ((current?.revision || 0) !== expectedRevision) return { saved: false, conflict: true, current }
      novelaiEditSessions.assertEditorWrite(editorKey, event.sender)
      const revision = expectedRevision + 1, updatedAt = new Date().toISOString()
      if (current) {
        const result = db.run('UPDATE workspace_editor_states SET revision=?, data_json=?, updated_at=? WHERE editor_key=? AND revision=?', [revision, serialized, updatedAt, editorKey, expectedRevision])
        if (Number(result.changes || 0) !== 1) return { saved: false, conflict: true, current: readEditorState(editorKey) }
      } else {
        const result = db.run('INSERT INTO workspace_editor_states (editor_key, revision, data_json, updated_at) VALUES (?,?,?,?) ON CONFLICT(editor_key) DO NOTHING', [editorKey, revision, serialized, updatedAt])
        if (Number(result.changes || 0) !== 1) return { saved: false, conflict: true, current: readEditorState(editorKey) }
      }
      saveDatabase()
      const saved: StoredEditorState = { editorKey, revision, state: JSON.parse(serialized) }
      for (const window of BrowserWindow.getAllWindows()) {
        try { if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WORKSPACE_EDITOR_STATE_CHANGED, saved) }
        catch (error) { logEvent('warn', 'workspace-editor', 'Saved draft broadcast failed', { errorCode: 'EDITOR_BROADCAST_FAILED', context: error instanceof Error ? error.message : String(error), retryable: false }) }
      }
      return { saved: true, value: saved }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof NovelaiEditSessionError ? error.code : message.match(/\bEDITOR_[A-Z_]+/)?.[0] || 'EDITOR_SAVE_FAILED'
      return { saved: false, error: { code, message } }
    }
  })
}
