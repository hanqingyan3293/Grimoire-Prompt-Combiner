// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCancelOutcome, formatTaskError, TasksPanel } from './TasksPanel'
import type { TaskRecord } from '../../../shared/task-types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('task error presentation', () => {
  it('renders typed Comfy errors with code and retry guidance', () => {
    expect(formatTaskError({ kind: 'comfyui', errorCode: 'COMFY_HTTP_503', errorMessage: 'ComfyUI is busy', retryable: true }))
      .toBe('COMFY_HTTP_503：ComfyUI is busy（将自动重试）')
  })

  it('shows the persisted retry deadline for queued tasks', () => {
    expect(formatTaskError({ kind: 'comfyui', errorCode: null, errorMessage: '', nextAttemptAt: '2026-11-05T22:00:00.000Z' }))
      .toBe('下次重试：2026-11-05T22:00:00.000Z')
  })

  it('describes a transient same-prompt resume as an automatic retry', () => {
    expect(formatTaskError({ kind: 'comfyui', errorCode: 'COMFY_QUERY_TRANSIENT', errorMessage: 'ComfyUI is busy', retryable: true }))
      .toBe('COMFY_QUERY_TRANSIENT：ComfyUI is busy（将自动重试）')
  })
})

describe('task cancellation presentation', () => {
  it.each([
    ['remote-confirmed', '远端已确认取消'],
    ['local-only', '仅本地停止，远端未确认'],
    ['failed', '远端取消请求失败'],
    ['none', null],
  ] as const)('maps %s to its honest label', (outcome, label) => {
    expect(formatCancelOutcome({ version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'waiting', requestedPromptId: '11111111-1111-4111-8111-111111111111', promptId: '22222222-2222-4222-8222-222222222222', cancelOutcome: outcome })).toBe(label)
  })

  it('renders remote confirmation and local-only cancellation separately', async () => {
    const base = {
      kind: 'comfyui' as const, output_json: null, error_code: null, error_message: null, progress: 0, retry_count: 0, max_retries: 2,
      created_at: '2026-11-07T00:00:00.000Z', started_at: '2026-11-07T00:00:01.000Z', finished_at: '2026-11-07T00:00:02.000Z', updated_at: '2026-11-07T00:00:02.000Z',
      execution: { version: 1 as const, endpoint: 'http://127.0.0.1:8188', phase: 'waiting' as const, requestedPromptId: '11111111-1111-4111-8111-111111111111', promptId: '22222222-2222-4222-8222-222222222222', cancelOutcome: 'remote-confirmed' as const },
    }
    const tasks: TaskRecord[] = [
      { ...base, id: 'remote', status: 'cancelled', input_json: '{}' },
      { ...base, id: 'local', status: 'cancelled', input_json: '{}', execution: { ...base.execution, cancelOutcome: 'local-only' } },
    ]
    ;(window as unknown as { api: unknown }).api = { tasks: { list: async () => tasks, onUpdated: () => () => undefined } }
    render(<TasksPanel />)
    expect(await screen.findByText('远端已确认取消')).toBeTruthy()
    expect(await screen.findByText('仅本地停止，远端未确认')).toBeTruthy()
  })
})

