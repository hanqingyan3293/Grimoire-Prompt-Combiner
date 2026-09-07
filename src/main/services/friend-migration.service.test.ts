import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { normalizeFriendPromptIndex, planFriendPromptMigration } from './friend-migration.core'
import { applyFriendPromptMigration } from './friend-migration.service'
import { createLegacyDatabase } from './sqlite.compat'

describe('friend migration source handling', () => {
  it('writes prompt assets transactionally and keeps them separate from tags', () => {
    const plan = planFriendPromptMigration([{ name: '镜头', tags: 'wide shot', chapter: '构图' }])
    const native = new DatabaseSync(':memory:')
    const db = createLegacyDatabase(native)
    db.exec(`CREATE TABLE prompt_assets (id TEXT PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, chapter TEXT, section TEXT, subsection TEXT, nsfw INTEGER, variant_count INTEGER, source_fingerprint TEXT); CREATE TABLE migration_runs (id TEXT PRIMARY KEY, source TEXT, source_fingerprint TEXT, added_count INTEGER, duplicate_count INTEGER, skipped_count INTEGER);`)
    const result = applyFriendPromptMigration(db, plan)
    expect(result.addedCount).toBe(1)
    expect(db.exec('SELECT name, prompt, chapter FROM prompt_assets')).toEqual([{ columns: ['name', 'prompt', 'chapter'], values: [['镜头', 'wide shot', '构图']] }])
    expect(db.exec('SELECT count(*) AS count FROM migration_runs')).toEqual([{ columns: ['count'], values: [[1]] }])
    native.close()
  })

  it('does not treat arbitrary local config as a prompt index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-migration-'))
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, JSON.stringify({ api_key: 'secret' }))
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(() => normalizeFriendPromptIndex(parsed)).toThrow('必须是数组')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rolls back all writes when a migration insert fails', () => {
    const native = new DatabaseSync(':memory:')
    const db = createLegacyDatabase(native)
    db.exec(`CREATE TABLE prompt_assets (id TEXT PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, chapter TEXT, section TEXT, subsection TEXT, nsfw INTEGER, variant_count INTEGER, source_fingerprint TEXT); CREATE TABLE migration_runs (id TEXT PRIMARY KEY, source TEXT, source_fingerprint TEXT, added_count INTEGER, duplicate_count INTEGER, skipped_count INTEGER);`)
    const plan = planFriendPromptMigration([{ name: 'ok', tags: 'prompt', chapter: 'x' }])
    db.exec('DROP TABLE migration_runs')
    expect(() => applyFriendPromptMigration(db, plan)).toThrow()
    expect(db.exec('SELECT count(*) AS count FROM prompt_assets')).toEqual([{ columns: ['count'], values: [[0]] }])
    native.close()
  })
})
