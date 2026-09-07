import { describe, expect, it } from 'vitest'
import { createTask, retryTask, taskEvent, transitionTask } from './task-state'

describe('task state machine', () => {
  it('allows queued to running to succeeded', () => {
    const created = createTask({ kind: 'wd14', input: { imageId: 1 } }, new Date('2026-09-04T00:00:00.000Z'))
    const running = transitionTask(created, 'running', {}, new Date('2026-09-04T00:00:01.000Z'))
    const done = transitionTask(running, 'succeeded', { output_json: '{"tags":[]}' }, new Date('2026-09-04T00:00:02.000Z'))
    expect(done.progress).toBe(1)
    expect(done.finished_at).toBe('2026-09-04T00:00:02.000Z')
    expect(taskEvent(done)).toMatchObject({ taskId: done.id, status: 'succeeded', progress: 1 })
  })

  it('rejects invalid transitions and caps retries', () => {
    const task = createTask({ kind: 'comfyui', input: {}, maxRetries: 99 })
    expect(task.max_retries).toBe(5)
    expect(() => transitionTask(task, 'succeeded')).toThrow('非法')
    const failed = transitionTask(transitionTask(task, 'running'), 'failed', { error_code: 'WORKER_ERROR' })
    expect(() => transitionTask(failed, 'running')).toThrow('终态')
  })

  it('requeues failed tasks until the retry limit is reached', () => {
    const created = createTask({ kind: 'wd14', input: {}, maxRetries: 1 })
    const failed = transitionTask(transitionTask(created, 'running'), 'failed', { error_code: 'WORKER_ERROR' })
    const queued = retryTask(failed)
    expect(queued.status).toBe('queued')
    expect(queued.retry_count).toBe(1)
    const failedAgain = transitionTask(transitionTask(queued, 'running'), 'failed')
    expect(() => retryTask(failedAgain)).toThrow('最大重试')
  })
})
