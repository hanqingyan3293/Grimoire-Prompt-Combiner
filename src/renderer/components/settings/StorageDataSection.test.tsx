// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { StorageDataSection } from './StorageDataSection'
import type { StorageInventory } from '../../../shared/storage-types'

const inventory: StorageInventory = {
  generatedAt: '2026-11-27T00:00:00.000Z',
  totalBytes: 3 * 1024 * 1024,
  approximate: false,
  unmappedTables: [],
  groups: [
    {
      domain: 'tags',
      label: '标签',
      bytes: 1024 * 1024,
      entries: [
        {
          id: 'db.tags', kind: 'table', domain: 'tags', label: '标签', location: 'db:tags',
          bytes: 512 * 1024, rows: 4589, exportable: true, importable: true, migratable: false, cleanable: false,
        },
      ],
    },
    {
      domain: 'runtime',
      label: '运行与环境',
      bytes: 2 * 1024 * 1024,
      entries: [
        {
          id: 'files.database', kind: 'file', domain: 'runtime', label: '数据库文件',
          location: 'C:/Users/x/AppData/Roaming/Grimoire/grimoire.db',
          bytes: null, files: 1, exportable: true, importable: true, migratable: true, cleanable: false,
        },
      ],
    },
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
    value: {
      storage: {
        inventory: async () => inventory,
        scanSizes: async () => inventory,
      },
    },
  })
})

describe('storage data section', () => {
  it('renders the total, every domain and per-entry figures', async () => {
    render(<StorageDataSection />)
    expect(await screen.findByText('数据存储')).toBeTruthy()
    expect(screen.getByText('合计 3.0 MB')).toBeTruthy()
    // 「标签」既是域标题也是表名，用 getAllByText 证明两处都在
    expect(screen.getAllByText('标签').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('运行与环境')).toBeTruthy()
    expect(screen.getByText('4589 行')).toBeTruthy()
  })

  it('shows an unknown size as a dash instead of zero', async () => {
    render(<StorageDataSection />)
    await waitFor(() => expect(screen.getByText('数据库文件')).toBeTruthy())
    // 该条 bytes=null：必须显示「—」，不能显示 0 B（0 与未知是两件事）
    expect(screen.queryByText('0 B')).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('surfaces unmapped tables instead of hiding them', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        storage: {
          inventory: async () => ({ ...inventory, unmappedTables: ['mystery_table'] }),
          scanSizes: async () => inventory,
        },
      },
    })
    render(<StorageDataSection />)
    expect(await screen.findByText(/mystery_table/)).toBeTruthy()
  })

  it('explains that export and migration are not wired yet', async () => {
    render(<StorageDataSection />)
    await screen.findByText('数据存储')
    expect(screen.getByText(/后续版本逐个接入/)).toBeTruthy()
    // P1 不渲染未实现的导出/迁移按钮，避免「点了没反应」
    expect(screen.queryByText('导出')).toBeNull()
    expect(screen.queryByText('迁移')).toBeNull()
  })
})
