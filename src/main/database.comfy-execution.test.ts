import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
let connection: DatabaseSync | null = null
vi.mock('electron', () => ({ app: { getPath: (name: string) => name === 'exe' ? path.join(root, 'Grimoire.exe') : root } }))
import { CURRENT_SCHEMA_VERSION, closeDatabase, getDatabase, initDatabase, initializeDatabaseConnection } from './database'

const columns = 'id,kind,status,input_json,output_json,error_code,error_message,progress,retry_count,max_retries,created_at,started_at,finished_at,updated_at,next_attempt_at'
const oldRow = ['legacy-task', 'comfyui', 'failed', '{"workflowId":"fixture"}', '{"old":true}', 'COMFY_HTTP_503', 'legacy failure', 0.25, 1, 3, '2026-11-06T00:00:00Z', '2026-11-06T00:00:01Z', '2026-11-06T00:00:02Z', '2026-11-06T00:00:02Z', '2026-11-06T00:00:04Z']
const execution = JSON.stringify({ version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'waiting', requestedPromptId: '11111111-1111-4111-8111-111111111111', promptId: '22222222-2222-4222-8222-222222222222', cancelOutcome: 'none' })
function oldDatabase(): DatabaseSync {
  const db = new DatabaseSync(path.join(root, 'grimoire.db'))
  connection = db
  initializeDatabaseConnection(db)
  const fields = db.prepare('PRAGMA table_info(task_jobs)').all() as Array<{ name: string }>
  if (fields.some(field => field.name === 'execution_json')) db.exec('ALTER TABLE task_jobs DROP COLUMN execution_json')
  db.prepare("UPDATE schema_meta SET value='40' WHERE key='schema_version'").run()
  db.prepare('INSERT INTO task_jobs (' + columns + ') VALUES (' + oldRow.map(() => '?').join(',') + ')').run(...oldRow)
  return db
}
function version(db: DatabaseSync) { return (db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value: string }).value }
function hasExecution(db: DatabaseSync) { return (db.prepare('PRAGMA table_info(task_jobs)').all() as Array<{ name: string }>).some(field => field.name === 'execution_json') }
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-comfy-migration-')) })
afterEach(() => { vi.restoreAllMocks(); closeDatabase(); connection?.close(); connection = null; fs.rmSync(root, { recursive: true, force: true }) })

describe('Comfy execution state schema migration (C1)', () => {
  it('creates one nullable execution column in the existing task table and advances to 41', async () => {
    await initDatabase()
    const fields = getDatabase().exec('PRAGMA table_info(task_jobs)')[0].values
    const field = fields.find(row => row[1] === 'execution_json')
    expect(field).toBeDefined()
    expect(field?.[2]).toBe('TEXT')
    expect(field?.[3]).toBe(0)
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(41)
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  it('keeps every old task value and uses NULL instead of guessing an execution identity', () => {
    const db = oldDatabase()
    initializeDatabaseConnection(db)
    const result = db.prepare('SELECT ' + columns + ',execution_json FROM task_jobs').get()!
    expect(Object.values(result)).toEqual([...oldRow, null])
    expect(version(db)).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  it('keeps endpoint, IDs and deadline across database reopen without rewriting the JSON', async () => {
    const db = oldDatabase(); initializeDatabaseConnection(db)
    db.prepare('UPDATE task_jobs SET execution_json=? WHERE id=?').run(execution, oldRow[0])
    db.close(); connection = null
    await initDatabase()
    expect(getDatabase().exec('SELECT execution_json,next_attempt_at FROM task_jobs')[0].values[0]).toEqual([execution, oldRow[14]])
    closeDatabase(); await initDatabase()
    expect(getDatabase().exec('SELECT execution_json FROM task_jobs')[0].values[0][0]).toBe(execution)
  })

  it('backs up the version-40 file before applying the additive migration', async () => {
    const db = oldDatabase(); db.close(); connection = null
    await initDatabase()
    const backup = fs.readdirSync(root).find(name => name.startsWith('grimoire.db.pre-migration-'))
    expect(backup).toBeTruthy()
    const old = new DatabaseSync(path.join(root, backup!), { readOnly: true })
    try { expect(version(old)).toBe('40'); expect(hasExecution(old)).toBe(false) } finally { old.close() }
  })

  it('stops before changing the file when migration backup fails', async () => {
    const db = oldDatabase(); db.close(); connection = null
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('backup fixture') })
    await expect(initDatabase()).rejects.toThrow(/备份失败/)
    const old = new DatabaseSync(path.join(root, 'grimoire.db'), { readOnly: true })
    try { expect(version(old)).toBe('40'); expect(hasExecution(old)).toBe(false) } finally { old.close() }
  })

  it.each(['ddl', 'version', 'commit'])('rolls back the execution column and version when %s fails', boundary => {
    const db = oldDatabase()
    if (boundary === 'commit') {
      const execute = db.exec.bind(db)
      vi.spyOn(db, 'exec').mockImplementation(sql => { if (sql === 'COMMIT') throw new Error('commit migration fixture'); return execute(sql) })
    } else {
      const prepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation(sql => {
        if (boundary === 'ddl' && /ALTER TABLE task_jobs ADD COLUMN execution_json/.test(sql)) throw new Error('ddl migration fixture')
        if (boundary === 'version' && /schema_version/.test(sql) && /INSERT OR REPLACE/.test(sql)) throw new Error('version migration fixture')
        return prepare(sql)
      })
    }
    expect(() => initializeDatabaseConnection(db)).toThrow(/migration fixture/)
    expect(version(db)).toBe('40')
    expect(hasExecution(db)).toBe(false)
    expect(Object.values(db.prepare('SELECT ' + columns + ' FROM task_jobs').get()!)).toEqual(oldRow)
  })

  it('rejects a newer schema during ordinary startup before rewriting schema or task data', () => {
    const db = oldDatabase()
    db.prepare("UPDATE schema_meta SET value='999' WHERE key='schema_version'").run()
    const before = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()
    expect(() => initializeDatabaseConnection(db)).toThrow(/版本/)
    expect(version(db)).toBe('999')
    expect(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before)
    expect(Object.values(db.prepare('SELECT ' + columns + ' FROM task_jobs').get()!)).toEqual(oldRow)
  })
})
