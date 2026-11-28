// 清理与待清理区（trash）。
//
// 两条硬规则：
//  1. **删除先进 trash**，24 小时后（或用户手动确认）才真删。误删是最难挽回的一类事故，
//     而垃圾文件多留一天没有成本。
//  2. **有引用的数据不删**：这里只处理「可重建」的东西（超期迁移备份、缓存），
//     媒体/数据库这类带引用的资源根本不进清理清单。
//
// 目录布局：`<userData>/trash/<timestamp>-<rand>/payload` + `record.json`，
// 还原只需要 record.json 里的 originalPath，不依赖内存状态（重启后仍可还原）。

import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
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

import { sizeOfMatchingFiles, sizeOfPath, sizeOfPaths } from './storage-size.service'

const TRASH_DIR_NAME = 'trash'
const TRASH_TTL_MS = 24 * 60 * 60 * 1000
const MIGRATION_BACKUP_KEEP = 3

export interface TrashRecord {
  readonly id: string
  readonly label: string
  readonly originalPath: string
  readonly bytes: number
  readonly reason: string
  readonly createdAt: string
  readonly kind: 'file' | 'directory'
}

export interface CleanupCandidate {
  readonly id: string
  readonly label: string
  readonly paths: readonly string[]
  readonly bytes: number
  readonly files: number
  readonly reason: string
  readonly kind: 'file' | 'directory'
  /** 需要重启才能安全清理（Chromium 正在占用的缓存）。 */
  readonly requiresRestart?: boolean
}

