import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDatabase, getResourceRoot, saveDatabase } from '../database'
import type { AiAttachmentRecord } from '../../shared/ai-types'
import { cleanupOwnedCopies, copyFinalizationFailure, OwnedCopyCleanupError, type OwnedCopyCleanupResult } from './owned-copy-cleanup'

export const AI_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024
export const AI_MESSAGE_MAX_ATTACHMENTS = 10
export const AI_MESSAGE_MAX_TOTAL_BYTES = 200 * 1024 * 1024

function json(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function rowToAttachment(row: unknown[]): AiAttachmentRecord {
  return {
    id: String(row[0]),
    session_id: String(row[1]),
    message_id: row[2] == null ? null : String(row[2]),
    source_type: String(row[3] || 'file') as AiAttachmentRecord['source_type'],
    file_path: String(row[4] || ''),
    original_name: String(row[5] || ''),
    mime_type: String(row[6] || 'application/octet-stream'),
    size: Number(row[7] || 0),
    sha256: String(row[8] || ''),
    status: String(row[9] || 'available') as AiAttachmentRecord['status'],
    metadata: json(row[10]),
    created_at: String(row[11] || ''),
    updated_at: String(row[12] || ''),
  }
}

function attachmentRoot() {
  const root = path.join(getResourceRoot(), 'ai-attachments')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function hashFile(filePath: string) {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  return new Promise<{ sha256: string; size: number }>((resolve, reject) => {
    let size = 0
    stream.on('data', (chunk: Buffer) => { size += chunk.length; hash.update(chunk) })
    stream.once('error', reject)
    stream.once('end', () => resolve({ sha256: hash.digest('hex'), size }))
  })
}

export function listAiAttachments(sessionId: string): AiAttachmentRecord[] {
  return (getDatabase().exec('SELECT id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at FROM ai_attachments WHERE session_id=? ORDER BY created_at ASC', [sessionId])[0]?.values || []).map(rowToAttachment)
}

export function getAiAttachment(id: string): AiAttachmentRecord | null {
  const row = getDatabase().exec('SELECT id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at FROM ai_attachments WHERE id=?', [id])[0]?.values?.[0]
  return row ? rowToAttachment(row) : null
}

/**
 * Copies a file into Grimoire's attachment store.
 *
 * `sessionId: null` stores a LIBRARY file — content Grimoire owns that belongs to no
 * conversation (the Files page's upload). It is a real NULL rather than a sentinel session id:
 * the column carries `FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE`, so
 * a made-up id is rejected outright, and one that happened to exist would have the file DELETED
 * whenever that session was. Schema v31 makes the column nullable for exactly this case.
 *
 * The dedupe below keys on `(session_id, sha256)`, so library rows dedupe among themselves and
 * never collide with a conversation's attachment of the same content.
 */
export async function importAiAttachment(input: { sessionId: string | null; filePath: string; sourceType?: AiAttachmentRecord['source_type']; messageId?: string | null }): Promise<AiAttachmentRecord> {
  const source = path.resolve(input.filePath)
  const stat = await fs.promises.stat(source)
  if (!stat.isFile()) throw new Error('附件不是文件')
  if (stat.size > AI_ATTACHMENT_MAX_BYTES) throw new Error('单个附件不能超过 100MB')
  const digest = await hashFile(source)
  const existingRows = getDatabase().exec('SELECT id,file_path,mime_type,original_name,size,status FROM ai_attachments WHERE sha256=? AND status<>\'deleted\' ORDER BY created_at ASC LIMIT 1', [digest.sha256])[0]?.values || []
  const existing = existingRows[0]
  if (existing && String(existing[0])) {
    // `IS` rather than `=` so a NULL session matches a NULL session (SQL's `= NULL` matches
    // nothing, which would silently duplicate every library upload).
    const existingSession = getDatabase().exec("SELECT id FROM ai_attachments WHERE session_id IS ? AND sha256=? AND status<>'deleted' LIMIT 1", [input.sessionId, digest.sha256])[0]?.values?.[0]?.[0]
    if (existingSession) return getAiAttachment(String(existingSession))!
  }

  const now = new Date().toISOString()
  const id = 'ai_attachment_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const target = existing && fs.existsSync(String(existing[1])) ? String(existing[1]) : path.join(attachmentRoot(), id + path.extname(source).toLowerCase())
  if (!existing || target !== String(existing[1])) await fs.promises.copyFile(source, target)
  const mimeByExtension: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv' }
  const mimeType = String(existing?.[2] || mimeByExtension[path.extname(source).toLowerCase()] || 'application/octet-stream')
  const sourceType = input.sourceType || (mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('image/') ? 'image' : 'file')
  getDatabase().run('INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, input.sessionId, input.messageId || null, sourceType, target, path.basename(source), mimeType, digest.size, digest.sha256, 'available', '{}', now, now])
  saveDatabase()
  return getAiAttachment(id)!
}

export function linkAiAttachment(id: string, messageId: string): AiAttachmentRecord {
  const attachment = getAiAttachment(id)
  if (!attachment) throw new Error('附件不存在')
  getDatabase().run('UPDATE ai_attachments SET message_id=?,updated_at=? WHERE id=?', [messageId, new Date().toISOString(), id])
  saveDatabase()
  return getAiAttachment(id)!
}

export function cleanupAiAttachmentCopies(ids: readonly string[]): OwnedCopyCleanupResult {
  const removing = new Set(ids)
  const attachments = [...removing].map(getAiAttachment).filter((item): item is AiAttachmentRecord => item !== null && item.status !== 'deleted')
  const copies = attachments.map(attachment => {
    const live = getDatabase().exec("SELECT id FROM ai_attachments WHERE file_path=? AND status<>'deleted'", [attachment.file_path])[0]?.values || []
    return { id: attachment.id, filePath: attachment.file_path, retained: live.some(row => !removing.has(String(row[0]))) }
  })
  return cleanupOwnedCopies(copies, 'ai-attachments', 'unlink')
}

export function deleteAiAttachment(id: string): boolean {
  const db = getDatabase()
  let cleanup: OwnedCopyCleanupResult | undefined
  db.exec('BEGIN IMMEDIATE')
  try {
    if (!getAiAttachment(id)) { db.exec('COMMIT'); return false }
    cleanup = cleanupAiAttachmentCopies([id])
    if (cleanup.status !== 'completed') throw new OwnedCopyCleanupError('AI_ATTACHMENT_CLEANUP_FAILED', cleanup)
    db.run("UPDATE ai_attachments SET status='deleted',updated_at=? WHERE id=?", [new Date().toISOString(), id])
    db.exec('COMMIT')
    saveDatabase()
    return true
  } catch (error) {
    try { db.exec('ROLLBACK') } catch (rollbackError) { console.debug('[attachments] rollback settled', rollbackError) }
    if (cleanup && !(error instanceof OwnedCopyCleanupError)) throw new OwnedCopyCleanupError('AI_ATTACHMENT_DELETE_DB_FAILED', copyFinalizationFailure(cleanup, error, id))
    throw error
  }
}

export async function readAiAttachment(id: string): Promise<{ id: string; mimeType: string; originalName: string; status: AiAttachmentRecord['status']; dataUrl?: string; text?: string }> {
  const attachment = getAiAttachment(id)
  if (!attachment) throw new Error('附件不存在')
  if (attachment.status === 'deleted' || !attachment.file_path || !fs.existsSync(attachment.file_path)) {
    if (attachment.status === 'available') {
      getDatabase().run('UPDATE ai_attachments SET status=\'missing\',updated_at=? WHERE id=?', [new Date().toISOString(), id])
      saveDatabase()
    }
    return { id, mimeType: attachment.mime_type, originalName: attachment.original_name, status: attachment.status === 'deleted' ? 'deleted' : 'missing' }
  }
  const common = { id, mimeType: attachment.mime_type, originalName: attachment.original_name, status: 'available' as const }
  if (attachment.mime_type.startsWith('text/') || attachment.mime_type === 'application/json' || attachment.mime_type === 'text/markdown') {
    const text = await fs.promises.readFile(attachment.file_path, 'utf8')
    return { ...common, text: text.slice(0, 2 * 1024 * 1024) }
  }
  const data = await fs.promises.readFile(attachment.file_path)
  return { ...common, dataUrl: 'data:' + attachment.mime_type + ';base64,' + data.toString('base64') }
}
