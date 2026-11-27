// 备份包导出 / 导入检查 / 诊断包。
//
// 复用而不是重写的地方：
//  * 数据库快照用 `VACUUM INTO`（免 online-backup API，且只读句柄也能跑，实测 9.3MB → 7.9MB）；
//  * 替换整库交给 `importDatabase()`（它已经有 staging、integrity、回退和 `.before-import-*.bak`）。
//
// 这里只负责三件新事：打包成 zip、写/校验 manifest、把 zip 里的库解出来交给上面的函数。
// 每个文件都记 sha256，导入前逐个核对——半个包把库换掉是最难挽回的事故。

import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import yauzl from 'yauzl'
import { ZipFile } from 'yazl'
import { CURRENT_SCHEMA_VERSION, getDatabase, getDatabasePath, importDatabase, probeSchemaVersion } from '../database'
import { buildStorageInventory } from './storage-inventory.service'
import { insertRowsIntoTable, readPartialPayloads, sortTablesForImport, writeNdjsonPayload, type ConflictPolicy } from './storage-selective.service'
import { logEvent } from './logger.service'
import {
  BACKUP_FORMAT,
  type BackupFile,
  type BackupItem,
  type BackupManifest,
  type ImportApplyResult,
  type ImportInspection,
  type TransferProgress,
} from '../../shared/storage-transfer-types'

type ProgressSink = (progress: TransferProgress) => void

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

interface ZipEntry {
  readonly name: string
  readonly filePath?: string
  readonly buffer?: Buffer
}

async function writeZip(targetPath: string, entries: readonly ZipEntry[], onProgress?: ProgressSink): Promise<void> {
  const zip = new ZipFile()
  for (const entry of entries) {
    if (entry.buffer) zip.addBuffer(entry.buffer, entry.name)
    else if (entry.filePath) zip.addFile(entry.filePath, entry.name)
    else throw new Error('zip entry 缺少内容：' + entry.name)
  }
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(targetPath)
    zip.outputStream.on('error', reject)
    out.on('error', reject)
    out.on('close', () => resolve())
    zip.outputStream.pipe(out)
    zip.end()
  })
  onProgress?.({ phase: 'done', message: '已写入 ' + path.basename(targetPath) })
}

/** 读 zip 里的单个条目（只用于 manifest 这种小文件，带大小上限）。 */
async function readZipEntry(zipPath: string, wanted: string, limitBytes = 8 * 1024 * 1024): Promise<Buffer | null> {
  return await new Promise<Buffer | null>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('无法打开压缩包')); return }
      let settled = false
      const finish = (value: Buffer | null) => { if (!settled) { settled = true; resolve(value) } }
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== wanted) { zip.readEntry(); return }
        if (entry.uncompressedSize > limitBytes) { zip.close(); finish(null); return }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { zip.close(); finish(null); return }
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => { zip.close(); finish(Buffer.concat(chunks)) })
          stream.on('error', () => { zip.close(); finish(null) })
        })
      })
      zip.on('end', () => finish(null))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/** 把 zip 里的某个条目解到磁盘，同时算 sha256。 */
async function extractZipEntry(zipPath: string, wanted: string, destPath: string): Promise<{ sha256: string; bytes: number }> {
  return await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('无法打开压缩包')); return }
      let found = false
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== wanted) { zip.readEntry(); return }
        found = true
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { zip.close(); reject(streamError ?? new Error('无法读取 ' + wanted)); return }
          const hash = crypto.createHash('sha256')
          let bytes = 0
          const out = fs.createWriteStream(destPath)
          stream.on('data', (chunk: Buffer) => { bytes += chunk.length; hash.update(chunk) })
          stream.pipe(out)
          out.on('close', () => { zip.close(); resolve({ sha256: hash.digest('hex'), bytes }) })
          out.on('error', (writeError) => { zip.close(); reject(writeError) })
        })
      })
      zip.on('end', () => { if (!found) reject(new Error('压缩包内缺少 ' + wanted)) })
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

function collectItemsFromInventory(entries: { id: string; label: string; domain: string; rows?: number }[]): BackupItem[] {
  return entries.map((entry) => ({ id: entry.id, label: entry.label, domain: entry.domain, ...(entry.rows !== undefined ? { rows: entry.rows } : {}) }))
}

export interface ExportOptions {
  /** 是否把媒体文件一起打包（体积可能很大）。 */
  readonly includeMedia?: boolean
  /** 只导出这些条目（`db.<table>`）；为空时导出整库。 */
  readonly entryIds?: readonly string[]
}

