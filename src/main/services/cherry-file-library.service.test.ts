import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createLegacyDatabase } from './sqlite.compat'
import {
  extensionOf,
  fileLibraryStats,
  findFileLibraryEntry,
  listFileLibraryEntries,
  queryFileLibrary
} from './cherry-file-library.service'

/**
 * The service reads through `getDatabase()`, so the harness installs a legacy-shaped wrapper over
 * an in-memory database with the two source tables. Positional inserts are avoided on purpose:
 * adding a column has broken every positional insert three times in this project, so rows are
 * written with explicit column names.
 */
function createDatabase() {
  const native = new DatabaseSync(':memory:')
  const db = createLegacyDatabase(native)
  db.exec(`
    CREATE TABLE ai_attachments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT, source_type TEXT NOT NULL DEFAULT 'file', file_path TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'available', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE image_refs (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, storage_mode TEXT NOT NULL DEFAULT 'external', asset_hash TEXT, mime_type TEXT, file_size INTEGER, original_name TEXT, available INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
  `)
  return { native, db }
}

const SHA = 'a'.repeat(64)

function seedAttachment(db: ReturnType<typeof createLegacyDatabase>, values: {
  id: string; name: string; size: number; sha?: string; status?: string; created?: string; path?: string
}) {
  db.run(
    'INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [values.id, 'session-1', null, 'file', values.path || ('C:/store/' + values.id + '.png'), values.name, 'image/png', values.size, values.sha ?? SHA, values.status || 'available', '{}', values.created || '2026-01-02T00:00:00.000Z', values.created || '2026-01-02T00:00:00.000Z']
  )
}

function seedImageRef(db: ReturnType<typeof createLegacyDatabase>, values: {
  path: string; name?: string | null; size?: number | null; available?: number; created?: string
}) {
  db.run(
    'INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [values.path, 'external', null, 'image/png', values.size ?? null, values.name ?? null, values.available ?? 1, values.created || '2026-01-01T00:00:00.000Z']
  )
}

// The service calls getDatabase(); point it at the fixture.
import { vi } from 'vitest'
let active: ReturnType<typeof createLegacyDatabase> | null = null
vi.mock('../database', () => ({ getDatabase: () => active }))

