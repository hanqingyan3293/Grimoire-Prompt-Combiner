import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyHistoryResult, ComfyResultImage } from '../../shared/types'

const io = vi.hoisted(() => ({ submit: vi.fn(), history: vi.fn(), download: vi.fn(), locate: vi.fn(), client: vi.fn(), cancel: vi.fn(), tag: vi.fn(), send: vi.fn(), log: vi.fn(), derivatives: vi.fn() }))
let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: io.send } }] } }))
vi.mock('./logger.service', () => ({ logEvent: io.log }))
vi.mock('./wd14-worker', () => ({ wd14Worker: { tag: io.tag } }))
vi.mock('./comfy-client', async importOriginal => ({
  ...await importOriginal<typeof import('./comfy-client')>(),
  comfyUIClient: { baseUrl: 'http://127.0.0.1:8188', submit: io.submit, history: io.history, downloadImage: io.download, locate: io.locate },
  createComfyUIClient: io.client,
}))
vi.mock('../../integrations/cherry/comfy-source-adapter', async importOriginal => ({ ...await importOriginal<typeof import('../../integrations/cherry/comfy-source-adapter')>(), cancelComfyExecution: io.cancel }))
vi.mock('./media.service', async importOriginal => ({ ...await importOriginal<typeof import('./media.service')>(), createImageDerivatives: io.derivatives }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { taskRunner } from './task-runner'
import { cancelPersistedTask, createPersistedTask, getPersistedTask, markInterruptedTasks, prepareComfyExecution, retryPersistedTask, updateComfyExecution, updatePersistedTask } from './task-repository'
import { importComfyWorkflow } from './comfy-workflow.service'
import { transitionTask } from './task-state'
import { ComfyUIError } from './comfy-client'
import { registerManagedImage } from './image-asset.service'
import { createDiagnosticEvent, type DiagnosticEvent } from './diagnostics.core'

const done: ComfyHistoryResult = { status: 'done', images: [] }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const resultImage: ComfyResultImage = { filename: 'fixture.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=fixture.png' }
// Reuse the PNG chunk/CRC fixture shape from png-metadata.test.ts; vary actual pixels.
function pixelPng(rgb: number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8); header.writeUInt32BE(data.length, 0); header.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0)
    return Buffer.concat([header, data, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, ...rgb]))), chunk('IEND', Buffer.alloc(0))])
}

let workflowId = ''
let release: Array<() => void> = []
let serial = 0
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  release.push(() => resolve(fallback))
  return { promise, resolve, reject }
}

// The runner now consumes the original source polling wait. Build this small
// boundary fixture so the suite does not rely on stale/missing dist artifacts.
beforeAll(() => { execFileSync(process.execPath, ['scripts/build-comfy-source.mjs'], { cwd: process.cwd(), stdio: 'pipe' }) })
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-task-runner-'))
  await initDatabase()
  workflowId = importComfyWorkflow('runner fixture', { '1': { class_type: 'FixtureNode', inputs: { value: 'fixture' } } }).id
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-11-07T00:00:00.000Z'))
  vi.clearAllMocks()
  io.log.mockImplementation(() => undefined)
  io.submit.mockResolvedValue({ prompt_id: 'prompt-fixture' })
  io.history.mockResolvedValue(done)
  io.download.mockResolvedValue(png)
  io.locate.mockResolvedValue({ known: false, stage: 'none', history: null })
  io.cancel.mockResolvedValue({ outcome: 'local-only', targetedInterrupt: false, version: null, evidence: 'none', writes: [] })
  io.client.mockImplementation((baseUrl: string) => ({ baseUrl, submit: io.submit, history: io.history, downloadImage: io.download, locate: io.locate }))
  io.derivatives.mockResolvedValue(undefined)
  io.tag.mockResolvedValue({ general: [], character: [], rating: [], quality: [] })
  release = []
})
afterEach(async () => {
  taskRunner.stop()
  io.history.mockResolvedValue(done)
  io.download.mockResolvedValue(png)
  for (const settle of release) settle()
  await vi.advanceTimersByTimeAsync(10_000)
  await taskRunner.stopAndWait()
  vi.restoreAllMocks(); vi.useRealTimers(); closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})
function task(id = 'fixture_' + (++serial)) { return createPersistedTask({ id, kind: 'comfyui', input: { workflowId }, maxRetries: 2 }) }
async function status(id: string, expected: string) { await vi.waitFor(() => expect(getPersistedTask(id)?.status).toBe(expected), { timeout: 2000, interval: 10 }) }


