// 数据面清单：把「数据库 69 张表 + userData 目录 + 包内资源」汇总成一份可展示的清单。
//
// 关键实现事实（2026-11-27 实测于本机 9.3MB / 69 表库）：
//  * `dbstat` 可用，能给出每张表**含索引**的真实字节数（`SELECT SUM(pgsize) FROM dbstat GROUP BY name`）。
//    索引行通过 `PRAGMA index_list(<table>)` 归并回所属表，UI 只显示表，避免 69 行里混入几十个 idx_*。
//  * 表行数逐表 `COUNT(*)` 在 9MB 库上是毫秒级；库再大也只是线性增长，仍然远快于目录遍历。
//  * 目录体积走 storage-size.service（异步 + 并发 + 缓存 + 上限），拿不到就给 null 由 UI 显示「—」，
//    绝不把「不知道」渲染成 0。
//  * dbstat / index_list 失败时降级为 null 并把 approximate 置 true，不让整个面板变红。

import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getDatabase } from '../database'
import { logEvent } from './logger.service'
import { sizeOfMatchingFiles, sizeOfPath, sizeOfPaths, type SizedPath } from './storage-size.service'
import {
  STORAGE_DOMAINS_ORDER,
  findStorageTable,
  isInternalTable,
  STORAGE_PATHS,
  type StoragePathSpec,
} from '../../shared/storage-registry'
import {
  STORAGE_DOMAIN_LABELS,
  sumDomain,
  type StorageDomain,
  type StorageEntry,
  type StorageGroup,
  type StorageInventory,
} from '../../shared/storage-types'

const DB_PARTS_TTL_MS = 10 * 1000
let dbPartsCache: { at: number; value: { entries: StorageEntry[]; unmapped: string[]; approximate: boolean } } | null = null

function quoteIdentifier(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"'
}

function rowsOf(result: ReturnType<ReturnType<typeof getDatabase>['exec']>): unknown[][] {
  return result?.[0]?.values ?? []
}

function packageDataRoot(): string {
  // 打包后资源在 app.asar 内的 dist/main/data；未打包时在仓库根的 data/。
  // 用 app.getAppPath() 而不是数 __dirname 的层数：层数在 src/dist/打包三种形态下都会变，
  // 2026-11-27 实测就因为少了一级把路径指到了上一层的 data/。
  return app.isPackaged
    ? path.join(app.getAppPath(), 'dist', 'main', 'data')
    : path.join(app.getAppPath(), 'data')
}

function userDataRoot(): string {
  return app.getPath('userData')
}

/** 采集数据库侧（表字节、行数、未映射表）。失败时降级而不是抛错。 */
function collectDatabaseParts(): { entries: StorageEntry[]; unmapped: string[]; approximate: boolean } {
  if (dbPartsCache && Date.now() - dbPartsCache.at < DB_PARTS_TTL_MS) return dbPartsCache.value
  const entries: StorageEntry[] = []
  const unmapped: string[] = []
  let approximate = false

  let tableNames: string[] = []
  try {
    const db = getDatabase()
    tableNames = rowsOf(db.exec('SELECT name FROM sqlite_master WHERE type=? ORDER BY name', ['table']))
      .map((row) => String(row[0]))
      .filter((name) => !isInternalTable(name))
  } catch (error) {
    logEvent('warn', 'storage', '读取 sqlite_master 失败', { context: String(error), errorCode: 'STORAGE_SCHEMA_READ_FAILED', retryable: true })
    return { entries, unmapped, approximate: true }
  }

  // dbstat：表与索引的页字节。不可用时全部记 null。
  const pageBytes = new Map<string, number>()
  try {
    const db = getDatabase()
    for (const row of rowsOf(db.exec('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name'))) {
      pageBytes.set(String(row[0]), Number(row[1] ?? 0))
    }
  } catch (error) {
    approximate = true
    logEvent('warn', 'storage', 'dbstat 不可用，表体积将显示为未知', { context: String(error), errorCode: 'STORAGE_DBSTAT_UNAVAILABLE', retryable: false })
  }

  const db = getDatabase()
  const indexBytes = (table: string): number => {
    if (pageBytes.size === 0) return 0
    let total = 0
    try {
      for (const row of rowsOf(db.exec(`PRAGMA index_list(${quoteIdentifier(table)})`))) {
        const indexName = String(row[1])
        total += pageBytes.get(indexName) ?? 0
      }
    } catch {
      // index_list 不可用：只算表页，不影响主流程
    }
    return total
  }

  for (const table of tableNames) {
    const spec = findStorageTable(table)
    let rows: number | undefined
    try {
      rows = Number(rowsOf(db.exec(`SELECT COUNT(*) FROM ${quoteIdentifier(table)}`))[0]?.[0] ?? 0)
    } catch {
      rows = undefined
    }
    const tableBytes = pageBytes.size > 0 ? (pageBytes.get(table) ?? 0) + indexBytes(table) : null
    if (!spec) {
      unmapped.push(table)
      entries.push({
        id: `db.${table}`,
        kind: 'table',
        domain: 'other',
      subgroup: '未映射',
        label: table,
        location: `db:${table}`,
        bytes: tableBytes,
        rows,
        exportable: false,
        importable: false,
        migratable: false,
        cleanable: false,
        note: '未在数据面注册表中映射',
      })
      continue
    }
    entries.push({
      id: `db.${table}`,
      kind: 'table',
      domain: spec.domain,
      subgroup: spec.subgroup,
      label: spec.label,
      location: `db:${table}`,
      bytes: tableBytes,
      rows,
      exportable: Boolean(spec.exportable),
      importable: Boolean(spec.exportable),
      migratable: false,
      cleanable: false,
    })
  }

  if (unmapped.length > 0) {
    logEvent('warn', 'storage', '存在未映射的数据表', { context: unmapped.join(','), errorCode: 'STORAGE_UNMAPPED_TABLES', retryable: false })
  }

  const value = { entries, unmapped, approximate }
  dbPartsCache = { at: Date.now(), value }
  return value
}

