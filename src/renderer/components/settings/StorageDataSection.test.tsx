// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StorageDataSection } from './StorageDataSection'
import type { StorageEntry, StorageGroup, StorageInventory } from '../../../shared/storage-types'

const tagsTable: StorageEntry = {
  id: 'db.tags', kind: 'table', domain: 'tags', subgroup: '本体', label: '标签', location: 'db:tags',
  bytes: 512 * 1024, rows: 4589, exportable: true, importable: true, migratable: false, cleanable: false,
}
const aliasTable: StorageEntry = {
  id: 'db.tag_aliases', kind: 'table', domain: 'tags', subgroup: '别名与关系', label: '标签别名', location: 'db:tag_aliases',
  bytes: 1024 * 1024, rows: 9162, exportable: true, importable: true, migratable: false, cleanable: false,
}
const databaseFile: StorageEntry = {
  id: 'files.database', kind: 'file', domain: 'runtime', subgroup: '数据库', label: '数据库文件',
  location: 'C:/Users/x/AppData/Roaming/Grimoire/grimoire.db', bytes: null, files: 1,
  exportable: true, importable: true, migratable: true, cleanable: false,
  note: 'SQLite 主库，schema 42', lastWrite: '2026-11-27T10:00:00.000Z',
}

const groupOf = (domain: StorageGroup['domain'], label: string, entries: StorageEntry[]): StorageGroup => {
  const order: string[] = []
  const buckets = new Map<string, StorageEntry[]>()
  for (const entry of entries) {
    if (!buckets.has(entry.subgroup)) { buckets.set(entry.subgroup, []); order.push(entry.subgroup) }
    buckets.get(entry.subgroup)!.push(entry)
  }
  return {
    domain,
    label,
    bytes: entries.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
    complete: entries.every((entry) => entry.bytes !== null),
    entries,
    subgroups: order.map((key) => {
      const bucket = buckets.get(key)!
      const known = bucket.filter((entry) => entry.bytes !== null)
      return {
        key,
        label: key,
        bytes: known.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
        complete: known.length === bucket.length,
        entries: bucket,
      }
    }),
  }
}

const inventory: StorageInventory = {
  generatedAt: '2026-11-27T00:00:00.000Z',
  totalBytes: 3 * 1024 * 1024,
  approximate: false,
  unmappedTables: [],
  groups: [
    groupOf('tags', '标签', [tagsTable, aliasTable]),
    groupOf('runtime', '运行与环境', [databaseFile]),
  ],
}

beforeEach(() => {
  cleanup()
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { storage: { inventory: async () => inventory, scanSizes: async () => inventory } },
  })
})

describe('storage data section', () => {
  it('renders domains with their subgroup count and total', async () => {
    render(<StorageDataSection />)
    expect(await screen.findByText('数据存储')).toBeTruthy()
    expect(screen.getByText('合计 3.0 MB')).toBeTruthy()
    expect(screen.getByText('2 类 · 2 项')).toBeTruthy()
    expect(screen.getByText('1 类 · 1 项')).toBeTruthy()
  })

  it('keeps subgroups collapsed until asked, then reveals their entries', async () => {
    render(<StorageDataSection />)
    await screen.findByText('数据存储')
    // 子组默认折叠：标签表本身不可见，只有子组标题
    expect(screen.queryByText('标签别名')).toBeNull()
    fireEvent.click(screen.getByText('别名与关系'))
    expect(await screen.findByText('标签别名')).toBeTruthy()
    expect(screen.getByText('9162 行')).toBeTruthy()
    // 另一个子组不受影响（本体里的「标签」表仍是 4589 行，未展开）
    expect(screen.queryByText('4589 行')).toBeNull()
  })

  it('keeps unknown sizes as a dash instead of zero', async () => {
    render(<StorageDataSection />)
    await screen.findByText('数据存储')
    fireEvent.click(screen.getByText('数据库'))
    await waitFor(() => expect(screen.getByText('数据库文件')).toBeTruthy())
    expect(screen.queryByText('0 B')).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows the entry detail card on hover after the delay', async () => {
    render(<StorageDataSection />)
    await screen.findByText('数据存储')
    fireEvent.click(screen.getByText('别名与关系'))
    const row = (await screen.findByText('标签别名')).closest('div')!.parentElement!
    fireEvent.mouseEnter(row, { clientX: 120, clientY: 240 })
    const card = await screen.findByRole('tooltip', undefined, { timeout: 2000 })
    expect(card.textContent).toContain('db:tag_aliases')
    expect(card.textContent).toContain('可导出')
    fireEvent.mouseLeave(row)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('surfaces unmapped tables and still explains the pending actions', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { storage: { inventory: async () => ({ ...inventory, unmappedTables: ['mystery_table'] }), scanSizes: async () => inventory } },
    })
    render(<StorageDataSection />)
    expect(await screen.findByText(/mystery_table/)).toBeTruthy()
    expect(screen.getByText(/迁移与清理会在后续版本接入/)).toBeTruthy()
    // 导出/导入现在已实现，按钮必须在（P1 时期这里是「不渲染未实现按钮」的反向断言）
    expect(screen.getByText('导出')).toBeTruthy()
    expect(screen.getByText('导入')).toBeTruthy()
  })
})
