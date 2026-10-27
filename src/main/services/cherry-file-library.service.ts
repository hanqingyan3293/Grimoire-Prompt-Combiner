import path from 'path'
import { getDatabase } from '../database'
import { cherryFileTypeForExtension } from './cherry-file-type-map.generated'

/**
 * The source `/files/entries` file library, projected from Grimoire's two real file stores.
 *
 * WHY A PROJECTION AND NOT A NEW TABLE: the source keeps one flat `fileEntries` table where a
 * row is a managed file (Cherry-owned content under `Data/Files/`) or a reference to a
 * user-provided path. Grimoire already has both kinds of file, in two places, and neither is a
 * copy of the other:
 *
 *  - `ai_attachments` — files Grimoire COPIED into its own attachment root at import time. This
 *    is the source's `origin: 'internal'` arm: Grimoire owns the content, so `size` is
 *    authoritative and a sha256 exists.
 *  - `image_refs` — paths into the user's own library that Grimoire only REFERENCES
 *    (`storage_mode = 'external'`). This is the source's `origin: 'external'` arm: the file can
 *    change or vanish outside the app, so no size snapshot is kept.
 *
 * Adding a third table would create a second truth for the same files and a synchronization
 * problem nobody asked for. The union is derived on read.
 *
 * WHAT IS **NOT** FABRICATED: the source's library is a superset of both stores. It also carries
 * `cleanupPolicy` (GC intent), `contentHash` for externals, per-entry trash (`deletedAt`) for
 * internal rows, and persistent ref counts. Grimoire stores none of those, so:
 *
 *  - `cleanupPolicy` is reported as `'manual'` for internal rows — the value that means "do not
 *    garbage-collect", which is TRUE of every attachment Grimoire holds (nothing in Grimoire
 *    ever reclaims an attachment; deletion is explicit).
 *  - `contentHash` is `null` for externals (the source documents null as "unknown", and Grimoire
 *    genuinely does not know) and `sha256:<hex>` for internals where a digest was recorded.
 *  - `deletedAt` is omitted entirely. `ai_attachments.status = 'deleted'` is a soft delete, but it
 *    is Grimoire's own column with Grimoire semantics; mapping it onto the source's trash would
 *    claim a trash+restore round trip the source UI would then offer and Grimoire cannot honour.
 *    Deleted attachments are EXCLUDED instead, matching the live list.
 *  - `total` counts the same filtered set the page returned.
 *
 * Sorting mirrors the source's supported keys. `size` sorting is only meaningful for internal rows
 * (externals have no stored size), exactly as the source documents, so external rows sort last
 * under a size sort rather than being assigned a fabricated 0.
 */

/** Source `FileEntryId` — opaque in Grimoire, but stable and unique across both arms. */
export type FileLibraryOrigin = 'internal' | 'external'

export type FileLibraryEntry =
  | {
      id: string
      name: string
      ext: string | null
      origin: 'internal'
      size: number
      contentHash: string | null
      cleanupPolicy: 'manual'
      createdAt: number
      updatedAt: number
    }
  | {
      id: string
      name: string
      ext: string | null
      origin: 'external'
      externalPath: string
      cleanupPolicy: 'manual'
      createdAt: number
      updatedAt: number
    }

/** The source `FileType` union, as `file-bridge.service` already reports it. */
export type FileLibraryTypeFilter = 'image' | 'video' | 'audio' | 'text' | 'document' | 'other'

export type FileLibraryQuery = {
  origin?: FileLibraryOrigin
  /**
   * The source's `fileType` filter — the Files sidebar's 类型 column.
   *
   * It MUST be honoured: the page sends it whenever a type filter is active, and ignoring it
   * would return the whole library under a narrowing filter, which reads as "this filter is
   * broken" rather than as a missing feature. The extension→type table is the one
   * `file-bridge.service` already uses (`fileTypeForExtension`), so the page's column grouping
   * and this filter cannot disagree.
   */
  fileType?: FileLibraryTypeFilter
  search?: string
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'size' | 'ext'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  cursor?: string
}

