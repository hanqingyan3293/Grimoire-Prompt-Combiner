import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

// 不真正调用 ffmpeg / media.service：队列任务成败由本文件的可控 mock 决定。
vi.mock('./media.service', () => ({
  createImageDerivatives: vi.fn(async () => {}),
}))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createImageDerivatives } from './media.service'
import { derivativeQueueStats, drainDerivativeQueue, ensureThumbnails, pendingDerivativeCount, readThumbnails, requestDerivatives } from './thumbnail.service'

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function insertImageRef(name: string): number {
  const filePath = path.join(root, name)
  fs.writeFileSync(filePath, Buffer.from(PNG_1X1_BASE64, 'base64'))
  const info = getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?,?)', [filePath, 'managed', 'hash-' + name, 'image/png', fs.statSync(filePath).size, name, 1])
  return Number(info.lastInsertRowid)
}

function insertDerivative(imageRefId: number, kind: 'thumbnail' | 'preview', fileName: string): string {
  const filePath = path.join(root, fileName)
  fs.writeFileSync(filePath, Buffer.from(PNG_1X1_BASE64, 'base64'))
  getDatabase().run('INSERT INTO image_derivatives (id,image_ref_id,kind,file_path,asset_hash,width,height,file_size,created_at) VALUES (?,?,?,?,?,?,?,?,?)', ['derivative_' + imageRefId + '_' + kind, imageRefId, kind, filePath, 'dhash-' + fileName, 1, 1, fs.statSync(filePath).size, new Date().toISOString()])
  return filePath
}

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-thumb-'))
  await initDatabase()
  vi.mocked(createImageDerivatives).mockReset()
  vi.mocked(createImageDerivatives).mockResolvedValue(undefined)
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readThumbnails', () => {
  it('命中：返回 data URL，png/jpg 扩展名 mime 正确', async () => {
    const pngRef = insertImageRef('hit.png')
    insertDerivative(pngRef, 'thumbnail', 'hit-thumb.png')
    const jpgRef = insertImageRef('hit.jpg')
    insertDerivative(jpgRef, 'thumbnail', 'hit-thumb.jpg')

    const result = await readThumbnails([pngRef, jpgRef])
    expect(result[pngRef]).toBe('data:image/png;base64,' + PNG_1X1_BASE64)
    expect(result[jpgRef]).toBe('data:image/jpeg;base64,' + PNG_1X1_BASE64)
  })

  it('缺派生行 / 文件缺失 / kind 不匹配 → null，且每个请求 id 都有键', async () => {
    const noDerivative = insertImageRef('no-derivative.png')
    const fileGone = insertImageRef('file-gone.png')
    const gonePath = insertDerivative(fileGone, 'thumbnail', 'gone-thumb.png')
    fs.rmSync(gonePath)
    const previewOnly = insertImageRef('preview-only.png')
    insertDerivative(previewOnly, 'preview', 'preview-only-thumb.jpg')

    const ids = [noDerivative, fileGone, previewOnly]
    const result = await readThumbnails(ids)
    expect(Object.keys(result)).toHaveLength(3)
    for (const id of ids) {
      expect(Object.prototype.hasOwnProperty.call(result, id)).toBe(true)
      expect(result[id]).toBeNull()
    }
    // 同一条目的 preview 类型可以读到
    const previews = await readThumbnails([previewOnly], 'preview')
    expect(previews[previewOnly]).toBe('data:image/jpeg;base64,' + PNG_1X1_BASE64)
  })

  it('多 id 混合：命中与缺失并存、重复 id 去重', async () => {
    const hit = insertImageRef('mix-hit.png')
    insertDerivative(hit, 'thumbnail', 'mix-hit-thumb.png')
    const miss = insertImageRef('mix-miss.png')

    const result = await readThumbnails([hit, miss, hit])
    expect(Object.keys(result)).toHaveLength(2)
    expect(result[hit]).toBe('data:image/png;base64,' + PNG_1X1_BASE64)
    expect(result[miss]).toBeNull()
  })

  it('空数组 → 空对象', async () => {
    expect(await readThumbnails([])).toEqual({})
  })

  it('分块边界：401 个 id（命中跨越 400 分块）', async () => {
    const hitFirst = insertImageRef('chunk-first.png')
    insertDerivative(hitFirst, 'thumbnail', 'chunk-first-thumb.png')
    const hitLast = insertImageRef('chunk-last.png')
    insertDerivative(hitLast, 'thumbnail', 'chunk-last-thumb.png')

    const filler = Array.from({ length: 399 }, (_, index) => 900000 + index)
    const ids = [hitFirst, ...filler, hitLast] // 401 个：第一块 400 个，第二块 1 个
    const result = await readThumbnails(ids)
    expect(Object.keys(result)).toHaveLength(401)
    expect(result[hitFirst]).toBe('data:image/png;base64,' + PNG_1X1_BASE64)
    expect(result[hitLast]).toBe('data:image/png;base64,' + PNG_1X1_BASE64)
    expect(result[900000]).toBeNull()
    expect(result[900398]).toBeNull()
  })

  it('大小上限：恰好 8MB 可读，超过 8MB → null', async () => {
    const atLimit = insertImageRef('at-limit.png')
    fs.truncateSync(insertDerivative(atLimit, 'thumbnail', 'at-limit-thumb.png'), 8 * 1024 * 1024)
    const overLimit = insertImageRef('over-limit.png')
    fs.truncateSync(insertDerivative(overLimit, 'thumbnail', 'over-limit-thumb.png'), 8 * 1024 * 1024 + 1)

    const result = await readThumbnails([atLimit, overLimit])
    expect(result[atLimit]).toMatch(/^data:image\/png;base64,/)
    expect(result[overLimit]).toBeNull()
  })
})

