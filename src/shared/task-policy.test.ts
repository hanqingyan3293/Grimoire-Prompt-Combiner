import { describe, expect, it } from 'vitest'
import { getTaskRetryMode } from './task-policy'
import type { TaskRecord, TaskStatus } from './task-types'

const execution: NonNullable<TaskRecord['execution']> = { version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'waiting', requestedPromptId: '11111111-1111-4111-8111-111111111111', promptId: '22222222-2222-4222-8222-222222222222', cancelOutcome: 'none' }
function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return { id: 'policy-fixture', kind: 'comfyui', status: 'failed', input_json: '{}', output_json: null, error_code: 'COMFY_QUERY_TRANSIENT', error_message: 'fixture', progress: 0, retry_count: 0, max_retries: 2, created_at: '2026-11-07T00:00:00.000Z', started_at: null, finished_at: null, updated_at: '2026-11-07T00:00:00.000Z', execution, ...patch }
}
describe('shared task retry admission (C1 R10)', () => {
  it.each(['queued', 'running', 'paused', 'cancelling', 'succeeded', 'cancelled'] as TaskStatus[])('does not offer retry for %s', status => {
    expect(getTaskRetryMode(task({ status }))).toBe('none')
  })
  it.each(['waiting', 'importing'] as const)('offers only a same-ID read for %s', phase => {
    expect(getTaskRetryMode(task({ execution: { ...execution, phase } }))).toBe('read')
  })
  it.each(['submitting', 'submit-uncertain'] as const)('blocks unconfirmed %s instead of replaying POST', phase => {
    expect(getTaskRetryMode(task({ execution: { ...execution, phase, promptId: null } }))).toBe('none')
  })
  it('admits an explicit proven preparation retry for NULL or prepared identity', () => {
    expect(getTaskRetryMode(task({ error_code: 'COMFY_PREPARE_FAILED', execution: null }))).toBe('retry')
    expect(getTaskRetryMode(task({ error_code: 'COMFY_PREPARE_FAILED', execution: { ...execution, phase: 'prepared', promptId: null } }))).toBe('retry')
    expect(getTaskRetryMode(task({ error_code: 'COMFY_PREPARE_FAILED' }))).toBe('none')
  })
  it('keeps corrupt identities, legacy unknown submissions and exhausted budgets blocked', () => {
    expect(getTaskRetryMode(task({ execution_error: 'invalid identity' }))).toBe('none')
    expect(getTaskRetryMode(task({ execution: null, error_code: 'APP_RESTARTED' }))).toBe('none')
    expect(getTaskRetryMode(task({ retry_count: 2 }))).toBe('none')
  })
  it('preserves ordinary WD14 retry admission without a Comfy identity requirement', () => {
    expect(getTaskRetryMode(task({ kind: 'wd14', execution: null }))).toBe('retry')
    expect(getTaskRetryMode(task({ kind: 'wd14', execution: null, retry_count: 2 }))).toBe('none')
  })
})