function trashRoot(): string {
  return path.join(app.getPath('userData'), TRASH_DIR_NAME)
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** 迁移前备份：按 mtime 保留最新 N 份，其余进清理清单。 */
export async function planMigrationBackupCleanup(): Promise<CleanupCandidate | null> {
  const userData = app.getPath('userData')
  let names: string[] = []
  try {
    names = (await fs.readdir(userData)).filter((name) => name.startsWith('grimoire.db.pre-migration-') && name.endsWith('.bak'))
  } catch (error) {
    logEvent('warn', 'storage', '读取迁移备份目录失败', { context: error instanceof Error ? error.message : String(error), errorCode: 'STORAGE_BACKUP_LIST_FAILED', retryable: true })
    return null
  }
  if (names.length <= MIGRATION_BACKUP_KEEP) return null

  const stats = await Promise.all(names.map(async (name) => {
    const full = path.join(userData, name)
    const stat = await statOrNull(full, 'backup')
    return { name, full, mtime: stat?.mtimeMs ?? 0, bytes: stat?.size ?? 0 }
  }))
  stats.sort((left, right) => right.mtime - left.mtime)
  const stale = stats.slice(MIGRATION_BACKUP_KEEP)
  if (stale.length === 0) return null

  return {
    id: 'cleanup.migration-backups',
    label: `迁移前备份（保留最近 ${MIGRATION_BACKUP_KEEP} 份）`,
    paths: stale.map((entry) => entry.full),
    bytes: stale.reduce((total, entry) => total + entry.bytes, 0),
    files: stale.length,
    reason: '每次数据库迁移都会留一份完整副本，旧的不再需要',
    kind: 'file',
  }
}

/** 待清理区里超过 24 小时的条目。 */
export async function planExpiredTrash(maxAgeMs = TRASH_TTL_MS): Promise<CleanupCandidate | null> {
  const records = await listTrash()
  const expired = records.filter((record) => Date.now() - Date.parse(record.createdAt) > maxAgeMs)
  if (expired.length === 0) return null
  return {
    id: 'cleanup.trash-expired',
    label: '待清理区（超过 24 小时）',
    paths: expired.map((record) => path.join(trashRoot(), record.id)),
    bytes: expired.reduce((total, record) => total + record.bytes, 0),
    files: expired.length,
    reason: '放进待清理区超过一天，可以真正删除了',
    kind: 'directory',
  }
}

/** Chromium 缓存：只统计，清理走 session.clearCache()（运行中可安全清理）。 */
export async function planBrowserCache(): Promise<CleanupCandidate | null> {
  const userData = app.getPath('userData')
  const dirs = ['Cache', 'Code Cache', 'GPUCache'].map((name) => path.join(userData, name))
  const sized = await sizeOfPaths(dirs)
  if (sized.bytes === 0) return null
  return {
    id: 'cleanup.browser-cache',
    label: '浏览器缓存',
    paths: dirs,
    bytes: sized.bytes,
    files: sized.files,
    reason: 'Chromium 的网络与代码缓存，清掉后首屏会略慢一点，但可重建',
    kind: 'directory',
  }
}

export async function planCleanup(): Promise<CleanupCandidate[]> {
  const candidates = await Promise.all([planMigrationBackupCleanup(), planExpiredTrash(), planBrowserCache()])
  return candidates.filter((candidate): candidate is CleanupCandidate => candidate !== null)
}

/** 把一组路径移进待清理区（不删除）。返回记录，供还原使用。 */
export async function moveToTrash(candidate: CleanupCandidate): Promise<TrashRecord[]> {
  const root = trashRoot()
  await fs.mkdir(root, { recursive: true })
  const records: TrashRecord[] = []

  for (const source of candidate.paths) {
    const id = `${stamp()}-${crypto.randomUUID().slice(0, 8)}`
    const bucket = path.join(root, id)
    const payload = path.join(bucket, 'payload')
    try {
      await fs.mkdir(bucket, { recursive: true })
      const stat = await fs.stat(source)
      const kind: 'file' | 'directory' = stat.isDirectory() ? 'directory' : 'file'
      const bytes = kind === 'file' ? stat.size : (await sizeOfPath(source)).bytes
      await fs.rename(source, payload)
      const record: TrashRecord = {
        id,
        label: path.basename(source),
        originalPath: source,
        bytes,
        reason: candidate.reason,
        createdAt: new Date().toISOString(),
        kind,
      }
      await fs.writeFile(path.join(bucket, 'record.json'), JSON.stringify(record, null, 2), 'utf8')
      records.push(record)
    } catch (error) {
      // 单个文件移动失败（被占用等）不影响其余项；把空桶收掉。
      await fs.rm(bucket, { recursive: true, force: true }).catch((error: unknown) => {
        logEvent("debug", "storage", "清理空桶失败", { context: error instanceof Error ? error.message : String(error) })
      })
      logEvent('warn', 'storage', 'Move to trash failed', {
        context: `${source}: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'STORAGE_TRASH_MOVE_FAILED',
        retryable: true,
      })
    }
  }
  return records
}

export async function listTrash(): Promise<TrashRecord[]> {
  const root = trashRoot()
  let entries: string[] = []
  try {
    entries = await fs.readdir(root)
  } catch (error) {
    // 没有 trash 目录是最常见的正常状态（还没清理过任何东西），只记 debug。
    logEvent('debug', 'storage', '待清理区尚未创建', { context: error instanceof Error ? error.message : String(error) })
    return []
  }
  const records: TrashRecord[] = []
  for (const entry of entries) {
    try {
      const raw = await fs.readFile(path.join(root, entry, 'record.json'), 'utf8')
      records.push(JSON.parse(raw) as TrashRecord)
    } catch (error) {
      logEvent('warn', 'storage', '待清理区条目损坏，已跳过', { context: `${entry}: ${error instanceof Error ? error.message : String(error)}`, errorCode: 'STORAGE_TRASH_CORRUPT', retryable: false })
    }
  }
  return records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

export async function restoreTrash(id: string): Promise<void> {
  const bucket = path.join(trashRoot(), id)
  const record = JSON.parse(await fs.readFile(path.join(bucket, 'record.json'), 'utf8')) as TrashRecord
  const payload = path.join(bucket, 'payload')
  await fs.mkdir(path.dirname(record.originalPath), { recursive: true })
  // 目标已存在时不覆盖：还原一个文件不应该顺手毁掉另一个。
  if (await statOrNull(record.originalPath, 'restore-target') !== null) {
    throw new Error(`原位置已有同名文件，未还原：${record.originalPath}`)
  }
  await fs.rename(payload, record.originalPath)
  await fs.rm(bucket, { recursive: true, force: true })
}

export async function purgeTrash(id?: string): Promise<{ removed: number; bytes: number }> {
  const root = trashRoot()
  if (id) {
    const record = (await listTrash()).find((item) => item.id === id)
    const bytes = record?.bytes ?? 0
    await fs.rm(path.join(root, id), { recursive: true, force: true })
    return { removed: 1, bytes }
  }
  const records = await listTrash()
  const bytes = records.reduce((total, record) => total + record.bytes, 0)
  await fs.rm(root, { recursive: true, force: true })
  return { removed: records.length, bytes }
}

/** 启动时调用：清掉过期的 trash 与超期的迁移备份。 */
export async function runStartupCleanup(): Promise<void> {
  try {
    const candidates = await planCleanup()
    for (const candidate of candidates) {
      if (candidate.id === 'cleanup.browser-cache') continue // 缓存由用户手动清
      if (candidate.id === 'cleanup.trash-expired') {
        await purgeTrash()
        continue
      }
      await moveToTrash(candidate)
    }
  } catch (error) {
    logEvent('warn', 'storage', 'Startup cleanup skipped', {
      context: error instanceof Error ? error.message : String(error),
      errorCode: 'STORAGE_CLEANUP_FAILED',
      retryable: true,
    })
  }
}
