import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyResultImage } from '../../shared/types'

let root = ''
const effects = vi.hoisted(() => ({ derivatives: vi.fn(), log: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false } }))
vi.mock('./logger.service', () => ({ logEvent: effects.log }))
vi.mock('./media.service', async importOriginal => ({ ...await importOriginal<typeof import('./media.service')>(), createImageDerivatives: effects.derivatives }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { ComfyImageImportError, importComfyImages } from './comfy-image-import.service'
import { cancelPersistedTask, createPersistedTask, getPersistedTask, TaskRepositoryError, updatePersistedTask } from './task-repository'
import { transitionTask } from './task-state'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const images: ComfyResultImage[] = ['a.png', 'b.png', 'c.png'].map(filename => ({ filename, subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=' + filename }))
function barrier<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function fixture() {
  const task = createPersistedTask({ kind: 'comfyui', input: { fixture: 'R6 image read' }, maxRetries: 2 })
  updatePersistedTask(task.id, transitionTask(task, 'running'))
  const checkpoint = () => {
    const current = getPersistedTask(task.id)!
    if (current.status !== 'running') throw new TaskRepositoryError('TASK_STATE_CONFLICT', 'image import fixture interrupted')
    return current
  }
  return { task, checkpoint }
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-r6-import-test-'))
  await initDatabase()
  vi.clearAllMocks(); effects.derivatives.mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('Comfy image interruption retains committed facts (C1 R6)', () => {
  it.each(['cancel', 'stop'] as const)('keeps image A and marks B/C pending when %s aborts the active read', async mode => {
    const { task, checkpoint } = fixture()
    const entered = barrier<AbortSignal | undefined>()
    let cleanup!: () => void
    const client = { downloadImage: vi.fn(async (image: ComfyResultImage, options?: { signal?: AbortSignal }) => {
      if (image.filename !== 'b.png') return png
      return new Promise<Buffer>((_resolve, reject) => {
        cleanup = () => reject(new DOMException('image read interrupted', 'AbortError'))
        options?.signal?.addEventListener('abort', cleanup, { once: true })
        entered.resolve(options?.signal)
      })
    }) }
    const controller = new AbortController()
    const importing = importComfyImages(task.id, images, client, checkpoint, { signal: controller.signal }).catch(error => error)
    try {
      const supplied = await entered.promise
      expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [task.id])[0].values[0][0]).toBe(1)
      if (mode === 'cancel') cancelPersistedTask(task.id)
      controller.abort()
      expect(supplied).toBe(controller.signal)
      const error = await importing
      expect(error).toBeInstanceOf(ComfyImageImportError)
      expect(error.retryable).toBe(false)
      expect(error.result.imageIds).toHaveLength(1)
      expect(error.result.imageResults).toEqual([
        expect.objectContaining({ filename: 'a.png', status: 'imported', imageId: error.result.imageIds[0] }),
        expect.objectContaining({ filename: 'b.png', status: 'pending', imageId: null }),
        expect.objectContaining({ filename: 'c.png', status: 'pending', imageId: null }),
      ])
      expect(client.downloadImage).toHaveBeenCalledTimes(2)
      expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(1)
      expect(getDatabase().exec("SELECT count(*) FROM media_relations WHERE target_key=?", [task.id])[0].values[0][0]).toBe(1)
    } finally { cleanup(); await importing }
  })

  it('carries this attempt partial result when a persistence-only cancel is observed at the next checkpoint', async () => {
    const { task, checkpoint } = fixture()
    const entered = barrier<void>(); const lateBody = barrier<Buffer>()
    const client = { downloadImage: vi.fn(async (image: ComfyResultImage) => {
      if (image.filename !== 'b.png') return png
      entered.resolve()
      return lateBody.promise
    }) }
    const importing = importComfyImages(task.id, images, client, checkpoint).catch(error => error)
    try {
      await entered.promise
      cancelPersistedTask(task.id)
      lateBody.resolve(png)
      const error = await importing
      expect(error).toBeInstanceOf(ComfyImageImportError)
      expect(error.result.imageIds).toHaveLength(1)
      expect(error.result.imageResults).toEqual([
        expect.objectContaining({ filename: 'a.png', status: 'imported' }),
        expect.objectContaining({ filename: 'b.png', status: 'pending' }),
        expect.objectContaining({ filename: 'c.png', status: 'pending' }),
      ])
      expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [task.id])[0].values[0][0]).toBe(1)
      expect(client.downloadImage).toHaveBeenCalledTimes(2)
    } finally { lateBody.resolve(png); await importing }
  })
})
