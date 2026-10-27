import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot,
  },
}))

import { closeDatabase, getDatabase, initDatabase } from './database'

/** A pre-v24 database whose `mcp_servers` lacks the description/headers/timeout columns. */
function createLegacyDatabaseWithMcpServer(filePath: string) {
  const database = new DatabaseSync(filePath)
  database.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      args_json TEXT NOT NULL DEFAULT '[]',
      env_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      error_message TEXT,
      tools_json TEXT NOT NULL DEFAULT '[]',
      enabled_tools_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('test_marker', 'legacy')
  database.prepare(
    'INSERT INTO mcp_servers (id,name,transport,endpoint,command,enabled,status,tools_json,enabled_tools_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run('mcp_legacy', '旧服务', 'stdio', '', 'node', 1, 'disconnected', '[{"name":"alpha"}]', '["alpha"]', '2026-01-01', '2026-01-01')
  database.close()
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-database-v24-'))
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('database v24 MCP metadata columns', () => {
  it('adds description/headers/timeout to an existing mcp_servers table without touching rows', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithMcpServer(databasePath)

    await initDatabase()

    const row = getDatabase().exec('SELECT id,name,description,headers_json,timeout_seconds,enabled_tools_json,disabled_auto_approve_tools_json FROM mcp_servers')[0].values[0] as unknown[]
    // The legacy row survives with the additive columns defaulted.
    expect(row[0]).toBe('mcp_legacy')
    expect(row[1]).toBe('旧服务')
    expect(row[2]).toBe('')
    expect(row[3]).toBe('{}')
    expect(row[4]).toBeNull()
    // The pre-existing allowlist is untouched by the migration.
    expect(row[5]).toBe('["alpha"]')
    expect(row[6]).toBe('[]')

    // A backup was written before the migration ran.
    const backups = fs.readdirSync(testRoot).filter(name => name.includes('.pre-migration-'))
    expect(backups.length).toBeGreaterThan(0)
  })

  it('is idempotent across a second open', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithMcpServer(databasePath)
    await initDatabase()
    const first = getDatabase().exec('SELECT description,headers_json,timeout_seconds FROM mcp_servers')[0].values
    closeDatabase()

    await initDatabase()
    const second = getDatabase().exec('SELECT description,headers_json,timeout_seconds FROM mcp_servers')[0].values
    expect(second).toEqual(first)
  })

  it('v25 adds long_running/registry_url/tags to the same legacy table without touching rows', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithMcpServer(databasePath)

    await initDatabase()

    const row = getDatabase().exec('SELECT id,name,long_running,registry_url,tags_json,enabled_tools_json FROM mcp_servers')[0].values[0] as unknown[]
    expect(row[0]).toBe('mcp_legacy')
    expect(row[1]).toBe('旧服务')
    // A legacy server is not in Long Running Mode and has no registry override.
    expect(row[2]).toBe(0)
    expect(row[3]).toBe('')
    expect(row[4]).toBe('[]')
    expect(row[5]).toBe('["alpha"]')
  })

  it('v25 preserves a stored value across a second open', async () => {
    const databasePath = path.join(testRoot, 'grimoire.db')
    createLegacyDatabaseWithMcpServer(databasePath)
    await initDatabase()
    getDatabase().run(
      "UPDATE mcp_servers SET long_running=1, registry_url='https://registry.invalid/x', tags_json='[\"检索\"]' WHERE id='mcp_legacy'"
    )
    closeDatabase()

    await initDatabase()
    const row = getDatabase().exec('SELECT long_running,registry_url,tags_json FROM mcp_servers')[0].values[0] as unknown[]
    expect(Number(row[0])).toBe(1)
    expect(row[1]).toBe('https://registry.invalid/x')
    expect(row[2]).toBe('["检索"]')
  })
})