describe('file library projection', () => {
  it('unions both stores, and each entry keeps the arm-specific fields', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'a1', name: 'photo.png', size: 2048 })
    seedImageRef(db, { path: 'D:/pics/art.webp', name: 'art.webp' })

    const entries = listFileLibraryEntries()
    expect(entries).toHaveLength(2)

    const internal = entries.find(entry => entry.origin === 'internal')!
    expect(internal).toMatchObject({ id: 'attachment:a1', name: 'photo', ext: 'png', size: 2048 })
    expect(internal.contentHash).toBe('sha256:' + SHA)
    // The source drops `externalPath` from the internal arm entirely — carrying it as null would
    // invite a consumer to read it.
    expect('externalPath' in internal).toBe(false)

    const external = entries.find(entry => entry.origin === 'external')!
    expect(external).toMatchObject({ name: 'art', ext: 'webp', externalPath: 'D:/pics/art.webp' })
    // A `size` on the external arm would be a type error in the source schema, so it must be
    // ABSENT here rather than 0 or null: a stored snapshot can drift when the user edits the file.
    expect('size' in external).toBe(false)
    expect('contentHash' in external).toBe(false)
    native.close()
  })

  it('excludes deleted attachments from the live list', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'live', name: 'keep.png', size: 1 })
    seedAttachment(db, { id: 'gone', name: 'gone.png', size: 1, status: 'deleted' })
    // `status='deleted'` is Grimoire's own soft delete and is NOT the source trash: mapping it to
    // `deletedAt` would make the source UI offer a restore that cannot be honoured.
    expect(listFileLibraryEntries().map(entry => entry.id)).toEqual(['attachment:live'])
    native.close()
  })

  it('reports no content hash when no digest was recorded, rather than a placeholder', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'a1', name: 'x.png', size: 5, sha: '' })
    seedAttachment(db, { id: 'a2', name: 'y.png', size: 5, sha: 'notahash' })

    // Narrow on `origin` so the internal arm's `contentHash` is accessible — the union is the
    // guard that keeps `size`/`contentHash` off external entries in the first place.
    const hashOf = (id: string) => {
      const entry = findFileLibraryEntry(id)
      return entry && entry.origin === 'internal' ? entry.contentHash : 'WRONG_ARM'
    }
    expect(hashOf('attachment:a1')).toBeNull()
    // A malformed digest is treated as absent, not truncated into a fake hash.
    expect(hashOf('attachment:a2')).toBeNull()
    native.close()
  })

  it('sorts externals AFTER sized rows under a size sort, in BOTH directions', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'small', name: 'small.png', size: 10, created: '2026-01-01T00:00:00.000Z' })
    seedAttachment(db, { id: 'big', name: 'big.png', size: 900, created: '2026-01-02T00:00:00.000Z' })
    seedImageRef(db, { path: 'D:/a.png', name: 'a.png' })

    const asc = queryFileLibrary({ sortBy: 'size', sortOrder: 'asc' }).items
    expect(asc.map(entry => entry.origin)).toEqual(['internal', 'internal', 'external'])
    expect(asc.slice(0, 2).map(entry => entry.id)).toEqual(['attachment:small', 'attachment:big'])

    // Externals stay last in descending order too — they are unsorted, not "size zero".
    const desc = queryFileLibrary({ sortBy: 'size', sortOrder: 'desc' }).items
    expect(desc.map(entry => entry.origin)).toEqual(['internal', 'internal', 'external'])
    expect(desc.slice(0, 2).map(entry => entry.id)).toEqual(['attachment:big', 'attachment:small'])
    native.close()
  })

  it('pages without repeating or skipping, and resumes past a vanished cursor row', () => {
    const { native, db } = createDatabase()
    active = db
    for (let index = 0; index < 5; index += 1) {
      seedAttachment(db, { id: 'a' + index, name: 'f' + index + '.png', size: index, created: `2026-01-0${index + 1}T00:00:00.000Z` })
    }
    const first = queryFileLibrary({ limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.total).toBe(5)

    const second = queryFileLibrary({ limit: 2, cursor: first.nextCursor! })
    const third = queryFileLibrary({ limit: 2, cursor: second.nextCursor! })
    expect(third.items).toHaveLength(1)
    expect(third.nextCursor).toBeUndefined()

    const ids = [...first.items, ...second.items, ...third.items].map(entry => entry.id)
    expect(new Set(ids).size).toBe(5)

    // Delete the row the cursor names — a real race, since the user can act between pages.
    db.run("UPDATE ai_attachments SET status='deleted' WHERE id=?", ['a3'])
    const resumed = queryFileLibrary({ limit: 2, cursor: first.nextCursor! })
    // It must not restart the list, and must not error.
    expect(resumed.items.map(entry => entry.id)).not.toContain('a3')
    expect(resumed.items.length).toBeGreaterThan(0)
    native.close()
  })

  it('filters by origin and search, and treats an unknown cursor as "start over"', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'a1', name: 'holiday.png', size: 1 })
    seedImageRef(db, { path: 'D:/work/report.pdf', name: 'report.pdf' })

    expect(queryFileLibrary({ origin: 'internal' }).items).toHaveLength(1)
    expect(queryFileLibrary({ origin: 'external' }).items).toHaveLength(1)
    expect(queryFileLibrary({ search: 'holiday' }).items).toHaveLength(1)
    // External search covers the path, which is what the user sees for an external row.
    expect(queryFileLibrary({ search: 'work' }).items).toHaveLength(1)
    expect(queryFileLibrary({ cursor: 'not-a-cursor' }).items).toHaveLength(2)
    native.close()
  })

  it('counts extensions for the sidebar and reports trash as genuinely empty', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'a1', name: 'one.png', size: 1 })
    seedAttachment(db, { id: 'a2', name: 'two.png', size: 1 })
    seedImageRef(db, { path: 'D:/doc.pdf', name: 'doc.pdf' })

    const stats = fileLibraryStats()
    expect(stats.activeTotal).toBe(3)
    // Grimoire cannot restore a deleted attachment, so claiming a trash count would promise a
    // restore flow that does not exist.
    expect(stats.trashTotal).toBe(0)
    expect(stats.extCounts[0]).toEqual({ ext: 'png', count: 2 })
    expect(stats.extCounts.map(item => item.ext).sort()).toEqual(['pdf', 'png'])
    native.close()
  })

  it('skips unavailable image refs and derives missing names from the path', () => {
    const { native, db } = createDatabase()
    active = db
    seedImageRef(db, { path: 'D:/gone.png', name: 'gone.png', available: 0 })
    seedImageRef(db, { path: 'D:/pics/unnamed.jpeg', name: null })
    const entries = listFileLibraryEntries()
    expect(entries).toHaveLength(1)
    // A row with no stored original_name still gets a real name from the basename.
    expect(entries[0]).toMatchObject({ name: 'unnamed', ext: 'jpeg', externalPath: 'D:/pics/unnamed.jpeg' })
    native.close()
  })

  it('filters by the source’s file type, including code extensions main’s own table missed', () => {
    const { native, db } = createDatabase()
    active = db
    seedAttachment(db, { id: 'png', name: 'pic.png', size: 1 })
    seedAttachment(db, { id: 'rb', name: 'script.rb', size: 1 })
    seedAttachment(db, { id: 'kt', name: 'app.kt', size: 1 })
    seedImageRef(db, { path: 'D:/mystery.zzzz', name: 'mystery.zzzz' })
    seedImageRef(db, { path: 'D:/noext', name: 'noext' })

    expect(queryFileLibrary({ fileType: 'image' }).items.map(entry => entry.id)).toEqual(['attachment:png'])
    // `.rb`/`.kt` are linguist text extensions the bridge table does not list. If the filter used
    // that table these would be `other`, so 文本 would hide them while the page's column groups
    // them as 文本 — the mismatch this projection exists to avoid.
    expect(queryFileLibrary({ fileType: 'text' }).items.map(entry => entry.id).sort()).toEqual(['attachment:kt', 'attachment:rb'])
    // `other` is "unknown OR no extension", matching the source's `notInArray` condition.
    expect(queryFileLibrary({ fileType: 'other' }).items.map(entry => entry.id).sort()).toEqual(['image_ref:1', 'image_ref:2'])
    native.close()
  })

  it('derives extensions the way the source does', () => {
    expect(extensionOf('a.PNG')).toBe('png')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
    expect(extensionOf('noext')).toBeNull()
    expect(extensionOf('')).toBeNull()
  })
})