const waiting: NonNullable<TaskRecord['execution']> = { version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'waiting', requestedPromptId: '11111111-1111-4111-8111-111111111111', promptId: '22222222-2222-4222-8222-222222222222', cancelOutcome: 'none' }
function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return { id: 'ui-task', kind: 'comfyui', status: 'succeeded', input_json: '{}', output_json: null, error_code: null, error_message: null, progress: 1, retry_count: 0, max_retries: 2, next_attempt_at: null, execution: waiting, created_at: '2026-11-07T00:00:00.000Z', started_at: null, finished_at: null, updated_at: '2026-11-07T00:00:00.000Z', ...patch }
}
function output(images: Array<{ filename: string; status: 'imported' | 'pending' | 'failed'; imageId: number | null }>, warnings: string[] = []) {
  return JSON.stringify({ version: 1, imageIds: [...new Set(images.filter(item => item.status === 'imported').map(item => item.imageId))], imageResults: images.map(item => ({ subfolder: '', type: 'output', errorCode: item.status === 'failed' ? 'COMFY_IMAGE_IMPORT_ERROR' : null, errorMessage: item.status === 'failed' ? 'invalid image fixture' : null, ...item })), importWarnings: warnings })
}
function install(values: TaskRecord[]) {
  let updated: () => void = () => undefined
  const unsubscribe = vi.fn()
  const api = { list: vi.fn().mockResolvedValue(values), cancel: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined), onUpdated: vi.fn((callback: () => void) => { updated = callback; return unsubscribe }) }
  ;(window as unknown as { api: unknown }).api = { tasks: api }
  return { api, updated: () => updated(), unsubscribe }
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('Comfy task result presentation (C1 R10)', () => {
  it('renders each imported, unfinished and failed source with actual reference and warning', async () => {
    install([task({ output_json: output([{ filename: 'a.png', status: 'imported', imageId: 7 }, { filename: 'b.png', status: 'pending', imageId: null }, { filename: 'c.png', status: 'failed', imageId: null }], ['c.png: invalid image fixture']) })])
    render(<TasksPanel />)
    const region = await screen.findByRole('region', { name: 'ComfyUI 图片导入结果' })
    for (const value of ['a.png', 'b.png', 'c.png', '图库 #7', '已导入', '未完成', '导入失败', 'c.png: invalid image fixture']) expect(within(region).getByText(value)).toBeTruthy()
  })

  it('keeps two source identities that share the same imported image reference', async () => {
    install([task({ output_json: output([{ filename: 'original.png', status: 'imported', imageId: 7 }, { filename: 'alias.png', status: 'imported', imageId: 7 }]) })])
    render(<TasksPanel />)
    const region = await screen.findByRole('region', { name: 'ComfyUI 图片导入结果' })
    expect(within(region).getByText('original.png')).toBeTruthy(); expect(within(region).getByText('alias.png')).toBeTruthy()
    expect(within(region).getAllByText('图库 #7')).toHaveLength(2)
  })

  it('shows committed images beside a failed cleanup instead of hiding their imported facts', async () => {
    install([task({ status: 'failed', error_code: 'COMFY_IMAGE_IMPORT_ERROR', error_message: 'cleanup failed', output_json: output([{ filename: 'a.png', status: 'imported', imageId: 7 }, { filename: 'b.png', status: 'imported', imageId: 8 }], ['cleanup failed']) })])
    render(<TasksPanel />)
    const region = await screen.findByRole('region', { name: 'ComfyUI 图片导入结果' })
    expect(within(region).getAllByText('已导入')).toHaveLength(2)
    expect(within(region).getByText('cleanup failed')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
  })

  it('shows legacy recorded IDs without inventing per-image attribution', async () => {
    install([task({ output_json: JSON.stringify({ imageIds: [7, 9] }) })])
    render(<TasksPanel />)
    expect(await screen.findByText('图库引用 #7')).toBeTruthy()
    expect(screen.getByText('图库引用 #9')).toBeTruthy()
    expect(screen.getByText('旧结果未记录逐图导入状态')).toBeTruthy()
  })

  it('reports malformed Comfy result data on that task instead of dropping it silently', async () => {
    install([task({ output_json: '{broken' })])
    render(<TasksPanel />)
    expect(await screen.findByText('图片结果记录格式异常')).toBeTruthy()
  })

  it.each(['imported', 'pending', 'failed'])('rejects an array status coerced to %s instead of showing a fabricated result label', async status => {
    install([task({ output_json: JSON.stringify({ version: 1, imageIds: [], imageResults: [{ filename: 'bad.png', subfolder: '', type: 'output', status: [status], imageId: null, errorCode: null, errorMessage: null }], importWarnings: [] }) })])
    render(<TasksPanel />)
    expect(await screen.findByText('图片结果记录格式异常')).toBeTruthy()
    expect(screen.queryByText('bad.png')).toBeNull()
  })

  it('shows a scheduled deadline even when the queued task has a transient message', async () => {
    install([task({ status: 'queued', error_code: 'COMFY_QUERY_TRANSIENT', error_message: 'temporary read', next_attempt_at: '2026-11-07T00:00:05.000Z' })])
    render(<TasksPanel />)
    expect(await screen.findByText(/2026-11-07T00:00:05.000Z/)).toBeTruthy()
    expect(screen.getByText(/将自动重试/)).toBeTruthy()
  })

  it('does not infer an automatic retry solely from an error code', () => {
    expect(formatTaskError({ kind: 'comfyui', errorCode: 'COMFY_QUERY_TRANSIENT', errorMessage: 'no scheduled retry' })).not.toContain('将自动重试')
  })

  it.each([
    { name: 'unknown ACK', execution: { ...waiting, phase: 'submit-uncertain' as const, promptId: null }, error_code: 'COMFY_SUBMIT_UNCERTAIN' },
    { name: 'legacy identity', execution: null, error_code: 'APP_RESTARTED' },
    { name: 'corrupt identity', execution: null, execution_error: 'invalid identity fixture', error_code: 'COMFY_EXECUTION_INVALID' },
    { name: 'retry cap', execution: waiting, retry_count: 2, error_code: 'COMFY_QUERY_TRANSIENT' },
  ])('keeps unsupported retry disabled for $name without a false automatic retry promise', async ({ name: _name, ...patch }) => {
    install([task({ status: 'failed', error_message: 'task stopped', ...patch })])
    render(<TasksPanel />)
    const retry = await screen.findByRole('button', { name: '重试' })
    expect((retry as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/将自动重试/)).toBeNull()
  })

  it('names a permitted known-ID read retry distinctly from another generation', async () => {
    const fixture = install([task({ status: 'failed', error_code: 'COMFY_QUERY_TRANSIENT', error_message: 'read stopped', retry_count: 1 })])
    render(<TasksPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '续读原任务' }))
    await waitFor(() => expect(fixture.api.retry).toHaveBeenCalledWith('ui-task'))
    expect(screen.queryByText(/将自动重试/)).toBeNull()
  })
})

