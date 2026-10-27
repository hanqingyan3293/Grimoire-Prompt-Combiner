import fs from 'fs'
import path from 'path'
import { getDatabase, saveDatabase } from '../database'
import { importAiAttachment } from './ai-attachment.service'
import { cherryFileTypeForExtension } from './cherry-file-type-map.generated'

/**
 * The source `file.*` IPC routes the Files page calls, backed by Grimoire's real stores.
 *
 * WHY THESE LIVE IN MAIN: every one of them either reads the filesystem (`fs.stat`) or mutates a
 * file. The source documents the same split — DataApi stays SQL-only, and anything needing
 * filesystem IO or a mutation goes through File IPC. The renderer never touches a path.
 *
 * The source distinguishes two cases that this service must keep distinct:
 *
 *  - **internal** entries (`ai_attachments`) — Grimoire COPIED the content into its attachment
 *    root. It owns the bytes, so it can rename, trash and delete them.
 *  - **external** entries (`image_refs`) — Grimoire only references a path the user owns. It must
 *    NOT delete or rename those files; the source's own DB CHECK (`fe_external_no_delete`)
 *    enforces that external rows cannot be trashed, and the same rule is applied here in code.
 *
 * Trash/restore is deliberately NOT implemented. Grimoire has no file trash, so `file.batch_trash`
 * answers a typed NOT_IMPLEMENTED error rather than moving files somewhere the app cannot bring
 * them back from — a half-built trash is worse than an honest gap, because the source UI offers
 * 恢复 and 永久删除 on it.
 */

export type FileBatchMutationResult = {
  succeeded: string[]
  failed: { id: string; error: string }[]
}

export type FileCreateResult = {
  succeeded: { id: string; sourceRef: string }[]
  failed: { sourceRef: string; error: string }[]
}

/** `'attachment:<id>'` / `'image_ref:<n>'` → the table it came from and its raw id. */
export function parseLibraryEntryId(entryId: string): { table: 'ai_attachments' | 'image_refs' | null; rawId: string } {
  const text = String(entryId || '')
  if (text.startsWith('attachment:')) return { table: 'ai_attachments', rawId: text.slice('attachment:'.length) }
  if (text.startsWith('image_ref:')) return { table: 'image_refs', rawId: text.slice('image_ref:'.length) }
  return { table: null, rawId: text }
}

/** The on-disk path behind a library entry, or `null` when it has none. */
export function resolveEntryPath(entryId: string): string | null {
  const { table, rawId } = parseLibraryEntryId(entryId)
  const db = getDatabase()
  if (table === 'ai_attachments') {
    const row = db.exec("SELECT file_path FROM ai_attachments WHERE id=? AND status<>'deleted'", [rawId])[0]?.values?.[0]
    return row && row[0] ? String(row[0]) : null
  }
  if (table === 'image_refs') {
    const row = db.exec('SELECT file_path FROM image_refs WHERE id=?', [Number(rawId)])[0]?.values?.[0]
    return row && row[0] ? String(row[0]) : null
  }
  return null
}

/**
 * Source `PhysicalFileMetadata` for a path, or `null` when nothing is there.
 *
 * `type` comes from the GENERATED source map, not `file-bridge.service`'s smaller table: the page
 * groups rows by the source table, so a `.rb` file reported as `other` here would disagree with
 * the 文本 group it is displayed under. `mime` is derived from `type` for the same reason.
 */
export function physicalFileMetadata(inputPath: string): Record<string, unknown> | null {
  const target = path.resolve(String(inputPath || ''))
  if (!target) return null
  let stat: fs.Stats
  try { stat = fs.statSync(target) } catch { return null }

  if (stat.isDirectory()) {
    return { kind: 'directory', size: stat.size, createdAt: stat.birthtimeMs, modifiedAt: stat.mtimeMs }
  }
  if (!stat.isFile()) return null

  const ext = path.extname(target).toLowerCase()
  const type = cherryFileTypeForExtension(ext)
  const mime = MIME_BY_TYPE[type] ?? 'application/octet-stream'
  return { kind: 'file', size: stat.size, createdAt: stat.birthtimeMs, modifiedAt: stat.mtimeMs, mime, type }
}

