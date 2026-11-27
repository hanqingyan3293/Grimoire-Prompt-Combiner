import { describe, expect, it } from 'vitest'
import { parseComfyExecution, serializeComfyExecution, type ComfyExecutionState } from './comfy-execution'

const requested = '11111111-1111-4111-8111-111111111111'
const real = '22222222-2222-4222-8222-222222222222'

function state(patch: Partial<ComfyExecutionState> = {}): ComfyExecutionState {
  return {
    version: 1,
    endpoint: 'http://127.0.0.1:8188',
    phase: 'prepared',
    requestedPromptId: requested,
    promptId: null,
    cancelOutcome: 'none',
    ...patch,
  }
}

describe('shared Comfy execution state', () => {
  it('treats a NULL legacy row as having no execution identity', () => {
    expect(parseComfyExecution(null)).toBeNull()
    expect(parseComfyExecution(undefined)).toBeNull()
  })

  it.each([
    ['prepared', null],
    ['submitting', null],
    ['submitting', real],
    ['waiting', real],
    ['importing', real],
    ['submit-uncertain', null],
    ['submit-uncertain', real],
  ] as const)('accepts the legal phase %s with promptId %s', (phase, promptId) => {
    const value = state({ phase, promptId })
    expect(parseComfyExecution(JSON.stringify(value))).toEqual(value)
  })

  it.each([
    ['not json', '{'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['JSON scalar', '1'],
  ])('rejects %s rather than guessing a state', (_label, raw) => {
    expect(() => parseComfyExecution(raw)).toThrow()
  })

  it.each([0, 2, '1', null])('rejects version %s', version => {
    expect(() => parseComfyExecution(JSON.stringify({ ...state(), version }))).toThrow(/version/i)
  })

  it.each([
    { ...state(), extra: true },
    { version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'prepared', requestedPromptId: requested, promptId: null },
    { version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'prepared', requestedPromptId: requested, cancelOutcome: 'none' },
  ])('rejects a state with missing or extra fields', value => {
    expect(() => parseComfyExecution(JSON.stringify(value))).toThrow()
  })

  it.each([
    'http://user:pass@127.0.0.1:8188',
    'http://127.0.0.1:8188?token=1',
    'http://127.0.0.1:8188#fragment',
    'http://127.0.0.1:8188?',
    'http://127.0.0.1:8188#',
    ' http://127.0.0.1:8188',
    'ftp://127.0.0.1:8188',
    '',
  ])('rejects endpoint %j', endpoint => {
    expect(() => parseComfyExecution(JSON.stringify(state({ endpoint })))).toThrow(/endpoint/i)
  })

  it.each([null, '', 'not-a-uuid', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '11111111-1111-4111-8111-11111111111'])('rejects requestedPromptId %j', value => {
    expect(() => parseComfyExecution(JSON.stringify({ ...state(), requestedPromptId: value }))).toThrow(/requestedPromptId/i)
  })

  it.each(['', '   ', 'x'.repeat(201), 42])('rejects an unusable real promptId %j', value => {
    expect(() => parseComfyExecution(JSON.stringify(state({ phase: 'waiting', promptId: value as unknown as string })))).toThrow(/promptId/i)
  })

  it('rejects phase and identity combinations that cannot be true', () => {
    expect(() => parseComfyExecution(JSON.stringify(state({ phase: 'prepared', promptId: real })))).toThrow(/promptId/i)
    expect(() => parseComfyExecution(JSON.stringify(state({ phase: 'waiting', promptId: null })))).toThrow(/promptId/i)
    expect(() => parseComfyExecution(JSON.stringify(state({ phase: 'importing', promptId: null })))).toThrow(/promptId/i)
    expect(() => parseComfyExecution(JSON.stringify(state({ phase: 'waiting', promptId: real, cancelOutcome: 'remote-confirmed' })))).not.toThrow()
    expect(() => parseComfyExecution(JSON.stringify(state({ phase: 'prepared', promptId: null, cancelOutcome: 'remote-confirmed' })))).toThrow(/remote-confirmed/i)
  })

  it.each(['submitted', 'cancel', ''] as const)('rejects unknown phase %j', phase => {
    expect(() => parseComfyExecution(JSON.stringify({ ...state(), phase }))).toThrow(/phase/i)
  })

  it.each(['done', 'remote', ''] as const)('rejects unknown cancelOutcome %j', cancelOutcome => {
    expect(() => parseComfyExecution(JSON.stringify({ ...state(), cancelOutcome }))).toThrow(/cancelOutcome/i)
  })

  it('serializes the six fields deterministically and round-trips', () => {
    const value = state({ phase: 'waiting', promptId: real, cancelOutcome: 'local-only' })
    const raw = serializeComfyExecution(value)
    expect(raw).toBe(JSON.stringify({ version: 1, endpoint: 'http://127.0.0.1:8188', phase: 'waiting', requestedPromptId: requested, promptId: real, cancelOutcome: 'local-only' }))
    expect(parseComfyExecution(raw)).toEqual(value)
    expect(serializeComfyExecution(parseComfyExecution(raw)!)).toBe(raw)
  })

  it('refuses to serialize an invalid state instead of persisting a guess', () => {
    expect(() => serializeComfyExecution(state({ phase: 'waiting', promptId: null }))).toThrow(/promptId/i)
    expect(() => serializeComfyExecution({ ...state(), version: 2 } as unknown as ComfyExecutionState)).toThrow(/version/i)
  })
})
