// @vitest-environment node
// 只测「读包」这一侧：inspectImport 决定用户会不会看到「不兼容」的拦截，
// 而写包那一侧依赖 electron app 的路径，放在运行时验收（verify-transfer.mjs）里覆盖。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { inspectImport } from './storage-transfer.service'
import { BACKUP_FORMAT } from '../../shared/storage-transfer-types'

let dir = ''

async function makeZip(name: string, entries: { name: string; data: string }[]): Promise<string> {
  const target = path.join(dir, name)
  const zip = new ZipFile()
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.data, 'utf8'), entry.name)
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(target)
    out.on('error', reject)
    out.on('close', () => resolve())
    zip.outputStream.on('error', reject)
    zip.outputStream.pipe(out)
    zip.end()
  })
  return target
}

const manifest = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  format: BACKUP_FORMAT,
  kind: 'full',
  appVersion: '0.7.3-alpha',
  schemaVersion: 42,
  createdAt: '2026-11-27T00:00:00.000Z',
  platform: 'win32',
  items: [{ id: 'db.tags', label: '标签', domain: 'tags', rows: 4589 }],
  files: [{ path: 'db/grimoire.db', bytes: 1234, sha256: 'a'.repeat(64) }],
  totals: { bytes: 1234, entries: 1 },
  ...overrides,
})

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-transfer-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('inspectImport', () => {
  it('recognizes a full backup and its items', async () => {
    const file = await makeZip('backup.zip', [{ name: 'manifest.json', data: manifest() }])
    const inspection = await inspectImport(file)
    expect(inspection.kind).toBe('full')
    expect(inspection.compatible).toBe(true)
    expect(inspection.schemaVersion).toBe(42)
    expect(inspection.items).toHaveLength(1)
    expect(inspection.files[0].path).toBe('db/grimoire.db')
  })

  it('blocks a backup from a newer schema instead of half-importing it', async () => {
    const file = await makeZip('future.zip', [{ name: 'manifest.json', data: manifest({ schemaVersion: 999 }) }])
    const inspection = await inspectImport(file)
    expect(inspection.compatible).toBe(false)
    expect(inspection.reason).toContain('999')
  })

  it('rejects a zip that is not a Grimoire backup', async () => {
    const file = await makeZip('random.zip', [{ name: 'readme.txt', data: 'hello' }])
    await expect(inspectImport(file)).rejects.toThrow(/manifest\.json/)
  })

  it('rejects an unknown format marker', async () => {
    const file = await makeZip('alien.zip', [{ name: 'manifest.json', data: manifest({ format: 'someone-else/1' }) }])
    await expect(inspectImport(file)).rejects.toThrow(/不支持的备份格式/)
  })

  it('rejects a missing file', async () => {
    await expect(inspectImport(path.join(dir, 'nope.zip'))).rejects.toThrow(/文件不存在/)
  })
})