describe('task UI asynchronous truth (C1 R10)', () => {
  it('keeps the newer task snapshot when an earlier list response arrives last', async () => {
    const older = deferred<TaskRecord[]>(); const fixture = install([])
    fixture.api.list.mockImplementationOnce(() => older.promise).mockResolvedValue([task({ status: 'succeeded' })])
    render(<TasksPanel />); await waitFor(() => expect(fixture.api.list).toHaveBeenCalledTimes(1))
    act(() => fixture.updated())
    expect(await screen.findByText('已完成')).toBeTruthy()
    await act(async () => older.resolve([task({ status: 'queued' })]))
    expect(screen.getByText('已完成')).toBeTruthy(); expect(screen.queryByText('排队中')).toBeNull()
  })

  it('does not let an older list failure replace a newer successful snapshot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const older = deferred<TaskRecord[]>(); const fixture = install([])
    fixture.api.list.mockImplementationOnce(() => older.promise).mockResolvedValue([task()])
    render(<TasksPanel />); await waitFor(() => expect(fixture.api.list).toHaveBeenCalledTimes(1))
    act(() => fixture.updated()); expect(await screen.findByText('已完成')).toBeTruthy()
    await act(async () => older.reject(new Error('old list fixture')))
    expect(screen.queryByText('任务队列加载失败，请重试')).toBeNull()
  })

  it('keeps independent pending actions disabled until each corresponding RPC ends', async () => {
    const a = deferred<void>(); const b = deferred<void>()
    const fixture = install([task({ id: 'a', status: 'running' }), task({ id: 'b', status: 'running' })])
    fixture.api.cancel.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)
    render(<TasksPanel />)
    const buttons = await screen.findAllByRole('button', { name: '取消' })
    try {
      fireEvent.click(buttons[0]); fireEvent.click(buttons[1])
      expect((buttons[0] as HTMLButtonElement).disabled).toBe(true)
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
      await act(async () => a.resolve())
      expect((screen.getAllByRole('button', { name: '取消' })[1] as HTMLButtonElement).disabled).toBe(true)
      await act(async () => b.resolve())
      expect(fixture.api.cancel).toHaveBeenCalledTimes(2)
    } finally { a.resolve(); b.resolve() }
  })

  it('reports the coded main-process action error beside the relevant task', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fixture = install([task({ status: 'running' })])
    fixture.api.cancel.mockRejectedValue(new Error('TASK_STATE_CONFLICT: changed task fixture'))
    render(<TasksPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(await screen.findByText(/TASK_STATE_CONFLICT: changed task fixture/)).toBeTruthy()
  })

  it('releases the task RPC fence even when its obsolete post-action reload remains pending', async () => {
    const obsolete = deferred<TaskRecord[]>()
    const failed = task({ status: 'failed', error_code: 'COMFY_QUERY_TRANSIENT', error_message: 'read stopped' })
    const queued = task({ status: 'queued' })
    const fixture = install([failed])
    fixture.api.list.mockResolvedValueOnce([failed]).mockImplementationOnce(() => obsolete.promise).mockResolvedValue([queued])
    render(<TasksPanel />)
    try {
      fireEvent.click(await screen.findByRole('button', { name: '续读原任务' }))
      await waitFor(() => expect(fixture.api.list).toHaveBeenCalledTimes(2))
      act(() => fixture.updated())
      expect(await screen.findByText('排队中')).toBeTruthy()
      const cancel = screen.getByRole('button', { name: '取消' })
      expect((cancel as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(cancel)
      await waitFor(() => expect(fixture.api.cancel).toHaveBeenCalledWith('ui-task'))
    } finally { await act(async () => obsolete.resolve([queued])) }
  })

  it('unsubscribes and does not reload a task list after an action completes on an unmounted panel', async () => {
    const pending = deferred<void>(); const fixture = install([task({ status: 'running' })])
    fixture.api.cancel.mockImplementation(() => pending.promise)
    const panel = render(<TasksPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    panel.unmount(); await act(async () => pending.resolve())
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1)
    expect(fixture.api.list).toHaveBeenCalledTimes(1)
  })
})