describe('requestDerivatives 队列', () => {
  it('同一 imageRefId 去重：运行中重复请求只执行一次', async () => {
    let release: () => void = () => {}
    vi.mocked(createImageDerivatives).mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))

    requestDerivatives(101)
    await flushTasks()
    requestDerivatives(101)
    requestDerivatives(101)
    expect(createImageDerivatives).toHaveBeenCalledTimes(1)
    expect(pendingDerivativeCount()).toBe(1)
    expect(derivativeQueueStats()).toMatchObject({ queued: 0, running: 1 })

    release()
    await drainDerivativeQueue()
    expect(createImageDerivatives).toHaveBeenCalledTimes(1)
    expect(pendingDerivativeCount()).toBe(0)
    expect(derivativeQueueStats()).toMatchObject({ queued: 0, running: 0 })
  })

  it('两个不同 id 串行执行（前一个 settle 后才执行下一个，而非并发）', async () => {
    const started: number[] = []
    let active = 0
    let maxActive = 0
    let releaseFirst: () => void = () => {}
    const firstBlocker = new Promise<void>((resolve) => { releaseFirst = resolve })
    vi.mocked(createImageDerivatives).mockImplementation(async (id: number) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(id)
      if (id === 201) await firstBlocker
      active -= 1
    })

    requestDerivatives(201)
    requestDerivatives(202)
    await flushTasks()
    expect(started).toEqual([201]) // 201 未完成前 202 不得开始
    expect(derivativeQueueStats()).toMatchObject({ queued: 1, running: 1 })

    releaseFirst()
    await drainDerivativeQueue()
    expect(started).toEqual([201, 202])
    expect(maxActive).toBe(1)
    expect(createImageDerivatives).toHaveBeenCalledTimes(2)
  })

  it('失败不抛出：队列继续、stats.failed 增加，下一次请求可重试', async () => {
    const failedBefore = derivativeQueueStats().failed
    vi.mocked(createImageDerivatives)
      .mockRejectedValueOnce(new Error('生成失败'))
      .mockResolvedValue(undefined)

    requestDerivatives(301)
    requestDerivatives(302)
    await drainDerivativeQueue()
    expect(createImageDerivatives).toHaveBeenCalledTimes(2) // 301 失败后 302 仍执行
    expect(derivativeQueueStats().failed).toBe(failedBefore + 1)
    expect(pendingDerivativeCount()).toBe(0)

    requestDerivatives(301) // 上次失败 → 允许重试
    await drainDerivativeQueue()
    expect(createImageDerivatives).toHaveBeenCalledTimes(3)
    expect(derivativeQueueStats().failed).toBe(failedBefore + 1)
  })

  it('已有 thumbnail 派生行时跳过入队', async () => {
    const ref = insertImageRef('already.png')
    insertDerivative(ref, 'thumbnail', 'already-thumb.png')

    requestDerivatives(ref)
    await drainDerivativeQueue()
    expect(createImageDerivatives).not.toHaveBeenCalled()
    expect(pendingDerivativeCount()).toBe(0)
    expect(derivativeQueueStats()).toMatchObject({ queued: 0, running: 0 })
  })

  it('ensureThumbnails 等待任务完成（而非立即返回）', async () => {
    let release: () => void = () => {}
    vi.mocked(createImageDerivatives).mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))

    let settled = false
    const task = ensureThumbnails(401).then(() => { settled = true })
    await flushTasks()
    expect(createImageDerivatives).toHaveBeenCalledTimes(1)
    expect(createImageDerivatives).toHaveBeenCalledWith(401)
    expect(settled).toBe(false)

    release()
    await task
    expect(settled).toBe(true)
    expect(pendingDerivativeCount()).toBe(0)
  })

  it('ensureThumbnails 无任务（已有派生行）时立即返回', async () => {
    const ref = insertImageRef('ensure-skip.png')
    insertDerivative(ref, 'thumbnail', 'ensure-skip-thumb.png')

    await ensureThumbnails(ref)
    expect(createImageDerivatives).not.toHaveBeenCalled()
    expect(pendingDerivativeCount()).toBe(0)
  })
})