import { describe, expect, it } from 'vitest'
import type { AiEventRecord } from './ai-types'
import { initialAiMessagePartState, reduceAiMessageParts, replayAiEvents } from './ai-message-reducer'

function event(sequence: number, event_type: string, payload: Record<string, unknown>): AiEventRecord {
  return { id: 'event-' + sequence, session_id: 'session-1', sequence, event_type, payload, created_at: new Date(0).toISOString() }
}

describe('AI message part reducer', () => {
  it('merges streaming text and reasoning deltas in order', () => {
    const state = replayAiEvents([
      event(0, 'text-delta', { text: '你' }),
      event(1, 'text-delta', { text: '好' }),
      event(2, 'reasoning-delta', { text: '思考' }),
      event(3, 'reasoning-delta', { text: '中' }),
    ])
    expect(state.parts).toMatchObject([
      { type: 'text', text: '你好' },
      { type: 'reasoning', text: '思考中' },
    ])
    expect(state.status).toBe('streaming')
  })

  it('keeps tool lifecycle and permission lifecycle deterministic', () => {
    const state = replayAiEvents([
      event(0, 'tool-started', { callId: 'call-1', name: 'read_file', input: { path: 'a.txt' } }),
      event(1, 'tool-progress', { callId: 'call-1', status: 'running' }),
      event(2, 'tool-finished', { callId: 'call-1', output: 'ok' }),
      event(3, 'permission-requested', { requestId: 'permission-1', permission: 'write', detail: { path: 'a.txt' } }),
      event(4, 'permission-resolved', { requestId: 'permission-1', permission: 'write', decision: 'allowOnce' }),
    ])
    expect(state.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-call', callId: 'call-1', status: 'completed' }),
      expect.objectContaining({ type: 'tool-result', callId: 'call-1', status: 'completed', output: 'ok' }),
      expect.objectContaining({ type: 'permission', requestId: 'permission-1', status: 'allowOnce' }),
    ]))
  })

  it('ignores replayed events and records terminal failures', () => {
    const failed = event(2, 'failed', { message: '连接失败' })
    const state = reduceAiMessageParts(initialAiMessagePartState, { type: 'events', events: [event(0, 'text-delta', { text: 'a' }), failed, failed, event(3, 'completed', {})] })
    expect(state.parts.filter(part => part.type === 'error')).toHaveLength(1)
    expect(state.status).toBe('failed')
    expect(state.lastSequence).toBe(3)
  })

  it('marks an interrupted stream without discarding already rendered parts', () => {
    const state = replayAiEvents([event(0, 'text-delta', { text: 'partial' })])
    const interrupted = reduceAiMessageParts(state, { type: 'interrupt' })
    expect(interrupted.parts).toHaveLength(1)
    expect(interrupted.status).toBe('interrupted')
  })
})
