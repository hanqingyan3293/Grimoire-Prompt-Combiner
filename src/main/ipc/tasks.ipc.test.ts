import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types'
import type { ComfyHistoryResult } from '../../shared/types'

let root = ''
const io = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn(), send: vi.fn(), submit: vi.fn(), history: vi.fn(), client: vi.fn(), cancel: vi.fn(), log: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false }, ipcMain: { handle: io.handle, on: io.on }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: io.send } }] } }))
vi.mock('../services/logger.service', () => ({ logEvent: io.log }))
vi.mock('../services/wd14-worker', () => ({ wd14Worker: {} }))
vi.mock('../services/comfy-client', async importOriginal => ({ ...await importOriginal<typeof import('../services/comfy-client')>(), comfyUIClient: { baseUrl: 'http://127.0.0.1:8188' }, createComfyUIClient: io.client }))
vi.mock('../../integrations/cherry/comfy-source-adapter', async importOriginal => ({ ...await importOriginal<typeof import('../../integrations/cherry/comfy-source-adapter')>(), cancelComfyExecution: io.cancel }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { taskRunner } from '../services/task-runner'
import { createPersistedTask, cancelPersistedTask, getPersistedTask } from '../services/task-repository'
import { importComfyWorkflow } from '../services/comfy-workflow.service'
import { registerTasksIPC } from './tasks.ipc'

const realId = '22222222-2222-4222-8222-222222222222'
let workflowId = ''; let releases: Array<() => void> = []
function task() { return createPersistedTask({ kind: 'comfyui', input: { workflowId }, maxRetries: 2 }) }
function cancel(id: unknown) {
  const handler = io.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.TASKS_CANCEL)![1] as (event: unknown, id: unknown) => Promise<unknown>
  return handler({}, id)
}
async function pendingHistory(taskId: string) {
  let enter!: (signal: AbortSignal | undefined) => void
  let intentAtAbort: string | undefined
  const entered = new Promise<AbortSignal | undefined>(resolve => { enter = resolve })
  io.history.mockImplementationOnce((_id: string, options?: { signal?: AbortSignal }) => new Promise<ComfyHistoryResult>((_resolve, reject) => {
    const abort = () => { intentAtAbort = getPersistedTask(taskId)?.status; reject(new DOMException('IPC read aborted', 'AbortError')) }
    releases.push(abort)
    options?.signal?.addEventListener('abort', abort, { once: true })
    enter(options?.signal)
  }))
  taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
  return { signal: (await entered)!, intentAtAbort: () => intentAtAbort }
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-r6-task-ipc-'))
  await initDatabase()
  workflowId = importComfyWorkflow('IPC R6 fixture', { '1': { class_type: 'FixtureNode', inputs: {} } }).id
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(new Date('2026-11-07T00:00:00.000Z'))
  vi.clearAllMocks(); releases = []
  io.submit.mockResolvedValue({ prompt_id: realId }); io.history.mockResolvedValue({ status: 'done', images: [] })
  io.cancel.mockResolvedValue({ outcome: 'remote-confirmed', targetedInterrupt: true, version: '0.3.57', evidence: 'execution_interrupted', writes: [] })
  io.client.mockImplementation((baseUrl: string) => ({ baseUrl, submit: io.submit, history: io.history }))
  registerTasksIPC()
})
afterEach(async () => {
  taskRunner.stop(); for (const release of releases) release()
  await vi.runOnlyPendingTimersAsync(); await taskRunner.stopAndWait()
  vi.restoreAllMocks(); vi.useRealTimers(); closeDatabase(); fs.rmSync(root, { recursive: true, force: true })
})

describe('production task cancellation IPC (C1 R6)', () => {
  it('persists intent first, then wakes the exact active history through production notify', async () => {
    const created = task(); const pending = await pendingHistory(created.id)
    expect(pending.signal).toBeInstanceOf(AbortSignal)
    await expect(cancel(' ' + created.id + ' ')).resolves.toMatchObject({ id: created.id, status: 'cancelling' })
    expect(pending.signal.aborted).toBe(true)
    expect(pending.intentAtAbort()).toBe('cancelling')
    await taskRunner.stopAndWait()
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'cancelled', retry_count: 0, error_code: 'TASK_CANCELLED', execution: { promptId: realId, cancelOutcome: 'remote-confirmed' } })
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: realId })
    expect(io.submit).toHaveBeenCalledTimes(1); expect(io.history).toHaveBeenCalledTimes(1)
  })

  it('does not notify or abort when cancellation persistence fails', async () => {
    const created = task(); const pending = await pendingHistory(created.id)
    const notify = vi.spyOn(taskRunner, 'notifyCancellation')
    getDatabase().exec("CREATE TRIGGER block_cancel_intent BEFORE UPDATE ON task_jobs WHEN NEW.status='cancelling' BEGIN SELECT RAISE(ABORT,'cancel intent fixture'); END")
    try {
      await expect(cancel(created.id)).rejects.toThrow('cancel intent fixture')
      expect(notify).not.toHaveBeenCalled(); expect(pending.signal.aborted).toBe(false)
      expect(getPersistedTask(created.id)?.status).toBe('running')
    } finally { getDatabase().exec('DROP TRIGGER block_cancel_intent') }
  })

  it('keeps direct repository cancel persistence-only', async () => {
    const created = task(); const pending = await pendingHistory(created.id)
    cancelPersistedTask(created.id)
    expect(pending.signal.aborted).toBe(false)
    expect(getPersistedTask(created.id)?.status).toBe('cancelling')
    // Teardown uses the normal task drain, not a manually resolved network read.
  })

  it('cancels a queued task through IPC before first POST with zero generation requests', async () => {
    const created = task()
    await expect(cancel(created.id)).resolves.toMatchObject({ status: 'cancelled' })
    taskRunner.start(); await vi.advanceTimersByTimeAsync(0)
    expect(io.submit).not.toHaveBeenCalled(); expect(io.history).not.toHaveBeenCalled(); expect(io.cancel).not.toHaveBeenCalled()
  })

  it('cancelling another task through IPC leaves the active read/remote ID untouched', async () => {
    const created = task(); const pending = await pendingHistory(created.id); const other = task()
    await expect(cancel(other.id)).resolves.toMatchObject({ id: other.id, status: 'cancelled' })
    expect(pending.signal.aborted).toBe(false); expect(io.cancel).not.toHaveBeenCalled()
    expect(io.submit).toHaveBeenCalledTimes(1)
    await cancel(created.id); await taskRunner.stopAndWait()
    expect(io.cancel).toHaveBeenCalledTimes(1)
    expect(io.cancel).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8188', promptId: realId })
  })

  it('validates the ID before persistence or notification', async () => {
    const notify = vi.spyOn(taskRunner, 'notifyCancellation')
    await expect(cancel('bad id')).rejects.toThrow('格式无效')
    expect(notify).not.toHaveBeenCalled(); expect(io.submit).not.toHaveBeenCalled()
    expect(getDatabase().exec('SELECT count(*) FROM task_jobs')[0].values[0][0]).toBe(0)
  })
})
