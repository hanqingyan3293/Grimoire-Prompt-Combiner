import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { DatabaseSync } from 'node:sqlite'
import { createLegacyDatabase } from './sqlite.compat'

// The service reads through `getDatabase()`; point it at a fixture with both source tables.
let active: ReturnType<typeof createLegacyDatabase> | null = null
vi.mock('../database', () => ({
  getDatabase: () => active,
  saveDatabase: () => undefined,
  getResourceRoot: () => path.join(testRoot, 'resources')
}))

import {
  batchCreateInternalEntries,
  batchGetDanglingStates,
  batchGetMetadata,
  batchGetPhysicalPaths,
  batchRemoveFromLibrary,
  parseLibraryEntryId,
  physicalFileMetadata,
  renameEntry
} from './cherry-file-ipc.service'

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-filipc-'))
  const native = new DatabaseSync(':memory:')
  const db = createLegacyDatabase(native)
  db.exec(`
    CREATE TABLE ai_attachments (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, source_type TEXT NOT NULL DEFAULT 'file', file_path TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '', mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'available', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE image_refs (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, storage_mode TEXT NOT NULL DEFAULT 'external', asset_hash TEXT, mime_type TEXT, file_size INTEGER, original_name TEXT, available INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE novelai_version_image (image_id TEXT NOT NULL);
  `)
  active = db
  fs.mkdirSync(path.join(testRoot, 'resources', 'ai-attachments'), { recursive: true })
})
afterEach(() => { fs.rmSync(testRoot, { recursive: true, force: true }) })

function seedAttachment(db: NonNullable<typeof active>, id: string, filePath: string, name: string) {
  db.run(
    'INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, null, null, 'file', filePath, name, 'application/octet-stream', 3, 'a'.repeat(64), 'available', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
  )
}

describe('file ipc — id parsing', () => {
  it('splits the prefixed ids the library mints', () => {
    expect(parseLibraryEntryId('attachment:abc')).toEqual({ table: 'ai_attachments', rawId: 'abc' })
    expect(parseLibraryEntryId('image_ref:7')).toEqual({ table: 'image_refs', rawId: '7' })
    expect(parseLibraryEntryId('bare')).toEqual({ table: null, rawId: 'bare' })
  })
})

describe('file ipc — metadata', () => {
  it('reports real filesystem facts and the SOURCE file type', () => {
    const body = 'puts 1'
    const target = path.join(testRoot, 'app.rb')
    fs.writeFileSync(target, body)
    const meta = physicalFileMetadata(target)!
    // Size taken from the file itself, not hard-coded: asserting a literal byte count tests my
    // arithmetic rather than the code (the first version claimed 7 for a 6-byte string).
    expect(meta).toMatchObject({ kind: 'file', size: Buffer.byteLength(body) })
    // `.rb` is a linguist text extension. Reporting `other` here would disagree with the 文本
    // group the page displays the same row under.
    expect(meta.type).toBe('text')
  })

  it('returns null for a path that is not there, and marks directories', () => {
    expect(physicalFileMetadata(path.join(testRoot, 'nope.txt'))).toBeNull()
    const dir = path.join(testRoot, 'folder')
    fs.mkdirSync(dir)
    expect(physicalFileMetadata(dir)!.kind).toBe('directory')
  })

  it('keys batch metadata by the CALLER’s key, not by path', () => {
    const target = path.join(testRoot, 'a.txt')
    fs.writeFileSync(target, 'x')
    const result = batchGetMetadata([{ key: 'k1', handle: { kind: 'path', path: target } }, { key: 'k2', handle: { kind: 'path', path: path.join(testRoot, 'gone') } }])
    expect(Object.keys(result).sort()).toEqual(['k1', 'k2'])
    expect(result.k1).toMatchObject({ kind: 'file' })
    expect(result.k2).toBeNull()
  })
})

