import { describe, expect, it } from 'vitest'
import { eventToMessagePart, toCherryMessage } from './message-adapter'

describe('Cherry message adapter', () => {
  it('normalizes legacy text content into text parts', () => {
    const result = toCherryMessage({ id: 'm1', session_id: 's1', sequence: 0, role: 'assistant', content: { text: 'hello' }, attachments: [], status: 'completed', created_at: 'now' })
    expect(result.parts).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('converts tool and permission events into renderable parts', () => {
    expect(eventToMessagePart({ id: 'e1', session_id: 's1', sequence: 0, event_type: 'tool-started', payload: { callId: 'c1', name: 'read' }, created_at: 'now' })).toMatchObject({ type: 'tool-call', callId: 'c1', status: 'running' })
    expect(eventToMessagePart({ id: 'e2', session_id: 's1', sequence: 1, event_type: 'permission-requested', payload: { requestId: 'p1', permission: 'write' }, created_at: 'now' })).toMatchObject({ type: 'permission', requestId: 'p1', status: 'pending' })
  })
})
