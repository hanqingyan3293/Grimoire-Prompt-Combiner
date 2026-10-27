import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot,
  },
}))

import { closeDatabase, getDatabase, initDatabase } from './database'

/**
 * v31 makes `ai_attachments.session_id` nullable so a file added to the LIBRARY (no session) is
 * storable.
 *
 * The migration exists because the LIVE upload path failed with `FOREIGN KEY constraint failed`:
 * the column was `NOT NULL` with a cascade FK, and a library file genuinely has no session. Unit
 * tests mock the database away, so only a real migrated database reproduces it.
 *
 * The fixture is built by DOWNGRADING the real schema rather than hand-writing a small one. A
 * hand-written stand-in has to reproduce every column the OTHER migrations read (`metadata_json`,
 * `sequence`, ...) and fails inside an unrelated migration the moment it misses one — which reads
 * like a v31 bug while actually being a fixture that is too small. Downgrading the real schema
 * cannot drift from the schema.
 */
async function downgradeToNotNull(filePath: string, seedAttachment: boolean) {
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(filePath)
  database.exec('PRAGMA foreign_keys=OFF')
  try {
    if (seedAttachment) {
      database
        .prepare('INSERT INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run('s1', 'chat', 'openai-compatible', '', '', 'S', 'idle', null, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      // Explicit column list: a positional insert mis-maps every value once a column is added.
      database
        .prepare('INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('existing', 's1', null, 'file', 'C:/store/existing.txt', 'existing.txt', 'text/plain', 12, 'b'.repeat(64), 'available', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    }
    database.exec(`CREATE TABLE ai_attachments_v30 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'file',
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
    )`)
    database.exec(`INSERT INTO ai_attachments_v30
      (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at)
      SELECT id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at FROM ai_attachments`)
    database.exec('DROP TABLE ai_attachments')
    database.exec('ALTER TABLE ai_attachments_v30 RENAME TO ai_attachments')
    // Clear the marker so the migration runs on the next init.
    database.prepare("DELETE FROM schema_meta WHERE key='ai_attachments_library_migrated'").run()
  } finally {
    database.exec('PRAGMA foreign_keys=ON')
  }
  database.close()
}

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-v31-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

const sessionColumnNotNull = () => {
  const columns = getDatabase().exec("PRAGMA table_info('ai_attachments')")[0]?.values || []
  const session = columns.find(row => String(row[1]) === 'session_id')!
  return Number(session[3]) === 1
}

describe('schema v31 — library attachments', () => {
  it('a fresh database already has the nullable column', async () => {
    await initDatabase()
    expect(sessionColumnNotNull()).toBe(false)
  })

  it('migrates a v30 table to nullable, so a session-less row can be stored', async () => {
    await initDatabase()
    const dbPath = path.join(testRoot, 'grimoire.db')
    closeDatabase()
    await downgradeToNotNull(dbPath, false)
    expect(sessionColumnNotNull).toBeTruthy()

    await initDatabase()
    expect(sessionColumnNotNull()).toBe(false)

    // The exact operation the upload path performs: a NULL session must be accepted.
    expect(() => getDatabase().run(
      'INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['lib1', null, null, 'file', 'C:/store/lib.txt', 'lib.txt', 'text/plain', 3, 'c'.repeat(64), 'available', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    )).not.toThrow()
  })

  it('preserves existing session-bound attachments through the rebuild', async () => {
    await initDatabase()
    const dbPath = path.join(testRoot, 'grimoire.db')
    closeDatabase()
    await downgradeToNotNull(dbPath, true)
    await initDatabase()

    const row = getDatabase().exec('SELECT id,session_id,file_path,sha256 FROM ai_attachments')[0]?.values?.[0]!
    // A rebuild that dropped rows or nulled the session would silently detach a conversation's
    // file — this is the assertion that the rebuild COPIES rather than recreates.
    expect(String(row[0])).toBe('existing')
    expect(String(row[1])).toBe('s1')
    expect(String(row[2])).toBe('C:/store/existing.txt')
    expect(String(row[3])).toBe('b'.repeat(64))
  })

  it('keeps the cascade for session-bound rows', async () => {
    await initDatabase()
    const dbPath = path.join(testRoot, 'grimoire.db')
    closeDatabase()
    await downgradeToNotNull(dbPath, true)
    await initDatabase()

    // The FK must survive: nullability is for library rows, not a licence to orphan attachments.
    expect(Number(getDatabase().exec('SELECT count(*) FROM ai_attachments')[0]?.values?.[0]?.[0])).toBe(1)
    getDatabase().run('DELETE FROM ai_sessions WHERE id=?', ['s1'])
    expect(Number(getDatabase().exec('SELECT count(*) FROM ai_attachments')[0]?.values?.[0]?.[0])).toBe(0)
  })

  it('is idempotent — a second startup keeps the library row and does not rebuild', async () => {
    await initDatabase()
    const dbPath = path.join(testRoot, 'grimoire.db')
    closeDatabase()
    await downgradeToNotNull(dbPath, true)
    await initDatabase()
    getDatabase().run(
      'INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['lib2', null, null, 'file', 'C:/store/lib2.txt', 'lib2.txt', 'text/plain', 3, 'd'.repeat(64), 'available', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    )
    closeDatabase()

    await initDatabase()
    // A rebuild running twice would either drop the library row or fail on the marker.
    expect(Number(getDatabase().exec('SELECT count(*) FROM ai_attachments WHERE session_id IS NULL')[0]?.values?.[0]?.[0])).toBe(1)
    expect(Number(getDatabase().exec('SELECT count(*) FROM ai_attachments')[0]?.values?.[0]?.[0])).toBe(2)
  })
})
