import { describe, expect, it } from 'vitest'
import { createDiagnosticEvent, redactSensitiveText } from './diagnostics.core'

describe('diagnostics core', () => {
  it('redacts common credentials from messages', () => {
    const result = redactSensitiveText('api_key=sk-test-secret Bearer abc123 password: hunter2')

    expect(result).toContain('api_key=[REDACTED]')
    expect(result).toContain('Bearer [REDACTED]')
    expect(result).toContain('password: [REDACTED]')
    expect(result).not.toContain('sk-test-secret')
    expect(result).not.toContain('abc123')
    expect(result).not.toContain('hunter2')
  })

  it('creates bounded, timestamped structured events', () => {
    const event = createDiagnosticEvent(
      'error',
      'ai',
      'request failed api_key=secret',
      { taskId: 'task-1', phase: 'request', durationMs: 42, retryable: true },
      new Date('2026-09-04T00:00:00.000Z'),
    )

    expect(event).toEqual({
      timestamp: '2026-09-04T00:00:00.000Z',
      level: 'error',
      module: 'ai',
      message: 'request failed api_key=[REDACTED]',
      taskId: 'task-1',
      phase: 'request',
      durationMs: 42,
      retryable: true,
    })
  })
})