describe('file ipc — paths and dangling states', () => {
  it('reports a path only while the file is genuinely present', () => {
    const live = path.join(testRoot, 'resources', 'ai-attachments', 'live.txt')
    fs.writeFileSync(live, 'x')
    seedAttachment(active!, 'a1', live, 'live.txt')
    seedAttachment(active!, 'a2', path.join(testRoot, 'resources', 'ai-attachments', 'deleted.txt'), 'deleted.txt')

    const paths = batchGetPhysicalPaths(['attachment:a1', 'attachment:a2'])
    expect(paths['attachment:a1']).toBe(live)
    // A stale path must not be reported: the dangling-state route is what tells the UI it is gone.
    expect(paths['attachment:a2']).toBeNull()

    const states = batchGetDanglingStates(['attachment:a1', 'attachment:a2'])
    expect(states['attachment:a1']).toBe('present')
    expect(states['attachment:a2']).toBe('missing')
    // `unknown` means "no observation", which a synchronous existsSync never produces — so it is
    // never used as a catch-all.
    expect(Object.values(states)).not.toContain('unknown')
  })

  it('resolves an external entry through its referenced path', () => {
    const external = path.join(testRoot, 'ext.png')
    fs.writeFileSync(external, 'img')
    active!.run("INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available,created_at) VALUES (?,?,?,?,?,?,?,?)", [external, 'external', null, 'image/png', 3, 'ext.png', 1, '2026-01-01T00:00:00.000Z'])
    expect(batchGetPhysicalPaths(['image_ref:1'])['image_ref:1']).toBe(external)
    expect(batchGetDanglingStates(['image_ref:1'])['image_ref:1']).toBe('present')
  })
})

describe('file ipc — create internal entries', () => {
  it('copies the content in and reports a usable library id', async () => {
    const source = path.join(testRoot, 'upload.txt')
    fs.writeFileSync(source, 'hello world')
    const result = await batchCreateInternalEntries([{ source: 'path', path: source, cleanupPolicy: 'manual' }])
    expect(result.failed).toEqual([])
    expect(result.succeeded).toHaveLength(1)
    expect(result.succeeded[0].id).toMatch(/^attachment:/)

    // The row exists, points at a COPY, and the library lists it.
    const row = active!.exec('SELECT file_path,size,original_name FROM ai_attachments')[0]?.values?.[0]!
    const stored = String(row[0])
    expect(stored).not.toBe(source)
    expect(fs.readFileSync(stored, 'utf8')).toBe('hello world')
    expect(Number(row[1])).toBe(11)
    expect(String(row[2])).toBe('upload.txt')
  })

  it('fails only the unsupported item, not the whole batch', async () => {
    const good = path.join(testRoot, 'ok.txt')
    fs.writeFileSync(good, 'x')
    const result = await batchCreateInternalEntries([
      { source: 'path', path: good },
      { source: 'url', path: '' }
    ])
    // One bad entry must not take down the upload of the others.
    expect(result.succeeded).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toContain('path')
  })

  it('reports a missing source path per item instead of throwing', async () => {
    const result = await batchCreateInternalEntries([{ source: 'path', path: path.join(testRoot, 'nope.bin') }])
    expect(result.succeeded).toEqual([])
    expect(result.failed[0].sourceRef).toContain('nope.bin')
  })
})

describe('file ipc — rename', () => {
  it('renames an internal entry’s file and stored name together', async () => {
    const target = path.join(testRoot, 'resources', 'ai-attachments', 'old.txt')
    fs.writeFileSync(target, 'x')
    seedAttachment(active!, 'a1', target, 'old.txt')

    expect(await renameEntry('attachment:a1', 'new')).toEqual({ ok: true })
    const row = active!.exec('SELECT file_path,original_name FROM ai_attachments WHERE id=?', ['a1'])[0]?.values?.[0]!
    expect(String(row[1])).toBe('new.txt')
    expect(fs.existsSync(String(row[0]))).toBe(true)
    // The extension is preserved so the file stays classified as before.
    expect(path.extname(String(row[0]))).toBe('.txt')
  })

  it('REFUSES to rename an external entry, because that would rename the user’s own file', async () => {
    const external = path.join(testRoot, 'mine.png')
    fs.writeFileSync(external, 'x')
    active!.run("INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available,created_at) VALUES (?,?,?,?,?,?,?,?)", [external, 'external', null, 'image/png', 1, 'mine.png', 1, '2026-01-01T00:00:00.000Z'])
    const result = await renameEntry('image_ref:1', 'renamed')
    expect(result.ok).toBe(false)
    // The user's file is untouched — that is the whole point of the refusal.
    expect(fs.existsSync(external)).toBe(true)
  })

  it('rejects a name the filesystem cannot store', async () => {
    const target = path.join(testRoot, 'resources', 'ai-attachments', 'x.txt')
    fs.writeFileSync(target, 'x')
    seedAttachment(active!, 'a1', target, 'x.txt')
    expect((await renameEntry('attachment:a1', 'a/b')).ok).toBe(false)
    expect((await renameEntry('attachment:a1', '')).ok).toBe(false)
  })
})