/**
 * A coarse mime per TYPE rather than per extension.
 *
 * The source derives mime from the extension through a large table it keeps in main. Grimoire's
 * `MIME_BY_EXTENSION` covers the common formats and falls back to `application/octet-stream` —
 * which the page renders as a generic icon, not as a claim about the format. Only the types the
 * page actually branches on are distinguished here.
 */
const MIME_BY_TYPE: Record<string, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  text: 'text/plain',
  document: 'application/octet-stream',
  other: 'application/octet-stream'
}

/** Source `file.batch_get_metadata` — keyed by the caller's own key, unresolvable entries `null`. */
export function batchGetMetadata(items: { key: string; handle: { kind?: string; path?: string; entryId?: string } }[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.key || '')
    if (!key) continue
    const handle = item?.handle || {}
    // The source `FileHandle` is by-path or by-entry-id; both appear in the Files page.
    const target = handle.kind === 'entry' || handle.entryId
      ? resolveEntryPath(String(handle.entryId || ''))
      : String(handle.path || '')
    result[key] = target ? physicalFileMetadata(target) : null
  }
  return result
}

/** Source `file.batch_get_physical_paths`. */
export function batchGetPhysicalPaths(ids: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id)
    const target = resolveEntryPath(key)
    // A referenced path that no longer exists reports `null`: the source's dangling-state route
    // is what tells the UI it is missing, and reporting a stale path here would claim presence.
    result[key] = target && fs.existsSync(target) ? target : null
  }
  return result
}

/**
 * Source `file.batch_get_dangling_states`.
 *
 * `present` / `missing` / `unknown`. Internal entries are ALWAYS `present` — Grimoire wrote the
 * content itself and its absence is a `missing` attachment, not a dangling reference. External
 * rows are `present` when the path resolves and `missing` otherwise; `unknown` is reserved for
 * "no observation", which for a synchronous `existsSync` never happens, so it is not returned
 * rather than being used as a catch-all.
 */
export function batchGetDanglingStates(ids: string[]): Record<string, 'present' | 'missing' | 'unknown'> {
  const result: Record<string, 'present' | 'missing' | 'unknown'> = {}
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id)
    const { table } = parseLibraryEntryId(key)
    const target = resolveEntryPath(key)
    if (!target) { result[key] = 'missing'; continue }
    result[key] = fs.existsSync(target) ? 'present' : 'missing'
    // An attachment row whose file is gone is still "internal content that was deleted out from
    // under us" — the row stays authoritative and the UI shows a missing state.
    void table
  }
  return result
}

const MAX_CREATE_BYTES = 100 * 1024 * 1024

/**
 * Source `file.batch_create_internal_entries` for the `source: 'path'` arm.
 *
 * The page's upload path calls this with absolute paths it obtained from a real file picker or
 * drop. Grimoire COPIES the content into its attachment root (the same operation the composer's
 * attachment import performs), because `origin: 'internal'` means Grimoire owns the bytes —
 * referencing the user's original path would make the entry external and silently change which
 * arm of the union it lands in.
 *
 * The `url` / `base64` / `bytes` arms are NOT implemented: the Files page only ever sends `path`,
 * and accepting the others would mean guessing download-and-store semantics nobody has specified.
 * They fail per item so one unsupported entry cannot fail the whole batch.
 */
