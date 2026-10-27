import { describe, expect, it } from 'vitest'
import { applyTurnEvent, createLiveTurn, liveTurnHasContent, liveTurnParts } from './live-turn'

const event = (event_type: string, payload: Record<string, unknown> = {}) => ({
  kind: 'event',
  sessionId: 's1',
  record: { event_type, payload }
})

describe('compat live turn overlay', () => {
  it('accumulates text deltas and reasoning deltas into separate ordered entries', () => {
    let turn = createLiveTurn('s1')
    turn = applyTurnEvent(turn, 's1', { kind: 'delta', sessionId: 's1', text: '你' })!
    turn = applyTurnEvent(turn, 's1', { kind: 'delta', sessionId: 's1', text: '好' })!
    turn = applyTurnEvent(turn, 's1', event('reasoning-delta', { text: '思考' }))!
    turn = applyTurnEvent(turn, 's1', event('reasoning-delta', { text: '中' }))!
    turn = applyTurnEvent(turn, 's1', { kind: 'delta', sessionId: 's1', text: '！' })!

    expect(turn.entries).toEqual([
      { kind: 'text', text: '你好' },
      { kind: 'reasoning', text: '思考中' },
      { kind: 'text', text: '！' }
    ])
    const parts = liveTurnParts(turn)
    expect(parts).toEqual([
      { type: 'text', text: '你好', state: 'streaming' },
      { type: 'reasoning', text: '思考中', state: 'streaming' },
      { type: 'text', text: '！', state: 'streaming' }
    ])
  })

  it('tracks a tool lifecycle from started through finished', () => {
    let turn = createLiveTurn('s1')
    turn = applyTurnEvent(turn, 's1', event('tool-started', { callId: 'c1', name: 'search', input: { q: 'x' } }))!
    expect(liveTurnParts(turn)[0]).toMatchObject({ type: 'dynamic-tool', toolName: 'search', toolCallId: 'c1', state: 'input-available', input: { q: 'x' } })

    turn = applyTurnEvent(turn, 's1', event('tool-finished', { callId: 'c1', output: { hits: 3 } }))!
    expect(liveTurnParts(turn)[0]).toMatchObject({ toolCallId: 'c1', state: 'output-available', output: { hits: 3 } })

    turn = applyTurnEvent(turn, 's1', event('tool-finished', { callId: 'c2' }))!
    // Unknown call id appends nothing; the turn keeps one entry.
    expect(turn.entries).toHaveLength(1)
  })

  it('marks a failed tool finished with output-error', () => {
    let turn = applyTurnEvent(createLiveTurn('s1'), 's1', event('tool-started', { callId: 'c1', name: 'bash' }))!
    turn = applyTurnEvent(turn, 's1', event('tool-finished', { callId: 'c1', error: 'boom' }))!
    expect(liveTurnParts(turn)[0]).toMatchObject({ state: 'output-error', errorText: 'boom' })
  })

  it('projects compaction started/finished onto the source compaction anchor part', () => {
    let turn = createLiveTurn('s1')
    turn = applyTurnEvent(turn, 's1', event('compaction-started'))!
    expect(liveTurnParts(turn)[0]).toEqual({ type: 'data-compaction-anchor', data: { status: 'compacting', phase: 'turn-start' } })

    turn = applyTurnEvent(turn, 's1', event('compaction-finished'))!
    expect(liveTurnParts(turn)[0]).toEqual({ type: 'data-compaction-anchor', data: { status: 'done', phase: 'turn-start' } })
    expect(turn.entries).toHaveLength(1)
  })

  it('ignores unrelated events without creating a turn', () => {
    expect(applyTurnEvent(null, 's1', event('session-started', { runtimeSessionId: 'r1' }))).toBeNull()
    expect(applyTurnEvent(null, 's1', { kind: 'message', sessionId: 's1' })).toBeNull()
    expect(liveTurnHasContent(null)).toBe(false)
    expect(liveTurnHasContent(createLiveTurn('s1'))).toBe(false)
  })
})