export type FileLibraryPage = {
  items: FileLibraryEntry[]
  total: number
  nextCursor?: string
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** `'image/png'` → `'png'`; entries with no extension report `null`, matching the source. */
export function extensionOf(name: string): string | null {
  const ext = path.extname(String(name || '')).replace(/^\./, '').toLowerCase()
  return ext || null
}

/** `'photo.png'` → `'photo'` — the source `name` is the stem, with `ext` carried separately. */
function nameWithoutExtension(name: string): string {
  const raw = String(name || '')
  const ext = path.extname(raw)
  return ext ? raw.slice(0, -ext.length) : raw
}

/** `'sha256:ab12…'` → the source `ContentHash` tag form, or `null` when no digest was recorded. */
function contentHashOf(sha256: string): string | null {
  const hex = String(sha256 || '').trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? 'sha256:' + hex : null
}

function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value || '')
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Every entry in both stores, newest first, before filtering.
 *
 * Ids are prefixed by arm (`attachment:` / `image_ref:`) so a route that takes an id can tell
 * which table to look in without a second round trip, and so two rows in different tables can
 * never collide.
 */
export function listFileLibraryEntries(): FileLibraryEntry[] {
  const db = getDatabase()
  const entries: FileLibraryEntry[] = []

  // Every non-deleted attachment is a library entry: the source's library holds BOTH "uploaded
  // from the Files page" and "attached to a conversation" content (a file attached in chat is
  // still a managed file). `session_id` is not a filter here for exactly that reason — only
  // `status='deleted'` removes an entry.
  const attachmentRows = db.exec(
    "SELECT id,original_name,file_path,size,sha256,created_at,updated_at FROM ai_attachments WHERE status<>'deleted'"
  )[0]?.values || []
  for (const row of attachmentRows) {
    const id = 'attachment:' + String(row[0])
    const originalName = String(row[1] || '')
    const filePath = String(row[2] || '')
    entries.push({
      id,
      name: nameWithoutExtension(originalName || path.basename(filePath)),
      ext: extensionOf(originalName || filePath),
      origin: 'internal',
      size: Number(row[3] || 0),
      contentHash: contentHashOf(String(row[4] || '')),
      cleanupPolicy: 'manual',
      createdAt: toEpochMs(row[5]),
      updatedAt: toEpochMs(row[6])
    })
  }

  const imageRows = db.exec(
    'SELECT id,file_path,original_name,mime_type,file_size,created_at FROM image_refs WHERE available=1'
  )[0]?.values || []
  for (const row of imageRows) {
    const filePath = String(row[1] || '')
    const originalName = String(row[2] || '') || path.basename(filePath)
    entries.push({
      id: 'image_ref:' + String(row[0]),
      name: nameWithoutExtension(originalName),
      ext: extensionOf(originalName),
      origin: 'external',
      externalPath: filePath,
      cleanupPolicy: 'manual',
      // `image_refs` records only `created_at`; reporting it as `updatedAt` too would assert an
      // update time Grimoire does not track.
      createdAt: toEpochMs(row[5]),
      updatedAt: toEpochMs(row[5])
    })
  }

  return entries
}

/**
 * Orders two entries for a given sort key, EXCLUDING direction.
 *
 * Size is special: external rows carry no size (by design — the source drops the field rather
 * than snapshotting a value that can drift), so a size comparison has to decide where unsized
 * rows go. They go LAST in both directions, and that "last" is NOT negated by a descending sort:
 *
 *   - The source gives external rows a null sentinel rather than a fabricated 0; treating them
 *     as 0 would claim every external file is empty.
 *   - If direction flipped their position, a DESCENDING size sort would open with all the rows
 *     whose size is unknown — which reads as "these are your largest files". That is worse than
 *     an unsorted tail: it is actively misleading.
 *
 * So the sized/unsized split is resolved here, direction-independently, and only the comparison
 * WITHIN the sized group is subject to the caller's direction.
 */
function compareEntries(a: FileLibraryEntry, b: FileLibraryEntry, sortBy: NonNullable<FileLibraryQuery['sortBy']>): number {
  if (sortBy === 'name') return a.name.localeCompare(b.name)
  if (sortBy === 'ext') return String(a.ext ?? '').localeCompare(String(b.ext ?? ''))
  if (sortBy === 'size') {
    const aSized = a.origin === 'internal'
    const bSized = b.origin === 'internal'
    if (aSized !== bSized) return aSized ? -1 : 1
    if (!aSized || !bSized) return 0
    return a.size - b.size
  }
  const key = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt'
  return a[key] - b[key]
}

