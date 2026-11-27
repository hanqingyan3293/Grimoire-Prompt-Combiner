// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clearSizeCache, sizeOfMatchingFiles, sizeOfPath, sizeOfPaths } from './storage-size.service'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-size-'))
  clearSizeCache()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('storage size service', () => {
  it('sums a directory tree', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), Buffer.alloc(100))
    fs.mkdirSync(path.join(root, 'nested'))
    fs.writeFileSync(path.join(root, 'nested', 'b.txt'), Buffer.alloc(250))
    const sized = await sizeOfPath(root)
    expect(sized.bytes).toBe(350)
    expect(sized.files).toBe(2)
    expect(sized.truncated).toBe(false)
  })

  it('treats a single file as one entry', async () => {
    const file = path.join(root, 'single.bin')
    fs.writeFileSync(file, Buffer.alloc(42))
    expect(await sizeOfPath(file)).toMatchObject({ bytes: 42, files: 1 })
  })

  it('returns zeros for a missing path instead of throwing', async () => {
    expect(await sizeOfPath(path.join(root, 'nope'))).toMatchObject({ bytes: 0, files: 0, skipped: 1 })
  })

  it('reports truncation when the file cap is hit', async () => {
    for (let index = 0; index < 5; index += 1) fs.writeFileSync(path.join(root, `f${index}.txt`), Buffer.alloc(10))
    const sized = await sizeOfPath(root, { fileCap: 2, force: true })
    expect(sized.truncated).toBe(true)
  })

  it('merges several paths into one figure', async () => {
    const first = path.join(root, 'one')
    const second = path.join(root, 'two')
    fs.mkdirSync(first)
    fs.mkdirSync(second)
    fs.writeFileSync(path.join(first, 'a'), Buffer.alloc(10))
    fs.writeFileSync(path.join(second, 'b'), Buffer.alloc(20))
    expect(await sizeOfPaths([first, second])).toMatchObject({ bytes: 30, files: 2 })
  })

  it('matches migration backups by filename pattern', async () => {
    fs.writeFileSync(path.join(root, 'grimoire.db.pre-migration-2026-11-26T16-34-28-203Z.bak'), Buffer.alloc(64))
    fs.writeFileSync(path.join(root, 'grimoire.db'), Buffer.alloc(128))
    const sized = await sizeOfMatchingFiles(root, (name) => name.startsWith('grimoire.db.pre-migration-') && name.endsWith('.bak'))
    expect(sized).toMatchObject({ bytes: 64, files: 1 })
  })

  it('serves repeat reads from cache until forced', async () => {
    fs.writeFileSync(path.join(root, 'a'), Buffer.alloc(10))
    expect((await sizeOfPath(root)).bytes).toBe(10)
    fs.writeFileSync(path.join(root, 'b'), Buffer.alloc(10))
    expect((await sizeOfPath(root)).bytes).toBe(10) // 命中缓存
    expect((await sizeOfPath(root, { force: true })).bytes).toBe(20)
  })
})
