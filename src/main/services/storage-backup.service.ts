// 自动备份：每日一次 VACUUM INTO 快照 + 保留策略。
//
// 为什么不用 `DatabaseSync.backup()`：node:sqlite 没有这个方法（实测 undefined）。
// `VACUUM INTO` 是唯一既能从只读句柄跑、又能顺带压实的方式（9.3MB → 7.9MB）。
//
// 触发时机：首帧之后（`afterFirstPaint`）且「今天还没备份过」。放在首帧之后是刻意的——
// 备份要写一个 8MB 文件，和首屏抢 IO 没有意义。

import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getDatabase, importDatabase } from '../database'
import { logEvent } from './logger.service'

/** stat 失败（不存在/权限）返回 null，但留一条 debug —— 空 catch 会被 G12 拦下。 */
async function statOrNull(target: string, label: string): Promise<import("fs").Stats | null> {
  try {
    return await fs.stat(target)
  } catch (error) {
    logEvent('debug', 'storage', 'stat failed', { context: `${label}: ${target}: ${error instanceof Error ? error.message : String(error)}` })
    return null
  }
}


const BACKUP_DIR_NAME = 'backups'
const KEEP_COUNT = 7
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const SETTINGS_KEY = 'storage.backup.lastRun'

export interface BackupRecord {
  readonly path: string
  readonly bytes: number
  readonly createdAt: string
}

function backupDir(): string {
  return path.join(app.getPath('userData'), BACKUP_DIR_NAME)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function readLastRun(): string | null {
  try {
    const db = getDatabase()
    const result = db.exec('SELECT value FROM settings WHERE key=?', [SETTINGS_KEY])
    const value = result[0]?.values?.[0]?.[0]
    return typeof value === 'string' ? value : null
  } catch (error) {
    logEvent('warn', 'storage', '读取备份记账失败', { context: error instanceof Error ? error.message : String(error), errorCode: 'STORAGE_BACKUP_LEDGER_READ_FAILED', retryable: true })
    return null
  }
}

function writeLastRun(value: string): void {
  try {
    getDatabase().run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [SETTINGS_KEY, value])
  } catch (error) {
    // 记账失败不影响备份本身，但要留痕：否则「每天备份」会静默变成「每次启动都备份」。
    logEvent('warn', 'storage', '写入备份记账失败', { context: error instanceof Error ? error.message : String(error), errorCode: 'STORAGE_BACKUP_LEDGER_WRITE_FAILED', retryable: true })
  }
}

export async function listBackups(): Promise<BackupRecord[]> {
  const dir = backupDir()
  let names: string[] = []
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith('.db'))
  } catch (error) {
    logEvent('debug', 'storage', '备份目录尚未创建', { context: error instanceof Error ? error.message : String(error) })
    return []
  }
  const records = await Promise.all(names.map(async (name) => {
    const full = path.join(dir, name)
    const stat = await statOrNull(full, 'backup')
    return { path: full, bytes: stat?.size ?? 0, createdAt: stat ? new Date(stat.mtimeMs).toISOString() : '' }
  }))
  return records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

/** 保留最近 N 份且总量不超过上限；先按数量，再按总量从最旧开始删。 */
export async function pruneBackups(keep = KEEP_COUNT, maxBytes = MAX_TOTAL_BYTES): Promise<number> {
  const records = await listBackups()
  let removed = 0
  let total = records.reduce((sum, record) => sum + record.bytes, 0)
  const survivors: BackupRecord[] = []
  records.forEach((record, index) => {
    const overCount = index >= keep
    const overBytes = total > maxBytes
    if (overCount || overBytes) {
      total -= record.bytes
      removed += 1
      void fs.rm(record.path, { force: true }).catch((error: unknown) => {
        logEvent('warn', 'storage', '删除过期备份失败', { context: `${record.path}: ${error instanceof Error ? error.message : String(error)}`, errorCode: 'STORAGE_BACKUP_PRUNE_FAILED', retryable: true })
      })
    } else {
      survivors.push(record)
    }
  })
  return removed
}

export async function createBackup(reason = 'manual'): Promise<BackupRecord> {
  const dir = backupDir()
  await fs.mkdir(dir, { recursive: true })
  const db = getDatabase()
  const file = path.join(dir, `grimoire-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  const escaped = file.replace(/\\/g, '/').replace(/'/g, "''")
  db.exec(`VACUUM INTO '${escaped}'`)
  const stat = await fs.stat(file)
  writeLastRun(new Date().toISOString())
  logEvent('info', 'storage', 'Backup created', { context: `${reason} ${(stat.size / 1048576).toFixed(1)}MB` })
  await pruneBackups()
  return { path: file, bytes: stat.size, createdAt: new Date().toISOString() }
}

/** 每天最多一次；已经备份过就返回 null。 */
export async function runDailyBackupIfDue(): Promise<BackupRecord | null> {
  const last = readLastRun()
  if (last && last.slice(0, 10) === today()) return null
  try {
    return await createBackup('daily')
  } catch (error) {
    logEvent('warn', 'storage', 'Daily backup failed', {
      context: error instanceof Error ? error.message : String(error),
      errorCode: 'STORAGE_BACKUP_FAILED',
      retryable: true,
    })
    return null
  }
}

export async function restoreBackup(filePath: string): Promise<void> {
  if (!filePath.endsWith('.db')) throw new Error('备份文件必须是 .db')
  const stat = await statOrNull(filePath, 'backup')
  if (!stat) throw new Error('备份文件不存在')
  importDatabase(filePath)
}
