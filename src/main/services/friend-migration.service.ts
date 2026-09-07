import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import { planFriendPromptMigration, type FriendMigrationPlan } from './friend-migration.core'
import { requireText } from './input-validation'
import type { LegacyDatabase } from './sqlite.compat'

const MAX_SOURCE_BYTES = 50 * 1024 * 1024

function readSourceFile(filePath: string): unknown {
  const absolutePath = path.resolve(requireText(filePath, '迁移文件路径', 4096))
  const stats = fs.statSync(absolutePath)
  if (!stats.isFile()) throw new Error('迁移路径不是文件')
  if (stats.size <= 0 || stats.size > MAX_SOURCE_BYTES) throw new Error('迁移文件大小超出限制')
  if (path.extname(absolutePath).toLowerCase() !== '.json') throw new Error('迁移文件必须是 JSON')
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

function existingSourceIds(): string[] {
  const db = getDatabase()
  const result = db.exec('SELECT source_id FROM prompt_assets WHERE source=?', ['suigu-search-index'])
  return (result[0]?.values || []).map(row => String(row[0]))
}

export function previewFriendPromptMigration(filePath: string): FriendMigrationPlan {
  return planFriendPromptMigration(readSourceFile(filePath), existingSourceIds())
}

export function applyFriendPromptMigration(db: LegacyDatabase, plan: FriendMigrationPlan): FriendMigrationPlan & { runId: string; addedCount: number } {
  const runId = 'migration_' + crypto.randomUUID().slice(0, 12)
  let addedCount = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const insert = db.prepare(`INSERT OR IGNORE INTO prompt_assets (id, source_id, source, name, prompt, chapter, section, subsection, nsfw, variant_count, source_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    try {
      for (const entry of plan.additions) {
        const result = insert.run([entry.sourceId, entry.sourceId, plan.source, entry.name, entry.prompt, entry.chapter, entry.section, entry.subsection, entry.nsfw ? 1 : 0, entry.variantCount, plan.sourceFingerprint])
        if (Number(result.changes) > 0) addedCount += 1
      }
    } finally {
      insert.free()
    }
    db.run('INSERT INTO migration_runs (id, source, source_fingerprint, added_count, duplicate_count, skipped_count) VALUES (?,?,?,?,?,?)', [runId, plan.source, plan.sourceFingerprint, addedCount, plan.duplicates.length, plan.skipped])
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
  saveDatabase()
  return { ...plan, runId, addedCount }
}

export function importFriendPromptMigration(filePath: string, expectedFingerprint?: string): FriendMigrationPlan & { runId: string; addedCount: number } {
  const plan = planFriendPromptMigration(readSourceFile(filePath), existingSourceIds())
  if (expectedFingerprint && expectedFingerprint !== plan.sourceFingerprint) throw new Error('迁移文件在确认后发生变化，请重新扫描')
  return applyFriendPromptMigration(getDatabase(), plan)
}