/** 完整备份：VACUUM INTO 快照 + manifest + 可选媒体文件。 */
export async function exportFullBackup(targetPath: string, options: ExportOptions = {}, onProgress?: ProgressSink): Promise<BackupManifest> {
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'grimoire-backup-'))
  const snapshotPath = path.join(stagingDir, 'grimoire.db')
  try {
    onProgress?.({ phase: 'preparing', message: '正在生成数据库快照' })
    const db = getDatabase()
    const escaped = snapshotPath.replace(/\\/g, '/').replace(/'/g, "''")
    db.exec(`VACUUM INTO '${escaped}'`)

    const dbSha = await sha256File(snapshotPath)
    const dbBytes = (await fsp.stat(snapshotPath)).size
    const inventory = await buildStorageInventory()
    const items = collectItemsFromInventory(
      inventory.groups.flatMap((group) => group.entries).filter((entry) => entry.kind === 'table'),
    )

    const files: BackupFile[] = [{ path: 'db/grimoire.db', bytes: dbBytes, sha256: dbSha }]
    const zipEntries: ZipEntry[] = [{ name: 'db/grimoire.db', filePath: snapshotPath }]

    if (options.includeMedia) {
      const mediaDir = path.join(app.getPath('userData'), 'media')
      if (fs.existsSync(mediaDir)) {
        onProgress?.({ phase: 'compressing', message: '正在收集媒体文件' })
        const walk = async (dir: string): Promise<void> => {
          for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, item.name)
            if (item.isDirectory()) { await walk(full); continue }
            if (!item.isFile()) continue
            const relative = path.relative(mediaDir, full).split(path.sep).join('/')
            const name = 'files/media/' + relative
            const bytes = (await fsp.stat(full)).size
            files.push({ path: name, bytes, sha256: await sha256File(full) })
            zipEntries.push({ name, filePath: full })
          }
        }
        await walk(mediaDir)
      }
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      kind: 'full',
      appVersion: app.getVersion(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      items,
      files,
      totals: { bytes: files.reduce((total, file) => total + file.bytes, 0), entries: items.length },
    }
    zipEntries.unshift({ name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })

    onProgress?.({ phase: 'compressing', message: '正在打包' })
    await writeZip(targetPath, zipEntries, onProgress)
    return manifest
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true })
  }
}

/** 诊断包：环境 + 校验结果 + 行数 + 日志，便于离线看问题。 */
export async function exportDiagnostics(targetPath: string, onProgress?: ProgressSink): Promise<BackupManifest> {
  onProgress?.({ phase: 'preparing', message: '正在收集诊断信息' })
  const db = getDatabase()
  const integrity = db.exec('PRAGMA integrity_check')
  const rowsByTable: Record<string, number> = {}
  const tables = (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []) as unknown[][]
  for (const row of tables) {
    const table = String(row[0])
    try {
      const count = db.exec(`SELECT COUNT(*) FROM "${table.replaceAll('"', '""')}"`)
      rowsByTable[table] = Number(count[0]?.values?.[0]?.[0] ?? 0)
    } catch {
      rowsByTable[table] = -1
    }
  }
  const diagnostics = {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    integrity: integrity[0]?.values?.[0]?.[0] ?? 'unknown',
    databasePath: getDatabasePath(),
    databaseBytes: fs.existsSync(getDatabasePath()) ? fs.statSync(getDatabasePath()).size : 0,
    rowsByTable,
  }

  const logPath = path.join(app.getPath('userData'), 'grimoire.log.jsonl')
  const entries: ZipEntry[] = []
  if (fs.existsSync(logPath)) {
    // 只带最后 2MB：诊断看的是最近一次启动，完整日志可能几百 MB。
    const size = fs.statSync(logPath).size
    const start = Math.max(0, size - 2 * 1024 * 1024)
    const handle = await fsp.open(logPath, 'r')
    try {
      const buffer = Buffer.alloc(size - start)
      await handle.read(buffer, 0, buffer.length, start)
      entries.push({ name: 'logs/grimoire.log.jsonl', buffer })
    } finally {
      await handle.close()
    }
  }

  const payload = Buffer.from(JSON.stringify(diagnostics, null, 2), 'utf8')
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    kind: 'diagnostics',
    appVersion: app.getVersion(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    platform: process.platform,
    items: [{ id: 'diagnostics', label: '诊断摘要', domain: 'runtime' }],
    files: [{ path: 'diagnostics.json', bytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex') }],
    totals: { bytes: payload.length, entries: 1 },
  }
  await writeZip(targetPath, [{ name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }, { name: 'diagnostics.json', buffer: payload }, ...entries], onProgress)
  return manifest
}

/** 识别一个待导入文件：zip（full/partial/diagnostics）或裸 .db。 */
export async function inspectImport(filePath: string): Promise<ImportInspection> {
  if (!fs.existsSync(filePath)) throw new Error('文件不存在：' + filePath)
  const lower = filePath.toLowerCase()
  const base = { path: filePath, items: [], files: [], totals: { bytes: fs.statSync(filePath).size, entries: 0 } }

  if (lower.endsWith('.db')) {
    const version = probeSchemaVersion(filePath)
    const compatible = version !== null && version <= CURRENT_SCHEMA_VERSION
    return {
      ...base,
      kind: 'database',
      schemaVersion: version ?? undefined,
      compatible,
      reason: version === null ? '无法读取数据库结构版本（可能不是 Grimoire 数据库）'
        : version > CURRENT_SCHEMA_VERSION ? `数据库版本 schema ${version} 高于当前应用（${CURRENT_SCHEMA_VERSION}），请先升级应用` : undefined,
    }
  }

  let raw: Buffer | null = null
  try {
    raw = await readZipEntry(filePath, 'manifest.json')
  } catch (error) {
    // yauzl 抛的是英文（End of central directory…），用户看不懂；换成能行动的说明。
    const detail = error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error)
    throw new Error('这个文件不是 zip 压缩包，或者已经损坏：' + detail)
  }
  if (!raw) throw new Error('压缩包内缺少 manifest.json，无法识别为 Grimoire 备份')
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(raw.toString('utf8')) as BackupManifest
  } catch {
    throw new Error('manifest.json 不是合法 JSON')
  }
  if (manifest.format !== BACKUP_FORMAT) throw new Error('不支持的备份格式：' + String(manifest.format))

  const compatible = manifest.schemaVersion <= CURRENT_SCHEMA_VERSION
  return {
    path: filePath,
    kind: manifest.kind === 'full' ? 'full' : manifest.kind === 'diagnostics' ? 'partial' : 'partial',
    appVersion: manifest.appVersion,
    schemaVersion: manifest.schemaVersion,
    createdAt: manifest.createdAt,
    compatible,
    reason: compatible ? undefined : `备份来自 schema ${manifest.schemaVersion}，高于当前应用（${CURRENT_SCHEMA_VERSION}）`,
    items: manifest.items,
    files: manifest.files,
    totals: manifest.totals,
  }
}