describe('file ipc — remove from library', () => {
  it('deletes Grimoire’s own copy for an internal entry', () => {
    const target = path.join(testRoot, 'resources', 'ai-attachments', 'copy.txt')
    fs.writeFileSync(target, 'x')
    seedAttachment(active!, 'a1', target, 'copy.txt')

    const result = batchRemoveFromLibrary(['attachment:a1'])
    expect(result.succeeded).toEqual(['attachment:a1'])
    expect(fs.existsSync(target)).toBe(false)
    expect(active!.exec("SELECT status FROM ai_attachments WHERE id='a1'")[0]?.values?.[0]?.[0]).toBe('deleted')
  })

  it('removes only the REFERENCE for an external entry and leaves the user’s file alone', () => {
    const external = path.join(testRoot, 'user-file.png')
    fs.writeFileSync(external, 'x')
    active!.run("INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available,created_at) VALUES (?,?,?,?,?,?,?,?)", [external, 'external', null, 'image/png', 1, 'user-file.png', 1, '2026-01-01T00:00:00.000Z'])

    const result = batchRemoveFromLibrary(['image_ref:1'])
    expect(result.succeeded).toEqual(['image_ref:1'])
    // This is the difference between "external" and "internal": Grimoire never owned this file.
    expect(fs.existsSync(external)).toBe(true)
    expect(active!.exec('SELECT count(*) FROM image_refs')[0]?.values?.[0]?.[0]).toBe(0)
  })

  it('keeps a shared copy on disk until the LAST reference goes', () => {
    const target = path.join(testRoot, 'resources', 'ai-attachments', 'shared.txt')
    fs.writeFileSync(target, 'x')
    seedAttachment(active!, 'a1', target, 'shared.txt')
    seedAttachment(active!, 'a2', target, 'shared.txt')

    batchRemoveFromLibrary(['attachment:a1'])
    // Still referenced by a2, so the bytes must survive.
    expect(fs.existsSync(target)).toBe(true)
    batchRemoveFromLibrary(['attachment:a2'])
    expect(fs.existsSync(target)).toBe(false)
  })

  it('reports a locked attachment and leaves its live index available for retry', () => {
    const target = path.join(testRoot, 'resources', 'ai-attachments', 'locked-copy.txt')
    fs.writeFileSync(target, 'retained copy')
    seedAttachment(active!, 'locked', target, 'copy.txt')
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('locked fixture') })
    try {
      const result = batchRemoveFromLibrary(['attachment:locked'])
      expect(result.succeeded).toEqual([])
      expect(result.failed).toEqual([{ id: 'attachment:locked', error: 'locked fixture' }])
      expect(active!.exec("SELECT status FROM ai_attachments WHERE id='locked'")[0].values[0][0]).toBe('available')
      expect(fs.readFileSync(target, 'utf8')).toBe('retained copy')
    } finally { unlink.mockRestore() }
  })

  it('reports an unknown id as a failure rather than silently "succeeding"', () => {
    const result = batchRemoveFromLibrary(['nonsense:1'])
    expect(result.succeeded).toEqual([])
    expect(result.failed[0].id).toBe('nonsense:1')
  })
})
