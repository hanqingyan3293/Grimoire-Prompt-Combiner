// 选择性导出 / 导入（partial）：按表导出 NDJSON，导入时按外键顺序在单事务里写回。
//
// 为什么按「表」而不是按「行」：面板的勾选粒度是 `db.tags` 这种条目；按行选需要先做一个
// 万级数据的虚拟列表，成本远超收益，而用户真正想说的通常是「把这套标签组带走」。
//
// 三条硬约束：
//  1. **顺序**：父表先写（tag_groups → categories → subcategories → tags → 关联表），
//     否则 `foreign_keys=ON` 的连接会直接拒绝。
//  2. **列**：不硬编码列名，用 `PRAGMA table_info` 动态取列并逐列绑定；
//     包可能来自旧版本，缺列/多列都要能报错而不是写坏。
//  3. **冲突**：skip（OR IGNORE）/ keep-both（主键冲突时改 id 再插）/ overwrite（OR REPLACE）。
//     多列主键无法安全改 id，退回 skip 并在结果里说明。

import fs from 'fs'
import path from 'path'
import yauzl from 'yauzl'

export type ConflictPolicy = 'skip' | 'keep-both' | 'overwrite'

/** 写库需要的三个最小能力，便于在测试里替换成内存实现。 */
export interface PartialDb {
  exec(sql: string, parameters?: unknown[]): { columns: string[]; values: unknown[][] }[]
  run(sql: string, parameters?: unknown[]): { changes: number | bigint }
}

const TABLE_ORDER: readonly string[] = [
  'tag_groups', 'categories', 'subcategories', 'tags',
  'tag_aliases', 'tag_relations', 'tag_metadata', 'tag_usage', 'tag_suggestions',
  'tag_saved_searches', 'favorites', 'sub_favorites',
  'prompt_asset_categories', 'prompt_assets', 'prompt_asset_category_links',
  'asset_tag_links',
  'presets', 'novelai_work', 'novelai_version', 'novelai_asset',
  'canvas_projects', 'workspace_documents',
]

function orderIndex(table: string): number {
  const index = TABLE_ORDER.indexOf(table)
  return index === -1 ? TABLE_ORDER.length : index
}

export function sortTablesForImport(tables: readonly string[]): string[] {
  return [...tables].sort((left, right) => orderIndex(left) - orderIndex(right) || left.localeCompare(right))
}

interface ColumnInfo {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}

function tableColumns(db: PartialDb, table: string): ColumnInfo[] {
  const result = db.exec(`PRAGMA table_info("${table.replaceAll('"', '""')}")`)
  const rows = result[0]?.values ?? []
  return rows.map((row) => ({
    name: String(row[1]),
    type: String(row[2] ?? ''),
    notNull: Number(row[3] ?? 0) === 1,
    pk: Number(row[5] ?? 0) > 0,
  }))
}

export interface PartialInsertResult {
  readonly table: string
  readonly inserted: number
  readonly skipped: number
  readonly renamed: number
  readonly failed: ReadonlyArray<{ row: number; reason: string }>
}

function makeRenamedId(primaryKey: string, existing: unknown, taken: Set<string>): string {
  const base = String(existing ?? 'row').slice(0, 48)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 8)
    const candidate = `imp_${base}_${suffix}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  throw new Error(`无法为 ${primaryKey} 生成不冲突的 id`)
}

/** 把一批行写进一张表。返回细粒度统计，供预演与结果展示。 */
export function insertRowsIntoTable(
  db: PartialDb,
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  policy: ConflictPolicy,
): PartialInsertResult {
  const columns = tableColumns(db, table)
  if (columns.length === 0) throw new Error(`表 ${table} 不存在或没有列`)
  const columnNames = new Set(columns.map((column) => column.name))
  const pkColumns = columns.filter((column) => column.pk)
  const singlePk = pkColumns.length === 1 ? pkColumns[0].name : null

  const insertSql = (names: readonly string[], mode: 'plain' | 'ignore' | 'replace') =>
    `INSERT ${mode === 'ignore' ? 'OR IGNORE ' : mode === 'replace' ? 'OR REPLACE ' : ''}INTO "${table}" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`

  let inserted = 0
  let skipped = 0
  let renamed = 0
  const failed: { row: number; reason: string }[] = []
  const taken = new Set<string>()

  rows.forEach((row, index) => {
    // 只写包里存在且表里也有的列：跨版本包常见缺列/多列，缺的列交给数据库默认值。
    const names = Object.keys(row).filter((key) => columnNames.has(key))
    if (names.length === 0) { failed.push({ row: index, reason: '没有可写入的列' }); return }
    const values = names.map((name) => (row[name] === undefined ? null : row[name]))

    try {
      if (policy === 'skip') {
        const result = db.run(insertSql(names, 'ignore'), values)
        if (Number(result.changes) > 0) inserted += 1
        else skipped += 1
        return
      }
      if (policy === 'overwrite') {
        db.run(insertSql(names, 'replace'), values)
        inserted += 1
        return
      }
      // keep-both：先试插，主键冲突且是单列主键时换 id 再插一次。
      try {
        db.run(insertSql(names, 'plain'), values)
        inserted += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/UNIQUE constraint failed/i.test(message) || !singlePk || !names.includes(singlePk)) {
          skipped += 1
          return
        }
        const next = { ...row }
        next[singlePk] = makeRenamedId(singlePk, row[singlePk], taken)
        const nextValues = names.map((name) => (next[name] === undefined ? null : next[name]))
        db.run(insertSql(names, 'plain'), nextValues)
        renamed += 1
        inserted += 1
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ row: index, reason: message.slice(0, 200) })
    }
  })

  return { table, inserted, skipped, renamed, failed }
}

/** 读 zip 里所有 `data/*.ndjson`，返回 表名 → 行数组。 */
export async function readPartialPayloads(zipPath: string, tables: readonly string[]): Promise<Map<string, Record<string, unknown>[]>> {
  const wanted = new Set(tables.map((table) => `data/${table}.ndjson`))
  const output = new Map<string, Record<string, unknown>[]>()
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('无法打开压缩包')); return }
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!wanted.has(entry.fileName)) { zip.readEntry(); return }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { reject(streamError ?? new Error('无法读取 ' + entry.fileName)); return }
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => {
            const table = entry.fileName.slice('data/'.length, -'.ndjson'.length)
            const rows = Buffer.concat(chunks)
              .toString('utf8')
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((line) => JSON.parse(line) as Record<string, unknown>)
            output.set(table, rows)
            zip.readEntry()
          })
          stream.on('error', reject)
        })
      })
      zip.on('end', resolve)
      zip.on('error', reject)
      zip.readEntry()
    })
  })
  return output
}

export async function writeNdjsonPayload(targetDir: string, table: string, rows: ReadonlyArray<Record<string, unknown>>): Promise<string> {
  await fs.promises.mkdir(targetDir, { recursive: true })
  const file = path.join(targetDir, `${table}.ndjson`)
  await fs.promises.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8')
  return file
}
