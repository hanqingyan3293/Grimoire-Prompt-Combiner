import { describe, expect, it } from 'vitest'
import {
  STORAGE_DOMAINS_ORDER,
  STORAGE_PATHS,
  STORAGE_TABLES,
  findStorageTable,
  isInternalTable,
} from './storage-registry'
import { STORAGE_DOMAIN_LABELS, formatStorageBytes, sumDomain, type StorageEntry } from './storage-types'

describe('storage registry', () => {
  it('maps every table exactly once', () => {
    const names = STORAGE_TABLES.map((spec) => spec.table)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(69)
  })

  it('gives every table a label and a known domain', () => {
    for (const spec of STORAGE_TABLES) {
      expect(spec.label.trim().length).toBeGreaterThan(0)
      expect(STORAGE_DOMAINS_ORDER).toContain(spec.domain)
    }
  })

  it('keeps path ids unique and only migrates what can actually be moved', () => {
    const ids = STORAGE_PATHS.map((spec) => spec.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const spec of STORAGE_PATHS) {
      // 包内只读资源与运行时产物都不允许迁移；迁移后会打不开或没有意义。
      if (spec.kind === 'package') expect(spec.migratable).toBe(false)
      if (spec.id.startsWith('files.agent-')) expect(spec.migratable).toBe(false)
    }
  })

  it('treats sqlite internals and dbstat rows as non-user data', () => {
    expect(isInternalTable('sqlite_sequence')).toBe(true)
    expect(isInternalTable('dbstat')).toBe(true)
    expect(isInternalTable('tags')).toBe(false)
    expect(findStorageTable('tags')?.label).toBe('标签')
    expect(findStorageTable('not_a_real_table')).toBeUndefined()
  })
})

describe('storage types helpers', () => {
  it('renders unknown as a dash instead of zero', () => {
    expect(formatStorageBytes(null)).toBe('—')
    expect(formatStorageBytes(undefined)).toBe('—')
    expect(formatStorageBytes(0)).toBe('0 B')
    expect(formatStorageBytes(1536)).toBe('1.5 KB')
    expect(formatStorageBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('sums known entries and reports incomplete groups', () => {
    const base = { kind: 'table', domain: 'tags', location: 'db:x', exportable: false, importable: false, migratable: false, cleanable: false } as const
    const known: StorageEntry[] = [{ ...base, id: 'a', label: 'A', bytes: 100 }, { ...base, id: 'b', label: 'B', bytes: 50 }]
    expect(sumDomain(known)).toEqual({ bytes: 150, complete: true })
    expect(sumDomain([...known, { ...base, id: 'c', label: 'C', bytes: null }])).toEqual({ bytes: 150, complete: false })
  })

  it('has a label for every domain', () => {
    for (const domain of STORAGE_DOMAINS_ORDER) expect(STORAGE_DOMAIN_LABELS[domain]).toBeTruthy()
  })
})
