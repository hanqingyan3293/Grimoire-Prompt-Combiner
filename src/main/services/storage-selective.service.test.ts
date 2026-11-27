// @vitest-environment node
// 选择性导入的写入器：顺序、缺列容错、三种冲突策略。
// 用一个最小的内存 PartialDb 代替 SQLite，把「行为」和「SQLite 细节」分开测。
import { describe, expect, it } from 'vitest'
import { insertRowsIntoTable, sortTablesForImport, type PartialDb } from './storage-selective.service'

interface FakeOptions {
  columns: { name: string; pk?: boolean }[]
  /** 主键值集合，用于模拟 UNIQUE 冲突。 */
  existingKeys?: string[]
}

function fakeDb({ columns, existingKeys = [] }: FakeOptions): PartialDb & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = []
  const keys = new Set(existingKeys)
  const pk = columns.find((column) => column.pk)?.name
  return {
    rows,
    exec(sql: string) {
      if (/PRAGMA table_info/.test(sql)) {
        return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: columns.map((column, index) => [index, column.name, 'TEXT', 1, null, column.pk ? 1 : 0]) }]
      }
      return [{ columns: [], values: [] }]
    },
    run(sql: string, parameters: unknown[] = []) {
      const ignore = /OR IGNORE/.test(sql)
      const replace = /OR REPLACE/.test(sql)
      if (pk) {
        const pkIndex = columns.findIndex((column) => column.pk)
        const value = String(parameters[pkIndex])
        const conflict = keys.has(value)
        if (conflict && ignore) return { changes: 0 }
        if (conflict && !replace) throw new Error('UNIQUE constraint failed: ' + pk)
        keys.add(value)
      }
      rows.push(Object.fromEntries(parameters.map((value, index) => [columns[index].name, value])))
      return { changes: 1 }
    },
  }
}

const columns = [{ name: 'id', pk: true }, { name: 'name' }, { name: 'group_id' }]

describe('selective import writer', () => {
  it('writes every row when there is no conflict', () => {
    const db = fakeDb({ columns })
    const result = insertRowsIntoTable(db, 'tags', [{ id: 'a', name: 'A', group_id: 'g' }, { id: 'b', name: 'B', group_id: 'g' }], 'keep-both')
    expect(result.inserted).toBe(2)
    expect(db.rows).toHaveLength(2)
  })

  it('skip leaves conflicting rows untouched', () => {
    const db = fakeDb({ columns, existingKeys: ['a'] })
    const result = insertRowsIntoTable(db, 'tags', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'skip')
    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(1)
    expect(db.rows.map((row) => row.id)).toEqual(['b'])
  })

  it('keep-both renames the primary key instead of dropping the row', () => {
    const db = fakeDb({ columns, existingKeys: ['a'] })
    const result = insertRowsIntoTable(db, 'tags', [{ id: 'a', name: 'A' }], 'keep-both')
    expect(result.inserted).toBe(1)
    expect(result.renamed).toBe(1)
    const written = String(db.rows[0].id)
    expect(written.startsWith('imp_')).toBe(true)
    expect(written).not.toBe('a')
  })

  it('overwrite replaces the existing key', () => {
    const db = fakeDb({ columns, existingKeys: ['a'] })
    const result = insertRowsIntoTable(db, 'tags', [{ id: 'a', name: 'A2' }], 'overwrite')
    expect(result.inserted).toBe(1)
    expect(db.rows[0].name).toBe('A2')
  })

  it('drops columns the target table does not have', () => {
    const db = fakeDb({ columns })
    const result = insertRowsIntoTable(db, 'tags', [{ id: 'a', name: 'A', ghost_column: 'x' }], 'skip')
    expect(result.inserted).toBe(1)
    expect(db.rows[0]).not.toHaveProperty('ghost_column')
  })

  it('orders parents before children', () => {
    expect(sortTablesForImport(['tags', 'tag_groups', 'categories', 'subcategories'])).toEqual([
      'tag_groups', 'categories', 'subcategories', 'tags',
    ])
    // 未列入顺序表的表排在已知表之后，且彼此按字母序，保证结果稳定
    expect(sortTablesForImport(['zebra', 'alpha', 'tags'])).toEqual(['tags', 'alpha', 'zebra'])
  })
})