export interface ApplyImportOptions {
  /** 导入前是否再校验一次每个文件的 sha256（默认开）。 */
  readonly verifyChecksums?: boolean
  /** partial：只导入这些表（空 = 全部）。 */
  readonly tables?: readonly string[]
  /** partial：冲突策略。 */
  readonly conflict?: ConflictPolicy
}

/** 导入：full/database 替换整库（复用 importDatabase 的 staging 与回退），partial 暂时拒绝。 */
export async function applyImport(filePath: string, options: ApplyImportOptions = {}, onProgress?: ProgressSink): Promise<ImportApplyResult> {
  const inspection = await inspectImport(filePath)
  if (!inspection.compatible) throw new Error(inspection.reason ?? '该文件与当前版本不兼容')

  if (inspection.kind === 'partial') {
    const result = await importSelection(filePath, options.tables ?? [], options.conflict ?? 'keep-both', onProgress)
    return { kind: 'partial', restartRequired: false, restoredEntries: result.inserted }
  }

  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'grimoire-import-'))
  try {
    let dbPath = filePath
    if (inspection.kind === 'full') {
      onProgress?.({ phase: 'preparing', message: '正在解出数据库' })
      const target = path.join(stagingDir, 'grimoire.db')
      const extracted = await extractZipEntry(filePath, 'db/grimoire.db', target)
      const expected = inspection.files.find((file) => file.path === 'db/grimoire.db')
      if (options.verifyChecksums !== false && expected && expected.sha256 !== extracted.sha256) {
        throw new Error('备份包内的数据库校验失败（sha256 不匹配），已中止，当前数据未被改动')
      }
      dbPath = target
    }

    onProgress?.({ phase: 'verifying', message: '正在校验并替换数据库' })
    const before = Date.now()
    importDatabase(dbPath)
    logEvent('info', 'storage', 'Database restored from backup', { context: `${inspection.kind} ${Date.now() - before}ms` })
    onProgress?.({ phase: 'done', message: '导入完成' })
    return { kind: inspection.kind, restartRequired: true, restoredEntries: 1 }
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true })
  }
}


// ── 选择性导出 ────────────────────────────────────────────────────────────────────────────

/** 选中的表依赖哪些父表：没有父表数据时，导入会因为外键失败或被孤立。 */
const TABLE_DEPENDENCIES: Record<string, readonly string[]> = {
  categories: ['tag_groups'],
  subcategories: ['categories'],
  tags: ['subcategories'],
  tag_aliases: ['tags'],
  tag_relations: ['tags'],
  tag_metadata: ['tags'],
  tag_usage: ['tags'],
  tag_suggestions: ['tags'],
  favorites: ['tags'],
  sub_favorites: ['subcategories'],
  prompt_assets: ['prompt_asset_categories'],
  prompt_asset_category_links: ['prompt_assets', 'prompt_asset_categories'],
  asset_tag_links: ['prompt_assets', 'tags'],
}