describe('task runner repository integration (P2)', () => {
  it('persists a real imported image, task result and media relation on success', async () => {
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    const created = task()
    taskRunner.start(); await status(created.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(1)
    expect(JSON.parse(getPersistedTask(created.id)!.output_json!).promptId).toBe('prompt-fixture')
  })

  it.each([
    new ComfyUIError('COMFY_TIMEOUT', 'timeout fixture', true),
    new ComfyUIError('COMFY_TRANSPORT_ERROR', 'transport fixture', true),
    new ComfyUIError('COMFY_HTTP_503', 'HTTP fixture', true, 503),
    new Error('missing prompt identity fixture'),
  ])('does not automatically or manually replay an unconfirmed POST failure ($message)', async error => {
    io.submit.mockRejectedValueOnce(error)
    const created = task()
    taskRunner.start(); await status(created.id, 'failed')
    expect(getPersistedTask(created.id)).toMatchObject({ error_code: 'COMFY_SUBMIT_UNCERTAIN', retry_count: 0 })
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'submit-uncertain', promptId: null })
    expect(() => retryPersistedTask(created.id)).toThrow(/TASK_REPLAY_BLOCKED/)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('retains the prompt id diagnostic without replaying POST after a non-transient GET failure', async () => {
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_HTTP_400', 'query fixture', false, 400))
    const created = task()
    taskRunner.start(); await status(created.id, 'failed')
    const failed = getPersistedTask(created.id)!
    expect(failed.error_code).toBe('COMFY_POST_SUBMIT_FAILURE')
    expect(failed.error_message).toContain('prompt-fixture')
    expect(failed.error_message).toContain('COMFY_HTTP_400')
    // A known waiting identity may be retried as a read-only resume: the same
    // prompt is queried again and the actual POST count stays at one.
    const resumed = retryPersistedTask(created.id)
    expect(resumed).toMatchObject({ status: 'queued', execution: { phase: 'waiting', promptId: 'prompt-fixture' } })
    await vi.advanceTimersByTimeAsync(1250)
    await status(created.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('prioritizes cancellation when a retryable submit rejection arrives late', async () => {
    const submitted = deferred({ prompt_id: 'prompt-fixture' })
    io.submit.mockReturnValueOnce(submitted.promise)
    const created = task()
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    expect(getPersistedTask(created.id)?.status).toBe('running')
    cancelPersistedTask(created.id)
    submitted.reject(new ComfyUIError('COMFY_TIMEOUT', 'late submit failure', true))
    await status(created.id, 'cancelled')
    expect(getPersistedTask(created.id)?.retry_count).toBe(0)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('does not turn a cancellation into success when history immediately returns done', async () => {
    const query = deferred<ComfyHistoryResult>(done)
    io.history.mockReturnValueOnce(query.promise)
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(io.history).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 })
    cancelPersistedTask(created.id)
    query.resolve({ status: 'done', images: [resultImage] })
    await status(created.id, 'cancelled')
    expect(io.download).not.toHaveBeenCalled()
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
  })

  it('stops importing after cancellation occurs while an image download is pending', async () => {
    const download = deferred(png)
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    io.download.mockReturnValueOnce(download.promise)
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(io.download).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 })
    cancelPersistedTask(created.id)
    download.resolve(png)
    await status(created.id, 'cancelled')
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
  })

  it('preserves an already-cancelled terminal row when a late result arrives', async () => {
    const query = deferred<ComfyHistoryResult>(done)
    io.history.mockReturnValueOnce(query.promise)
    const created = task()
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    const cancelling = cancelPersistedTask(created.id)
    updatePersistedTask(created.id, transitionTask(cancelling, 'cancelled'))
    const before = getPersistedTask(created.id)
    query.resolve(done)
    await vi.advanceTimersByTimeAsync(10)
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'cancelled' })
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'waiting', promptId: 'prompt-fixture', cancelOutcome: 'local-only' })
    expect(before?.execution?.promptId).toBe('prompt-fixture')
    expect(io.send.mock.calls.filter(([, event]) => event.status === 'succeeded')).toHaveLength(0)
  })

  it('continues to a later due job when starting and failing the first row both hit a DB error', async () => {
    const badId = 'a_locked_' + (++serial)
    createPersistedTask({ id: badId, kind: 'wd14', input: { imageId: -1 } })
    const good = createPersistedTask({ id: 'b_later_' + serial, kind: 'wd14', input: { imageId: -1 } })
    getDatabase().exec(`CREATE TRIGGER fail_first_task BEFORE UPDATE ON task_jobs WHEN OLD.id='${badId}' BEGIN SELECT RAISE(ABORT,'locked task fixture'); END`)
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    await status(good.id, 'failed')
    expect(getPersistedTask(badId)?.status).toBe('queued')
    expect(io.send.mock.calls.filter(([, event]) => event.taskId === badId)).toHaveLength(0)
    expect(io.log.mock.calls.some(([, module, , details]) => module === 'task-runner' && details?.phase === 'scheduler')).toBe(true)
  })

  it('schedules again after a global queue read failure without making a business request', async () => {
    const created = task()
    getDatabase().exec('ALTER TABLE task_jobs RENAME TO task_jobs_offline')
    try { taskRunner.start(); await vi.advanceTimersByTimeAsync(0); expect(io.submit).not.toHaveBeenCalled() }
    finally { getDatabase().exec('ALTER TABLE task_jobs_offline RENAME TO task_jobs') }
    await vi.advanceTimersByTimeAsync(250)
    await status(created.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('does not let a malformed input job block the following due job', async () => {
    const bad = task('a_json_' + (++serial)); const good = task('b_json_' + serial)
    getDatabase().run('UPDATE task_jobs SET input_json=? WHERE id=?', ['{bad json', bad.id])
    taskRunner.start(); await status(bad.id, 'failed')
    await status(good.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('does not execute before its persisted retry deadline', async () => {
    const query = deferred<ComfyHistoryResult>(done)
    io.history.mockReturnValueOnce(query.promise)
    const created = task()
    updatePersistedTask(created.id, { ...created, next_attempt_at: '2026-11-07T00:00:01.000Z' })
    taskRunner.start(); await vi.advanceTimersByTimeAsync(999)
    expect(io.submit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(io.submit).toHaveBeenCalledTimes(1)
    query.resolve(done)
  })

  it('selects a due job behind an earlier-created future-deadline job', async () => {
    const later = task('a_future_' + (++serial)); const due = task('b_due_' + serial)
    updatePersistedTask(later.id, { ...later, next_attempt_at: '2026-11-07T00:01:00.000Z' })
    taskRunner.start(); await status(due.id, 'succeeded')
    expect(getPersistedTask(later.id)?.status).toBe('queued')
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('has one scheduler timer after stop then start during an active attempt', async () => {
    const submitted = deferred({ prompt_id: 'prompt-fixture' })
    io.submit.mockReturnValueOnce(submitted.promise)
    const created = task()
    taskRunner.start(); taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    taskRunner.stop(); taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    submitted.resolve({ prompt_id: 'prompt-fixture' })
    await status(created.id, 'succeeded')
    expect(vi.getTimerCount()).toBe(1)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('checks cancellation between WD14 models before invoking the next model', async () => {
    const source = path.join(root, 'models.png'); fs.writeFileSync(source, png)
    const image = await registerManagedImage(source)
    const tagged = deferred({ general: [], character: [], rating: [], quality: [] })
    io.tag.mockReturnValueOnce(tagged.promise)
    const created = createPersistedTask({ kind: 'wd14', input: { imageId: image.id, modelIds: ['model-a', 'model-b'] } })
    taskRunner.start()
    await vi.waitFor(() => expect(io.tag).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 })
    cancelPersistedTask(created.id)
    tagged.resolve({ general: [], character: [], rating: [], quality: [] })
    await status(created.id, 'cancelled')
    expect(io.tag).toHaveBeenCalledTimes(1)
  })

  it('executes an explicit WD14 retry only after its deadline and then persists success', async () => {
    const source = path.join(root, 'retry.png'); fs.writeFileSync(source, png)
    const image = await registerManagedImage(source)
    io.tag.mockRejectedValueOnce(new Error('temporary tag fixture'))
    const created = createPersistedTask({ kind: 'wd14', input: { imageId: image.id }, maxRetries: 1 })
    taskRunner.start(); await status(created.id, 'failed')
    const queued = retryPersistedTask(created.id)
    await vi.advanceTimersByTimeAsync(Date.parse(queued.next_attempt_at!) - Date.now() - 1)
    expect(io.tag).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(251)
    await status(created.id, 'succeeded')
    expect(io.tag).toHaveBeenCalledTimes(2)
    expect(getPersistedTask(created.id)?.retry_count).toBe(1)
  })

  it('drains an unfinished Comfy poll on stop without another GET or a new timer', async () => {
    io.history.mockResolvedValue({ status: 'running' })
    const created = task()
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    const drain = taskRunner.stopAndWait()
    // The original waitWithSignal clears the awaited poll timer synchronously.
    expect(vi.getTimerCount()).toBe(0)
    await drain
    // C1 R6 supersedes P2's post-submit failure on local stop: the admitted
    // prompt is durable and this row is queued for read-only resume.
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', error_code: null, retry_count: 0, execution: { promptId: 'prompt-fixture', phase: 'waiting' } })
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.history).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the original queue read exception in scheduler diagnostics', async () => {
    task()
    getDatabase().exec('ALTER TABLE task_jobs RENAME TO task_jobs_diag_offline')
    try { taskRunner.start(); await vi.advanceTimersByTimeAsync(0) }
    finally { getDatabase().exec('ALTER TABLE task_jobs_diag_offline RENAME TO task_jobs') }
    expect(io.log.mock.calls.some(([, , , details]) => details?.phase === 'scheduler' && details?.context?.includes('task_jobs'))).toBe(true)
  })

  it('preserves prompt identity and the business error when failure persistence also fails', async () => {
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_HTTP_400', 'business query fixture', false, 400))
    const created = task()
    getDatabase().exec("CREATE TRIGGER fail_result_write BEFORE UPDATE ON task_jobs WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'result database fixture'); END")
    try {
      taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
      expect(getPersistedTask(created.id)?.status).toBe('running')
      expect(io.log.mock.calls.some(([, , , details]) => details?.context?.includes('prompt-fixture') && details.context.includes('COMFY_HTTP_400') && details.context.includes('business query fixture'))).toBe(true)
      expect(io.log.mock.calls.some(([, , , details]) => details?.phase === 'scheduler' && details?.context?.includes('result database fixture'))).toBe(true)
    } finally {
      // Restore the fixture after assertions; the production drain must now
      // persist this owner instead of silently closing a still-faulted DB.
      getDatabase().exec('DROP TRIGGER fail_result_write')
    }
  })

  it('starts the persistence cooldown when the slow failure is observed rather than when the tick began', async () => {
    const badId = 'a_slow_' + (++serial)
    createPersistedTask({ id: badId, kind: 'wd14', input: { imageId: -1 } })
    const good = createPersistedTask({ id: 'b_after_slow_' + serial, kind: 'wd14', input: { imageId: -1 } })
    getDatabase().exec(`CREATE TRIGGER fail_slow_row BEFORE UPDATE ON task_jobs WHEN OLD.id='${badId}' BEGIN SELECT RAISE(ABORT,'slow row fixture'); END`)
    let attempts = 0
    const db = getDatabase(); const write = db.run.bind(db)
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (/UPDATE task_jobs/.test(sql) && parameters.includes(badId) && parameters[0] === 'running') { attempts++; if (attempts === 1) vi.setSystemTime(Date.now() + 6000) }
      return write(sql, parameters)
    })
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    expect(getPersistedTask(good.id)?.status).toBe('failed')
    await vi.advanceTimersByTimeAsync(4999)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(251)
    expect(attempts).toBe(2)
  })

  it('keeps a cancelled registration out of the image library even when cancellation arrives during copying', async () => {
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    const copy = deferred<void>(undefined); let copying = false
    const originalCopy = fs.promises.copyFile.bind(fs.promises)
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (source, target, mode) => { copying = true; await copy.promise; await originalCopy(source, target, mode) })
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(copying).toBe(true), { timeout: 2000, interval: 10 })
    cancelPersistedTask(created.id)
    copy.resolve(undefined)
    await status(created.id, 'cancelled')
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs')[0].values[0][0]).toBe(0)
  })

  it.each(['task-finalize', 'second-suggestion'])('rolls back WD14 history and suggestions before failure settlement (%s)', async boundary => {
    const source = path.join(root, 'atomic-wd14.png'); fs.writeFileSync(source, png)
    const image = await registerManagedImage(source)
    io.tag.mockResolvedValue({ general: [{ name: 'actor-fixture-a', confidence: 0.9 }, { name: 'actor-fixture-b', confidence: 0.8 }], character: [], rating: [], quality: [] })
    const created = createPersistedTask({ kind: 'wd14', input: { imageId: image.id }, maxRetries: 1 })
    if (boundary === 'task-finalize') getDatabase().exec("CREATE TRIGGER fail_wd14_tail BEFORE UPDATE ON task_jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'WD14 finalize fixture'); END")
    else getDatabase().exec("CREATE TRIGGER fail_wd14_tail BEFORE INSERT ON tag_suggestions WHEN NEW.raw_value='actor-fixture-b' BEGIN SELECT RAISE(ABORT,'WD14 suggestion fixture'); END")
    taskRunner.start(); await status(created.id, 'failed')
    expect(getDatabase().exec('SELECT count(*) FROM tag_suggestions')[0].values[0][0]).toBe(0)
    expect(getDatabase().exec('SELECT status FROM wd14_history WHERE task_id=?', [created.id])[0].values[0][0]).toBe('failed')
    getDatabase().exec('DROP TRIGGER fail_wd14_tail')
    retryPersistedTask(created.id)
    await vi.advanceTimersByTimeAsync(1250)
    await status(created.id, 'succeeded')
    expect(getDatabase().exec('SELECT count(*) FROM tag_suggestions')[0].values[0][0]).toBe(2)
  })

  it('settles a stranded running failure after DB recovery without repeating business work', async () => {
    const created = createPersistedTask({ kind: 'wd14', input: { imageId: -1 }, maxRetries: 2 })
    getDatabase().exec("CREATE TRIGGER fail_pending_settlement BEFORE UPDATE ON task_jobs WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'pending failure fixture'); END")
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    expect(getPersistedTask(created.id)?.status).toBe('running')
    getDatabase().exec('DROP TRIGGER fail_pending_settlement')
    await vi.advanceTimersByTimeAsync(5250)
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'failed', retry_count: 0, error_code: 'TASK_EXECUTION_ERROR' })
    expect(io.submit).not.toHaveBeenCalled()
    expect(io.tag).not.toHaveBeenCalled()
  })

  it('finishes cancelling a stranded Comfy row without replaying its accepted POST', async () => {
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_HTTP_400', 'pending query fixture', false, 400))
    const created = task()
    getDatabase().exec("CREATE TRIGGER fail_pending_cancel BEFORE UPDATE ON task_jobs WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'pending cancel fixture'); END")
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    expect(getPersistedTask(created.id)?.status).toBe('running')
    cancelPersistedTask(created.id)
    await vi.advanceTimersByTimeAsync(250)
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'cancelled', retry_count: 0, execution: { cancelOutcome: 'local-only' } })
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: 'prompt-fixture' })
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.history).toHaveBeenCalledTimes(1)
  })

  it('keeps identity, cause and persistence diagnostics through the real 2000-character logger boundary', async () => {
    const events: DiagnosticEvent[] = []
    io.log.mockImplementation((level, module, message, details) => events.push(createDiagnosticEvent(level, module, message, details)))
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_HTTP_400', 'x'.repeat(3000), false, 400))
    const created = task()
    getDatabase().exec("CREATE TRIGGER fail_long_log BEFORE UPDATE ON task_jobs WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'long persistence fixture'); END")
    try {
      taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
      const persisted = events.find(event => event.phase === 'failure-persist')
      expect(persisted?.context).toContain('prompt-fixture')
      expect(persisted?.context).toContain('COMFY_HTTP_400')
      expect(persisted?.context).toContain('long persistence fixture')
      expect(persisted!.context!.length).toBeLessThanOrEqual(2000)
      expect(events.some(event => event.phase === 'attempt-error' && event.stack?.includes('task-runner.test.ts'))).toBe(true)
      expect(getPersistedTask(created.id)?.status).toBe('running')
    } finally { getDatabase().exec('DROP TRIGGER fail_long_log') }
  })

  it('records the original post-submit diagnostic even when the catch row lookup also fails', async () => {
    const events: DiagnosticEvent[] = []; let lookupFailed = false
    io.log.mockImplementation((level, module, message, details) => events.push(createDiagnosticEvent(level, module, message, details)))
    io.history.mockImplementationOnce(async () => { lookupFailed = true; throw new ComfyUIError('COMFY_HTTP_503', 'lookup business fixture', true, 503) })
    const created = task()
    const db = getDatabase(); const execute = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => { if (lookupFailed && /SELECT .* FROM task_jobs WHERE id/.test(sql)) throw new Error('catch lookup fixture'); return execute(sql, parameters) })
    try {
      taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
      expect(events.some(event => event.context?.includes('prompt-fixture') && event.context.includes('COMFY_HTTP_503') && event.context.includes('lookup business fixture'))).toBe(true)
      expect(io.submit).toHaveBeenCalledTimes(1)
    } finally { lookupFailed = false }
    expect(getPersistedTask(created.id)?.status).toBe('running')
    await vi.advanceTimersByTimeAsync(5250)
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'failed', retry_count: 0, error_code: 'COMFY_QUERY_TRANSIENT' })
    expect(getPersistedTask(created.id)?.error_message).toContain('COMFY_HTTP_503')
    expect(getPersistedTask(created.id)?.error_message).toContain('prompt-fixture')
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.history).toHaveBeenCalledTimes(1)
  })

  it('drains a late successful ACK into a durable read without installing a new timer after stop', async () => {
    const submitted = deferred({ prompt_id: 'prompt-fixture' })
    io.submit.mockReturnValueOnce(submitted.promise)
    const created = task()
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    const drain = taskRunner.stopAndWait()
    submitted.resolve({ prompt_id: 'prompt-fixture' })
    await drain
    // A late real ACK is persisted after stop, but no stopped attempt starts
    // another GET/import/finalize; resume owns those reads with a fresh signal.
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', retry_count: 0, execution: { phase: 'waiting', promptId: 'prompt-fixture' } })
    expect(io.history).not.toHaveBeenCalled()
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('task runner C1 persisted prompt identity', () => {
  const realId = '22222222-2222-4222-8222-222222222222'

  it('freezes the executable workflow, endpoint and requested UUID before POST', async () => {
    const created = task()
    taskRunner.start(); await status(created.id, 'succeeded')
    const saved = getPersistedTask(created.id)!
    expect(saved.execution).toMatchObject({ version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'importing', promptId: 'prompt-fixture' })
    const frozen = JSON.parse(saved.input_json) as Record<string, unknown>
    expect(frozen.frozenWorkflow).toBeTruthy()
    expect(saved.execution?.requestedPromptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const [workflow, options] = io.submit.mock.calls[0] as [unknown, { requestedPromptId: string }]
    expect(workflow).toEqual(frozen.frozenWorkflow)
    expect(options.requestedPromptId).toBe(saved.execution?.requestedPromptId)
  })

  it('resumes the same GET after a transient history failure and never repeats the accepted POST', async () => {
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_HTTP_503', 'busy one', true, 503))
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_TIMEOUT', 'busy two', true))
    const created = task()
    taskRunner.start()
    await vi.advanceTimersByTimeAsync(10_000)
    await status(created.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(getPersistedTask(created.id)?.retry_count).toBe(2)
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'importing', promptId: 'prompt-fixture' })
  })

  it('verifies an ambiguous submit through queue/history and resumes without another POST', async () => {
    io.submit.mockRejectedValueOnce(new ComfyUIError('COMFY_TIMEOUT', 'ambiguous submit', true))
    io.locate.mockResolvedValueOnce({ known: true, stage: 'history', history: done })
    const created = task()
    taskRunner.start(); await status(created.id, 'succeeded')
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.locate).toHaveBeenCalledWith(getPersistedTask(created.id)?.execution?.requestedPromptId, { signal: expect.any(AbortSignal) })
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'importing', promptId: getPersistedTask(created.id)?.execution?.requestedPromptId })
  })

  it('retries the ACK/state write after a transient DB failure without repeating the POST', async () => {
    let failures = 1
    const db = getDatabase(); const write = db.run.bind(db)
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (/UPDATE task_jobs SET execution_json/.test(sql) && String(parameters[0]).includes('"phase":"waiting"') && failures > 0) {
        failures -= 1
        throw new Error('ack write fixture')
      }
      return write(sql, parameters)
    })
    const created = task()
    taskRunner.start(); await status(created.id, 'succeeded')
    expect(failures).toBe(0)
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'importing', promptId: 'prompt-fixture' })
  })

  it.each(['write', 'commit'])('retains the actual ACK owner across repeated %s failures and resumes after DB recovery', async boundary => {
    let blocked = true
    let ackCommit = false
    const db = getDatabase(); const write = db.run.bind(db); const execute = db.exec.bind(db)
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (/UPDATE task_jobs SET execution_json/.test(sql) && String(parameters[0]).includes('"phase":"waiting"')) {
        if (blocked && boundary === 'write') throw new Error('ack write fixture')
        ackCommit = true
      }
      return write(sql, parameters)
    })
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => {
      if (sql === 'COMMIT' && ackCommit) {
        ackCommit = false
        if (blocked && boundary === 'commit') throw new Error('ack commit fixture')
      }
      if (sql === 'ROLLBACK') ackCommit = false
      return execute(sql, parameters)
    })
    io.submit.mockResolvedValueOnce({ prompt_id: realId })
    const created = task()
    try {
      taskRunner.start(); await vi.advanceTimersByTimeAsync(5000)
      expect(io.submit).toHaveBeenCalledTimes(1)
      expect(getPersistedTask(created.id)?.status).toBe('running')
      expect(getPersistedTask(created.id)?.execution?.phase).toBe('submitting')
      blocked = false
      await vi.advanceTimersByTimeAsync(5250)
      await status(created.id, 'succeeded')
      expect(getPersistedTask(created.id)?.execution?.promptId).toBe(realId)
      expect(io.history).toHaveBeenCalledWith(realId, { signal: expect.any(AbortSignal) })
      expect(io.locate).not.toHaveBeenCalled()
      expect(io.submit).toHaveBeenCalledTimes(1)
    } finally { blocked = false }
  })

  it('uses the actual ACK owner to cancel while its database writes are still blocked', async () => {
    let blocked = true
    const db = getDatabase(); const write = db.run.bind(db)
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (blocked && /UPDATE task_jobs SET execution_json/.test(sql) && String(parameters[0]).includes('"phase":"waiting"')) throw new Error('ack write fixture')
      return write(sql, parameters)
    })
    io.submit.mockResolvedValueOnce({ prompt_id: realId })
    const created = task()
    try {
      taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
      cancelPersistedTask(created.id)
      await vi.advanceTimersByTimeAsync(250)
      expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: realId })
      blocked = false
      await vi.advanceTimersByTimeAsync(5250)
      await status(created.id, 'cancelled')
      expect(getPersistedTask(created.id)?.execution).toMatchObject({ promptId: realId, cancelOutcome: 'local-only' })
      expect(io.submit).toHaveBeenCalledTimes(1)
      expect(io.history).not.toHaveBeenCalled()
    } finally { blocked = false }
  })

  it('reports an undrained ACK and preserves its owner until a later successful drain', async () => {
    let blocked = true
    const db = getDatabase(); const write = db.run.bind(db)
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (blocked && /UPDATE task_jobs SET execution_json/.test(sql) && String(parameters[0]).includes('"phase":"waiting"')) throw new Error('ack drain fixture')
      return write(sql, parameters)
    })
    io.submit.mockResolvedValueOnce({ prompt_id: realId })
    const created = task()
    try {
      taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
      await expect(taskRunner.stopAndWait()).rejects.toThrow('TASK_ACK_PERSIST_PENDING')
      expect(vi.getTimerCount()).toBe(0)
      blocked = false
      await taskRunner.stopAndWait()
      expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', retry_count: 0, execution: { promptId: realId } })
      taskRunner.start(); await status(created.id, 'succeeded')
      expect(io.submit).toHaveBeenCalledTimes(1)
    } finally { blocked = false }
  })

  it('cancels a known waiting prompt through the source wrapper and records remote confirmation', async () => {
    io.cancel.mockResolvedValueOnce({ outcome: 'remote-confirmed', targetedInterrupt: true, version: '0.3.57', evidence: 'execution_interrupted', writes: [] })
    const query = deferred<ComfyHistoryResult>(done)
    io.history.mockReturnValueOnce(query.promise)
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(io.history).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 })
    cancelPersistedTask(created.id)
    query.resolve(done)
    await status(created.id, 'cancelled')
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: 'prompt-fixture' })
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ promptId: 'prompt-fixture', cancelOutcome: 'remote-confirmed' })
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued task before submit with zero business POST', async () => {
    const created = task()
    expect(cancelPersistedTask(created.id).status).toBe('cancelled')
    taskRunner.start(); await vi.advanceTimersByTimeAsync(2000)
    expect(io.submit).not.toHaveBeenCalled()
    expect(io.history).not.toHaveBeenCalled()
    expect(getPersistedTask(created.id)?.status).toBe('cancelled')
  })

  it('does not lose the remote prompt when a submitted task is cancelled during GET backoff', async () => {
    io.history.mockRejectedValueOnce(new ComfyUIError('COMFY_HTTP_503', 'backoff fixture', true, 503))
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', error_code: 'COMFY_QUERY_TRANSIENT', execution: { phase: 'waiting', promptId: 'prompt-fixture' } }), { timeout: 2000, interval: 10 })
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'waiting', promptId: 'prompt-fixture' })
    const cancelling = cancelPersistedTask(created.id)
    expect(cancelling.status).toBe('cancelling')
    await vi.advanceTimersByTimeAsync(1000)
    await status(created.id, 'cancelled')
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: 'prompt-fixture' })
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('settles a stranded cancelling identity after recovery instead of pretending it was cancelled remotely', async () => {
    const created = createPersistedTask({ id: 'stranded_cancel_' + (++serial), kind: 'comfyui', input: { prompt: 'fixture' }, maxRetries: 2 })
    const runningTask = updatePersistedTask(created.id, transitionTask(created, 'running'))
    const prepared = prepareComfyExecution(runningTask.id, 'http://127.0.0.1:8188', { prompt: 'fixture', frozenWorkflow: { '1': { class_type: 'FixtureNode', inputs: { value: 'fixture' } } } })
    const submitting = updateComfyExecution(prepared.id, getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [prepared.id])[0].values[0][0] as string, { ...prepared.execution!, phase: 'submitting' })
    updateComfyExecution(submitting.id, getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [submitting.id])[0].values[0][0] as string, { ...submitting.execution!, phase: 'waiting', promptId: 'prompt-stranded' })
    expect(cancelPersistedTask(created.id).status).toBe('cancelling')
    expect(markInterruptedTasks()).toBe(0)
    expect(getPersistedTask(created.id)?.status).toBe('cancelling')
    taskRunner.start(); await vi.advanceTimersByTimeAsync(1000)
    await status(created.id, 'cancelled')
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: 'prompt-stranded' })
    expect(getPersistedTask(created.id)?.execution?.cancelOutcome).toBe('local-only')
  })

  it('preserves cancellation intent after a transient identity snapshot read failure', async () => {
    const created = task()
    const running = updatePersistedTask(created.id, transitionTask(created, 'running'))
    const prepared = prepareComfyExecution(running.id, 'http://127.0.0.1:8188', { frozenWorkflow: { '1': { class_type: 'FixtureNode', inputs: {} } } })
    const raw = () => getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [created.id])[0].values[0][0] as string
    const submitting = updateComfyExecution(created.id, raw(), { ...prepared.execution!, phase: 'submitting' })
    updateComfyExecution(created.id, raw(), { ...submitting.execution!, phase: 'waiting', promptId: realId })
    cancelPersistedTask(created.id)
    let failRead = true
    const db = getDatabase(); const execute = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => {
      if (failRead && /SELECT .* FROM task_jobs WHERE id/.test(sql) && parameters?.includes(created.id)) { failRead = false; throw new Error('cancel identity read fixture') }
      return execute(sql, parameters)
    })
    io.cancel.mockResolvedValue({ outcome: 'remote-confirmed', targetedInterrupt: true, version: '0.3.57', evidence: 'execution_interrupted', writes: [] })
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    expect(getPersistedTask(created.id)?.status).toBe('cancelling')
    expect(io.cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5250)
    await status(created.id, 'cancelled')
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: realId })
    expect(getPersistedTask(created.id)?.execution?.cancelOutcome).toBe('remote-confirmed')
    expect(io.submit).not.toHaveBeenCalled()
  })

  it.each(['submitting', 'submit-uncertain'] as const)('persists the service-confirmed real ID when cancelling an unacknowledged %s identity', async phase => {
    const created = task()
    const running = updatePersistedTask(created.id, transitionTask(created, 'running'))
    const prepared = prepareComfyExecution(running.id, 'http://127.0.0.1:8188', { frozenWorkflow: { '1': { class_type: 'FixtureNode', inputs: {} } } })
    updateComfyExecution(created.id, getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [created.id])[0].values[0][0] as string, { ...prepared.execution!, phase })
    cancelPersistedTask(created.id)
    io.cancel.mockResolvedValue({ outcome: 'remote-confirmed', targetedInterrupt: true, version: '0.3.57', evidence: 'execution_interrupted', writes: [] })
    taskRunner.start(); await vi.advanceTimersByTimeAsync(10000)
    await status(created.id, 'cancelled')
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'waiting', promptId: prepared.execution!.requestedPromptId, cancelOutcome: 'remote-confirmed' })
    expect(io.cancel).toHaveBeenCalledTimes(1)
    expect(io.submit).not.toHaveBeenCalled()
  })

  it('persists a late response ID and cancels that exact prompt, never another', async () => {
    const submitted = deferred({ prompt_id: realId })
    io.submit.mockReturnValueOnce(submitted.promise)
    const created = task()
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    cancelPersistedTask(created.id)
    submitted.resolve({ prompt_id: realId })
    await status(created.id, 'cancelled')
    expect(io.cancel).toHaveBeenCalledTimes(1)
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: realId })
    expect(getPersistedTask(created.id)?.execution).toMatchObject({ phase: 'waiting', promptId: realId })
  })

  it('persists download backoff and imported progress across a database reopen without another POST', async () => {
    const second = { ...resultImage, filename: 'second.png' }
    io.history.mockResolvedValue({ status: 'done', images: [resultImage, second] })
    let unavailable = true
    io.download.mockImplementation(async (image: ComfyResultImage) => {
      if (image.filename === second.filename && unavailable) throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'download busy fixture', true)
      return pixelPng(image.filename === second.filename ? [0, 0, 255] : [255, 0, 0])
    })
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', retry_count: 1, error_code: 'COMFY_QUERY_TRANSIENT', execution: { phase: 'importing', promptId: 'prompt-fixture' } }), { timeout: 2000, interval: 10 })
    const queued = getPersistedTask(created.id)!
    expect(JSON.parse(queued.output_json!)).toMatchObject({ imageIds: [expect.any(Number)], imageResults: [expect.objectContaining({ status: 'imported' }), expect.objectContaining({ status: 'pending', filename: second.filename })] })
    const deadline = Date.parse(queued.next_attempt_at!)
    await taskRunner.stopAndWait()
    closeDatabase(); await initDatabase()
    expect(getPersistedTask(created.id)?.next_attempt_at).toBe(queued.next_attempt_at)
    unavailable = false
    taskRunner.start()
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1)
    expect(io.download).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(251)
    await status(created.id, 'succeeded')
    expect(io.download).toHaveBeenCalledTimes(3)
    expect(JSON.parse(getPersistedTask(created.id)!.output_json!).imageIds).toHaveLength(2)
    expect(getPersistedTask(created.id)).toMatchObject({ retry_count: 1, execution: { endpoint: 'http://127.0.0.1:8188', promptId: 'prompt-fixture' } })
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('obeys the persisted task retry cap for total transient download failure and retains per-image failures', async () => {
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    io.download.mockRejectedValue(new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'still busy fixture', true))
    const created = createPersistedTask({ kind: 'comfyui', input: { workflowId }, maxRetries: 1 })
    taskRunner.start(); await vi.advanceTimersByTimeAsync(5250)
    await status(created.id, 'failed')
    const failed = getPersistedTask(created.id)!
    expect(failed).toMatchObject({ retry_count: 1, error_code: 'COMFY_IMAGE_IMPORT_ERROR', execution: { phase: 'importing', promptId: 'prompt-fixture' } })
    expect(JSON.parse(failed.output_json!)).toMatchObject({ imageIds: [], imageResults: [expect.objectContaining({ filename: resultImage.filename, status: 'failed', errorCode: 'COMFY_IMAGE_DOWNLOAD_ERROR' })] })
    expect(io.download).toHaveBeenCalledTimes(2)
    expect(io.submit).toHaveBeenCalledTimes(1)
    expect(io.send.mock.calls.some(([, event]) => event.taskId === created.id && event.status === 'succeeded')).toBe(false)
  })

  it.each([
    [{ ...resultImage, subfolder: 'a' }, { ...resultImage, subfolder: 'b' }],
    [{ ...resultImage, type: 'output' }, { ...resultImage, type: 'temp' }],
    [{ ...resultImage, filename: 'x'.repeat(500) + 'a.png' }, { ...resultImage, filename: 'x'.repeat(500) + 'b.png' }],
  ])('keeps distinct complete source identities for two different pixels', async (first, second) => {
    io.history.mockResolvedValue({ status: 'done', images: [first, second] })
    io.download.mockResolvedValueOnce(pixelPng([255, 0, 0])).mockResolvedValueOnce(pixelPng([0, 0, 255]))
    const created = task()
    taskRunner.start(); await status(created.id, 'succeeded')
    expect(io.download).toHaveBeenCalledTimes(2)
    expect(JSON.parse(getPersistedTask(created.id)!.output_json!).imageIds).toHaveLength(2)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(2)
  })

  it('retains multiple source identities for one hash-shared image across finalize recovery', async () => {
    const second = { ...resultImage, filename: 'alias.png' }
    io.history.mockResolvedValue({ status: 'done', images: [resultImage, second] })
    getDatabase().exec("CREATE TRIGGER fail_shared_finalize BEFORE UPDATE ON task_jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'shared finalize fixture'); END")
    const created = task()
    taskRunner.start(); await status(created.id, 'failed')
    expect(io.download).toHaveBeenCalledTimes(2)
    getDatabase().exec('DROP TRIGGER fail_shared_finalize')
    retryPersistedTask(created.id)
    await vi.advanceTimersByTimeAsync(2000)
    await status(created.id, 'succeeded')
    expect(io.download).toHaveBeenCalledTimes(2)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
    expect(JSON.parse(getPersistedTask(created.id)!.output_json!).imageResults).toHaveLength(2)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('retains an unambiguous legacy filename after a same-hash alias upgrades its ledger', async () => {
    const source = path.join(root, 'legacy-image.png'); fs.writeFileSync(source, png)
    const image = await registerManagedImage(source)
    const created = task()
    getDatabase().run('INSERT INTO task_image_refs (task_id,image_id,source_filename) VALUES (?,?,?)', [created.id, image.id, resultImage.filename])
    const alias = { ...resultImage, filename: 'alias.png', url: 'http://127.0.0.1:8188/view?filename=alias.png' }
    io.history.mockResolvedValue({ status: 'done', images: [alias, resultImage] })
    io.download.mockImplementation(async (value: ComfyResultImage) => {
      if (value.filename === resultImage.filename) throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'old source is gone', false, 404)
      return png
    })
    taskRunner.start(); await status(created.id, 'succeeded')
    const output = JSON.parse(getPersistedTask(created.id)!.output_json!)
    expect(output.imageResults).toEqual([expect.objectContaining({ filename: alias.filename, status: 'imported', imageId: image.id }), expect.objectContaining({ filename: resultImage.filename, status: 'imported', imageId: image.id })])
    expect(output.importWarnings).toEqual([])
    expect(io.download).toHaveBeenCalledTimes(1)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
  })

  it('preserves current imported facts when temporary cleanup fails after a resumed download', async () => {
    const second = { ...resultImage, filename: 'cleanup-second.png' }
    io.history.mockResolvedValue({ status: 'done', images: [resultImage, second] })
    let secondAttempts = 0
    io.download.mockImplementation(async (image: ComfyResultImage) => {
      if (image.filename === second.filename && secondAttempts++ === 0) throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'temporary download fixture', true)
      return pixelPng(image.filename === second.filename ? [0, 0, 255] : [255, 0, 0])
    })
    let cleanups = 0
    const rm = fs.promises.rm.bind(fs.promises)
    vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
      if (path.basename(String(target)).startsWith('grimoire-comfy-') && ++cleanups === 2) throw new Error('cleanup EPERM fixture')
      return rm(target, options)
    })
    const created = task()
    taskRunner.start(); await vi.advanceTimersByTimeAsync(5250)
    await status(created.id, 'failed')
    const failed = getPersistedTask(created.id)!
    expect(failed.error_code).toBe('COMFY_IMAGE_IMPORT_ERROR')
    expect(failed.error_message).toContain('cleanup EPERM fixture')
    const output = JSON.parse(failed.output_json!)
    expect(output.imageIds).toHaveLength(2)
    expect(output.imageResults).toEqual([expect.objectContaining({ status: 'imported', imageId: expect.any(Number) }), expect.objectContaining({ status: 'imported', imageId: expect.any(Number) })])
    expect(output.importWarnings).toEqual([expect.stringContaining('cleanup EPERM fixture')])
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(2)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('records partial image import results as success with a visible warning', async () => {
    const second = { ...resultImage, filename: 'second.png', url: 'http://127.0.0.1:8188/view?filename=second.png' }
    io.history.mockResolvedValue({ status: 'done', images: [resultImage, second] })
    let firstAttempts = 0
    io.download.mockImplementation(async (image: ComfyResultImage) => {
      if (image.filename === second.filename) throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'broken', false)
      if (firstAttempts++ === 0) throw new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'temporary', true)
      return png
    })
    const created = task()
    taskRunner.start()
    await vi.waitFor(() => expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', retry_count: 1, error_code: 'COMFY_QUERY_TRANSIENT' }), { timeout: 2000, interval: 10 })
    const retryAt = Date.parse(getPersistedTask(created.id)!.next_attempt_at!)
    await vi.advanceTimersByTimeAsync(Math.max(0, retryAt - Date.now()) + 250)
    await status(created.id, 'succeeded')
    const output = JSON.parse(getPersistedTask(created.id)!.output_json!) as { imageIds: number[]; importWarnings: string[] }
    expect(output.imageIds).toHaveLength(1)
    expect(output.importWarnings).toEqual([expect.stringContaining('second.png')])
    expect(getPersistedTask(created.id)?.retry_count).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(1)
  })

  it('never reports success when every generated image fails to import', async () => {
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    io.download.mockRejectedValueOnce(new ComfyUIError('COMFY_IMAGE_DOWNLOAD_ERROR', 'broken', false))
    const created = task()
    taskRunner.start(); await status(created.id, 'failed')
    expect(getPersistedTask(created.id)?.error_code).toBe('COMFY_IMAGE_IMPORT_ERROR')
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs')[0].values[0][0]).toBe(0)
  })

  it.each(['abort', 'rollback', 'commit'] as const)('rolls back Comfy metadata/history/result after finalize %s and resumes only the same imported image', async boundary => {
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    const created = createPersistedTask({ kind: 'comfyui', input: { workflowId, prompt: 'atomic finalize fixture' }, maxRetries: 2 })
    const db = getDatabase(); const execute = db.exec.bind(db); let rejectCommit = boundary === 'commit'
    if (boundary !== 'commit') db.exec(`CREATE TRIGGER block_comfy_finalize BEFORE UPDATE ON task_jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(${boundary.toUpperCase()},'Comfy finalize fixture'); END`)
    else vi.spyOn(db, 'exec').mockImplementation((sql, parameters) => {
      if (sql === 'COMMIT' && rejectCommit && execute('SELECT status FROM task_jobs WHERE id=?', [created.id])[0]?.values[0]?.[0] === 'succeeded') { rejectCommit = false; throw new Error('Comfy finalize commit fixture') }
      return execute(sql, parameters)
    })
    try {
      taskRunner.start(); await status(created.id, 'failed')
      const saved = getPersistedTask(created.id)!
      expect(saved.execution).toMatchObject({ phase: 'importing', promptId: 'prompt-fixture' })
      expect(JSON.parse(saved.output_json!).imageIds).toHaveLength(1)
      expect(db.exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
      expect(db.exec('SELECT count(*) FROM image_generation_metadata')[0].values[0][0]).toBe(0)
      expect(db.exec('SELECT count(*) FROM history WHERE task_id=?', [created.id])[0].values[0][0]).toBe(0)
      expect(db.exec("SELECT count(*) FROM media_relations WHERE target_key=? AND relation_type='uses-prompt'", [created.id])[0].values[0][0]).toBe(0)
      db.exec('DROP TRIGGER IF EXISTS block_comfy_finalize')
      const retried = retryPersistedTask(created.id)
      await vi.advanceTimersByTimeAsync(Math.max(0, Date.parse(retried.next_attempt_at!) - Date.now()) + 250)
      await status(created.id, 'succeeded')
      expect(db.exec('SELECT count(*) FROM image_generation_metadata')[0].values[0][0]).toBe(1)
      expect(db.exec('SELECT count(*) FROM history WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
      expect(db.exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
      expect(io.download).toHaveBeenCalledTimes(1)
      expect(io.submit).toHaveBeenCalledTimes(1)
    } finally { rejectCommit = false; db.exec('DROP TRIGGER IF EXISTS block_comfy_finalize') }
  })

  it('recovers imported images idempotently after a finalize retry without a second download or history row', async () => {
    io.history.mockResolvedValue({ status: 'done', images: [resultImage] })
    getDatabase().exec("CREATE TRIGGER fail_finalize BEFORE UPDATE ON task_jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'finalize fixture'); END")
    const created = createPersistedTask({ id: 'history_' + (++serial), kind: 'comfyui', input: { workflowId, prompt: 'fixture prompt' }, maxRetries: 2 })
    taskRunner.start(); await status(created.id, 'failed')
    expect(io.download).toHaveBeenCalledTimes(1)
    getDatabase().exec('DROP TRIGGER fail_finalize')
    retryPersistedTask(created.id)
    await vi.advanceTimersByTimeAsync(2000)
    await status(created.id, 'succeeded')
    expect(io.download).toHaveBeenCalledTimes(1)
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs')[0].values[0][0]).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM history WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
    expect(getDatabase().exec("SELECT count(*) FROM media_relations WHERE target_type='task' AND target_key=?", [created.id])[0].values[0][0]).toBe(2)
    expect(io.submit).toHaveBeenCalledTimes(1)
  })

  it('resumes a recovered waiting identity without POSTing and without losing its IDs', async () => {
    const created = createPersistedTask({ id: 'recovered_' + (++serial), kind: 'comfyui', input: { prompt: 'fixture' }, maxRetries: 2 })
    const runningTask = updatePersistedTask(created.id, transitionTask(created, 'running'))
    const frozen = { prompt: 'fixture', frozenWorkflow: { '1': { class_type: 'FixtureNode', inputs: { value: 'fixture' } } } }
    const prepared = prepareComfyExecution(runningTask.id, 'http://127.0.0.1:8188', frozen)
    const submitting = updateComfyExecution(prepared.id, getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [prepared.id])[0].values[0][0] as string, { ...prepared.execution!, phase: 'submitting' })
    updateComfyExecution(submitting.id, getDatabase().exec('SELECT execution_json FROM task_jobs WHERE id=?', [submitting.id])[0].values[0][0] as string, { ...submitting.execution!, phase: 'waiting', promptId: 'prompt-recovered' })
    expect(markInterruptedTasks()).toBe(1)
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'queued', execution: { phase: 'waiting', promptId: 'prompt-recovered' } })
    taskRunner.start(); await status(created.id, 'succeeded')
    expect(io.submit).not.toHaveBeenCalled()
    expect(io.history).toHaveBeenCalledWith('prompt-recovered', { signal: expect.any(AbortSignal) })
  })

  it('settles a corrupt execution row and still runs the following healthy task', async () => {
    const bad = task('a_corrupt_' + (++serial))
    const good = task('b_healthy_' + serial)
    getDatabase().run('UPDATE task_jobs SET execution_json=? WHERE id=?', ['{bad json', bad.id])
    taskRunner.start()
    await vi.advanceTimersByTimeAsync(2000)
    await status(bad.id, 'failed'); await status(good.id, 'succeeded')
    expect(getPersistedTask(bad.id)).toMatchObject({ status: 'failed', error_code: 'COMFY_EXECUTION_INVALID' })
    expect(io.submit).toHaveBeenCalledTimes(1)
  })
})