export async function batchCreateInternalEntries(
  items: { source?: string; path?: string; cleanupPolicy?: string }[]
): Promise<FileCreateResult> {
  const succeeded: { id: string; sourceRef: string }[] = []
  const failed: { sourceRef: string; error: string }[] = []

  for (const item of Array.isArray(items) ? items : []) {
    const sourceRef = String(item?.path || '')
    if (item?.source !== 'path') {
      failed.push({ sourceRef: sourceRef || String(item?.source || '?'), error: '仅支持 source=path（url/base64/bytes 未实现）' })
      continue
    }
    try {
      const stat = await fs.promises.stat(path.resolve(sourceRef))
      if (!stat.isFile()) throw new Error('不是文件')
      if (stat.size > MAX_CREATE_BYTES) throw new Error('单个文件不能超过 100MB')

      // REUSES the composer's attachment import rather than copying the file a second way. It
      // already does the content copy, the sha256 digest, the dedupe and the mime resolution; a
      // parallel implementation here would drift from it and produce two kinds of "internal" row.
      //
      // `sessionId: null` = a library file. The first live run of this path failed with
      // `FOREIGN KEY constraint failed` because it passed a sentinel session id that does not
      // exist in `ai_sessions` — schema v31 makes the column nullable so a REAL null is possible.
      const record = await importAiAttachment({ sessionId: null, filePath: sourceRef, sourceType: 'file' })
      succeeded.push({ id: 'attachment:' + record.id, sourceRef })
    } catch (error) {
      failed.push({ sourceRef, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { succeeded, failed }
}

/**
 * Source `file.rename`: renames an INTERNAL entry's stored file and its display name.
 *
 * External entries are rejected rather than renamed. The source models an external entry's `name`
 * as a pure projection of `externalPath` (basename), so renaming one means renaming the user's
 * own file on disk — a destructive act on a path Grimoire only references. The source's own
 * component does not offer rename for external rows.
 */
export async function renameEntry(entryId: string, newName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { table, rawId } = parseLibraryEntryId(entryId)
  if (table !== 'ai_attachments') {
    return { ok: false, error: table === 'image_refs' ? '外部引用文件不能重命名（会改到用户自己的文件）' : '未知条目：' + entryId }
  }
  const safeName = String(newName || '').trim()
  if (!safeName || /[\\/:*?"<>|]/.test(safeName)) return { ok: false, error: '文件名无效' }

  const row = getDatabase().exec("SELECT file_path FROM ai_attachments WHERE id=? AND status<>'deleted'", [rawId])[0]?.values?.[0]
  const current = row && row[0] ? String(row[0]) : ''
  if (!current) return { ok: false, error: '文件不存在：' + entryId }

  // Rename on disk only when the content still exists; a missing file still gets its stored name
  // updated so the library reflects what the user asked for.
  const ext = path.extname(current)
  const nextPath = path.join(path.dirname(current), safeName + ext)
  if (fs.existsSync(current)) {
    try { await fs.promises.rename(current, nextPath) }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }
  getDatabase().run('UPDATE ai_attachments SET original_name=?,file_path=?,updated_at=? WHERE id=?', [safeName + ext, nextPath, new Date().toISOString(), rawId])
  saveDatabase()
  return { ok: true }
}

/**
 * Source `file.batch_remove_from_library`: drops the LIBRARY ENTRY, never the user's file.
 *
 * For an internal entry this deletes Grimoire's own copy (Grimoire owns those bytes). For an
 * external entry it removes only the reference — the user's file on disk is untouched, which is
 * the entire meaning of "external".
 */
export function batchRemoveFromLibrary(ids: string[]): FileBatchMutationResult {
  const succeeded: string[] = []
  const failed: { id: string; error: string }[] = []
  const db = getDatabase()

  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id)
    const { table, rawId } = parseLibraryEntryId(key)
    if (table === 'ai_attachments') {
      const row = db.exec('SELECT file_path FROM ai_attachments WHERE id=?', [rawId])[0]?.values?.[0]
      const target = row && row[0] ? String(row[0]) : ''
      db.run("UPDATE ai_attachments SET status='deleted',updated_at=? WHERE id=?", [new Date().toISOString(), rawId])
      // Only unlink when no other live row still points at the same content.
      //
      // SYNCHRONOUS on purpose. The first version used `fs.promises.unlink(...)` without awaiting
      // it, so the call returned before the file was gone: a caller (or a test) that checked
      // immediately saw the file still there, and any process exit in that window leaked it. The
      // whole batch is short, and "removed from the library" must mean the bytes are gone by the
      // time this returns.
      const shared = Number(db.exec("SELECT count(*) FROM ai_attachments WHERE file_path=? AND status<>'deleted'", [target])[0]?.values?.[0]?.[0] || 0)
      if (target && shared === 0 && fs.existsSync(target)) {
        try { fs.unlinkSync(target) } catch { /* a locked file must not fail the library update */ }
      }
      succeeded.push(key)
      continue
    }
    if (table === 'image_refs') {
      // Reference only. The file on disk stays exactly where it is.
      db.run('DELETE FROM image_refs WHERE id=?', [Number(rawId)])
      succeeded.push(key)
      continue
    }
    failed.push({ id: key, error: '未知条目' })
  }

  saveDatabase()
  return { succeeded, failed }
}