function withDependencies(tables: readonly string[]): string[] {
  const result = new Set<string>()
  const visit = (table: string) => {
    if (result.has(table)) return
    result.add(table)
    for (const parent of TABLE_DEPENDENCIES[table] ?? []) visit(parent)
  }
  for (const table of tables) visit(table)
  return sortTablesForImport([...result])
}

function tableFromEntryId(entryId: string): string | null {
  return entryId.startsWith('db.') ? entryId.slice(3) : null
}

/** 按条目导出：每张表一个 NDJSON，manifest 记行数与 sha256，自动补父表。 */
export async function exportSelection(entryIds: readonly string[], targetPath: string, onProgress?: ProgressSink): Promise<BackupManifest> {
  const requested = entryIds.map(tableFromEntryId).filter((table): table is string => Boolean(table))
  if (requested.length === 0) throw new Error('没有可导出的条目')
  const tables = withDependencies(requested)

  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'grimoire-selection-'))
  try {
    const db = getDatabase()
    const items: BackupItem[] = []
    const files: BackupFile[] = []
    const zipEntries: ZipEntry[] = []

    for (const table of tables) {
      onProgress?.({ phase: 'preparing', message: '读取 ' + table })
      let rows: Record<string, unknown>[] = []
      try {
        const result = db.exec('SELECT * FROM "' + table.replaceAll('"', '""') + '"')
        const columns = result[0]?.columns ?? []
        rows = (result[0]?.values ?? []).map((values) => {
          const row: Record<string, unknown> = {}
          columns.forEach((column, index) => { row[column] = values[index] })
          return row
        })
      } catch (error) {
        throw new Error('读取表 ' + table + ' 失败：' + (error instanceof Error ? error.message : String(error)))
      }
      const filePath = await writeNdjsonPayload(stagingDir, table, rows)
      const bytes = (await fsp.stat(filePath)).size
      const sha256 = await sha256File(filePath)
      zipEntries.push({ name: 'data/' + table + '.ndjson', filePath })
      files.push({ path: 'data/' + table + '.ndjson', bytes, sha256 })
      items.push({ id: 'db.' + table, label: table, domain: 'other', rows: rows.length, payload: 'data/' + table + '.ndjson' })
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      kind: 'partial',
      appVersion: app.getVersion(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      items,
      files,
      totals: { bytes: files.reduce((total, entry) => total + entry.bytes, 0), entries: items.length },
    }
    zipEntries.unshift({ name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })
    await writeZip(targetPath, zipEntries, onProgress)
    return manifest
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true })
  }
}

export interface PartialImportResult {
  readonly tables: ReadonlyArray<{ table: string; inserted: number; skipped: number; renamed: number; failed: number }>
  readonly inserted: number
  readonly skipped: number
  readonly renamed: number
}

/** partial 导入：单事务、按父表优先顺序写回；任何一步抛错整体回滚。 */
export async function importSelection(
  filePath: string,
  tables: readonly string[],
  conflict: ConflictPolicy = 'keep-both',
  onProgress?: ProgressSink,
): Promise<PartialImportResult> {
  const inspection = await inspectImport(filePath)
  if (inspection.kind !== 'partial') throw new Error('这不是选择性备份包')
  if (!inspection.compatible) throw new Error(inspection.reason ?? '该备份与当前版本不兼容')

  const available = inspection.items.map((item) => tableFromEntryId(item.id)).filter((table): table is string => Boolean(table))
  const selected = tables.length > 0 ? tables.filter((table) => available.includes(table)) : available
  if (selected.length === 0) throw new Error('没有选中任何可导入的条目')

  const ordered = sortTablesForImport(selected)
  onProgress?.({ phase: 'preparing', message: '正在读取包内容' })
  const payloads = await readPartialPayloads(filePath, ordered)

  const db = getDatabase()
  const stats: { table: string; inserted: number; skipped: number; renamed: number; failed: number }[] = []
  db.run('BEGIN')
  try {
    for (const table of ordered) {
      const rows = payloads.get(table) ?? []
      onProgress?.({ phase: 'writing', message: '写入 ' + table, current: table })
      const result = insertRowsIntoTable(db, table, rows, conflict)
      stats.push({ table, inserted: result.inserted, skipped: result.skipped, renamed: result.renamed, failed: result.failed.length })
    }
    db.run('COMMIT')
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* 已经回滚 */ }
    throw error
  }

  return {
    tables: stats,
    inserted: stats.reduce((total, entry) => total + entry.inserted, 0),
    skipped: stats.reduce((total, entry) => total + entry.skipped, 0),
    renamed: stats.reduce((total, entry) => total + entry.renamed, 0),
  }
}

export async function resolveDefaultExportName(): Promise<string> {
  return `grimoire-backup-${app.getVersion()}-${nowStamp()}.zip`
}