/** True when the pair straddles the sized/unsized line, where direction must NOT be applied. */
function isOriginSplit(a: FileLibraryEntry, b: FileLibraryEntry, sortBy: NonNullable<FileLibraryQuery['sortBy']>): boolean {
  return sortBy === 'size' && (a.origin === 'internal') !== (b.origin === 'internal')
}

/**
 * One page of the library.
 *
 * Cursor paging uses `(sortValue, id)` keyset ordering rather than OFFSET: the two stores are
 * merged in memory, and an OFFSET over a list that changes between pages silently repeats or
 * skips rows. The cursor is opaque base64 of that pair.
 */
export function queryFileLibrary(query: FileLibraryQuery = {}): FileLibraryPage {
  const sortBy = query.sortBy || 'createdAt'
  const descending = (query.sortOrder || 'desc') === 'desc'
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)

  let items = listFileLibraryEntries()

  if (query.origin === 'internal' || query.origin === 'external') {
    items = items.filter(entry => entry.origin === query.origin)
  }
  if (query.fileType) {
    const wanted = query.fileType
    // Uses the map the SOURCE derives, not `file-bridge.service`'s smaller table: the page's
    // 类型 column comes from the source's `getFileTypeByExt`, so filtering with a different table
    // would list a row under one type and then hide it when that type is selected. Measured
    // before the switch: the bridge table classified ~30 extensions as text where the source
    // has 1,436, so `.rb`/`.swift`/`.kt` and hundreds more would have vanished under 文本.
    items = items.filter(entry => cherryFileTypeForExtension(entry.ext) === wanted)
  }
  const search = String(query.search || '').trim().toLowerCase()
  if (search) {
    items = items.filter(
      entry =>
        entry.name.toLowerCase().includes(search) ||
        String(entry.ext || '').includes(search) ||
        (entry.origin === 'external' && entry.externalPath.toLowerCase().includes(search))
    )
  }

  const total = items.length
  items.sort((a, b) => {
    // The origin split is direction-independent — see `compareEntries`.
    if (isOriginSplit(a, b, sortBy)) return a.origin === 'internal' ? -1 : 1
    const delta = compareEntries(a, b, sortBy)
    // Tie-break on id so the order is TOTAL: equal sort values would otherwise let two pages
    // disagree about which rows came first, and keyset paging would skip or repeat them.
    return (delta !== 0 ? delta : a.id.localeCompare(b.id)) * (descending ? -1 : 1)
  })

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor)
    if (decoded) {
      const index = items.findIndex(entry => entry.id === decoded)
      // A cursor whose row is gone (deleted between pages) resumes at the next surviving row of
      // the same ordering rather than restarting the list.
      if (index !== -1) items = items.slice(index + 1)
    }
  }

  const page = items.slice(0, limit)
  const hasMore = items.length > page.length
  return {
    items: page,
    total,
    ...(hasMore && page.length ? { nextCursor: encodeCursor(page[page.length - 1].id) } : {})
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8')
    return decoded || null
  } catch {
    return null
  }
}

/** Source `FileEntryStats`: live/trash totals plus the per-extension counts the sidebar reads. */
export function fileLibraryStats(): {
  activeTotal: number
  trashTotal: number
  extCounts: { ext: string | null; count: number }[]
} {
  const entries = listFileLibraryEntries()
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = entry.ext ?? ''
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return {
    activeTotal: entries.length,
    // Grimoire has no separate trash for files; `deleted` attachments are excluded from the live
    // list and are not restorable, so reporting them as trash would promise a restore the app
    // cannot perform.
    trashTotal: 0,
    extCounts: [...counts.entries()]
      .map(([ext, count]) => ({ ext: ext || null, count }))
      .sort((a, b) => b.count - a.count)
  }
}

/** One entry by its prefixed id, or `null`. */
export function findFileLibraryEntry(id: string): FileLibraryEntry | null {
  return listFileLibraryEntries().find(entry => entry.id === id) || null
}