/** Chromium 缓存目录：只算总量，不向下细分（用户不需要知道每个 cache 子目录）。 */
const CHROMIUM_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Partitions']

async function sizedForPath(spec: StoragePathSpec, force: boolean): Promise<SizedPath> {
  const root = spec.base === 'userData' ? userDataRoot() : packageDataRoot()
  if (spec.id === 'files.migration-backups') {
    return await sizeOfMatchingFiles(root, (name) => name.startsWith('grimoire.db.pre-migration-') && name.endsWith('.bak'))
  }
  if (spec.id === 'files.chromium-cache') {
    return await sizeOfPaths(CHROMIUM_CACHE_DIRS.map((dir) => path.join(root, dir)), { force })
  }
  return await sizeOfPath(path.join(root, ...spec.segments), { force })
}

export interface InventoryOptions {
  /** 忽略缓存重新统计（面板上的「刷新」）。 */
  force?: boolean
}

export async function buildStorageInventory(options: InventoryOptions = {}): Promise<StorageInventory> {
  const force = Boolean(options.force)
  const dbParts = collectDatabaseParts()
  const fileEntries: StorageEntry[] = []

  for (const spec of STORAGE_PATHS) {
    const sized = await sizedForPath(spec, force)
    const locationPath = spec.base === 'userData' ? userDataRoot() : packageDataRoot()
    const target = spec.id === 'files.migration-backups' || spec.id === 'files.chromium-cache'
      ? locationPath
      : path.join(locationPath, ...spec.segments)
    let lastWrite: string | undefined
    try {
      lastWrite = (await fs.stat(target)).mtime.toISOString()
    } catch {
      lastWrite = undefined
    }
    fileEntries.push({
      id: spec.id,
      kind: spec.kind,
      domain: spec.domain,
      subgroup: spec.subgroup,
      label: spec.label,
      location: target,
      bytes: sized.bytes,
      files: sized.files,
      lastWrite,
      exportable: spec.exportable,
      importable: spec.exportable && spec.kind !== 'package',
      migratable: spec.migratable,
      cleanable: spec.cleanable,
      ...(spec.note ? { note: spec.note } : {}),
      ...(sized.truncated ? { note: (spec.note ? spec.note + '；' : '') + '体积为下限（扫描超时或文件过多）' } : {}),
    })
  }

  const allEntries = [...dbParts.entries, ...fileEntries]
  const groups: StorageGroup[] = []
  for (const domain of STORAGE_DOMAINS_ORDER) {
    // 组内按体积降序，未统计的排末尾：面板先展示「谁在吃空间」，而不是字母表顺序。
    const entries = allEntries
      .filter((entry) => entry.domain === domain)
      .sort((left, right) => (right.bytes ?? -1) - (left.bytes ?? -1))
    if (entries.length === 0) continue

    // 子组按注册表里的出现顺序（不是字母序），保证「本体 → 别名与关系 → 收藏与统计」这类
    // 业务顺序稳定；聚合字节与完整度由共享 helper 算，UI 不再自己加。
    const order: string[] = []
    const buckets = new Map<string, StorageEntry[]>()
    for (const entry of entries) {
      if (!buckets.has(entry.subgroup)) {
        buckets.set(entry.subgroup, [])
        order.push(entry.subgroup)
      }
      buckets.get(entry.subgroup)!.push(entry)
    }
    const subgroups = order.map((key) => {
      const bucket = buckets.get(key)!
      const summed = sumDomain(bucket)
      return { key, label: key, bytes: summed.bytes, complete: summed.complete, entries: bucket }
    })

    const summed = sumDomain(entries)
    groups.push({
      domain: domain as StorageDomain,
      label: STORAGE_DOMAIN_LABELS[domain],
      bytes: summed.bytes,
      complete: summed.complete,
      entries,
      subgroups,
    })
  }

  const totalBytes = groups.reduce((total, group) => total + group.bytes, 0)
  return {
    generatedAt: new Date().toISOString(),
    totalBytes,
    groups,
    unmappedTables: dbParts.unmapped,
    approximate: dbParts.approximate,
  }
}
