import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntime, RuntimeEvent, RuntimeSession, RuntimeSendInput } from '../ai/runtime/types'
import { runAgentRuntimeLoop } from './agent-runtime-turn.service'

const session: RuntimeSession = {
  id: 'runtime-session', runtime: 'openai-compatible', model: 'model', createdAt: 'now', messages: [],
}
const call = { callId: 'call-1', name: 'grimoire.tags.search', input: { query: 'cat' } }

function runtime(batches: RuntimeEvent[][]): AgentRuntime {
  let index = 0
  return {
    kind: 'openai-compatible',
    createSession: vi.fn(() => session),
    send: vi.fn(async function* (_input: RuntimeSendInput) {
      for (const event of batches[index++] || []) yield event
    }),
  }
}

describe('shared AgentRuntime turn loop', () => {
  it('re-enters only explicitly host-owned completed tool calls', async () => {
    const agent = runtime([
      [
        { type: 'text-delta', text: 'Searching' },
        { type: 'completed', text: 'Searching', toolOwnership: 'host', toolCalls: [call] },
      ],
      [{ type: 'text-delta', text: ' done' }, { type: 'completed', text: ' done' }],
    ])
    const execute = vi.fn(async () => ({ count: 2 }))
    const started = vi.fn()
    const finished = vi.fn()
    const result = await runAgentRuntimeLoop({
      runtime: agent,
      runtimeSession: session,
      model: 'model',
      messages: [{ role: 'user', content: 'find tags' }],
      executeHostTool: execute,
      onHostTool: phase => phase === 'started' ? started() : finished(),
    })

    expect(result.text).toBe('Searching done')
    expect(result.turns).toBe(2)
    expect(execute).toHaveBeenCalledExactlyOnceWith(call)
    expect(started).toHaveBeenCalledOnce()
    expect(finished).toHaveBeenCalledOnce()
    expect(vi.mocked(agent.send).mock.calls[1][0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', toolCallId: call.callId, content: '{"count":2}' }),
    ]))
  })

  it.each(['runtime', undefined] as const)('does not re-execute runtime telemetry without explicit host ownership (%s)', async ownership => {
    const agent = runtime([[
      { type: 'tool-started', ownership: 'runtime', ...call },
      { type: 'tool-finished', ownership: 'runtime', callId: call.callId },
      { type: 'completed', text: 'native result', toolCalls: [call], toolOwnership: ownership },
    ]])
    const execute = vi.fn()
    await runAgentRuntimeLoop({ runtime: agent, runtimeSession: session, model: 'model', messages: [], executeHostTool: execute })
    expect(execute).not.toHaveBeenCalled()
    expect(agent.send).toHaveBeenCalledOnce()
  })

  it('applies the message limiter before every model call, including after a host tool', async () => {
    const agent = runtime([
      [{ type: 'completed', text: '', toolOwnership: 'host', toolCalls: [call] }],
      [{ type: 'completed', text: 'done' }],
    ])
    const limitMessages = vi.fn(messages => messages.slice(-1))
    await runAgentRuntimeLoop({
      runtime: agent,
      runtimeSession: session,
      model: 'model',
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'query' }],
      limitMessages,
      executeHostTool: async () => 'ok',
    })
    expect(limitMessages).toHaveBeenCalledTimes(2)
    expect(vi.mocked(agent.send).mock.calls.map(([input]) => input.messages)).toEqual([
      [{ role: 'user', content: 'query' }],
      [{ role: 'tool', content: '"ok"', toolCallId: call.callId, name: call.name }],
    ])
  })

  it('treats cancellation as a terminal result without running pending tools', async () => {
    const agent = runtime([[{ type: 'tool-started', ownership: 'host', ...call }, { type: 'cancelled', reason: 'user' }]])
    const execute = vi.fn()
    const result = await runAgentRuntimeLoop({ runtime: agent, runtimeSession: session, model: 'model', messages: [], executeHostTool: execute })
    expect(result.cancelled).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects streams that end without a terminal event and propagates runtime failures', async () => {
    await expect(runAgentRuntimeLoop({ runtime: runtime([[{ type: 'text-delta', text: 'partial' }]]), runtimeSession: session, model: 'model', messages: [] }))
      .rejects.toThrow('RUNTIME_TURN_NO_TERMINAL')
    await expect(runAgentRuntimeLoop({ runtime: runtime([[{ type: 'failed', error: 'runtime failed' }]]), runtimeSession: session, model: 'model', messages: [] }))
      .rejects.toThrow('runtime failed')
  })

  it('does not perform a tool after the host cancels at completion', async () => {
    const agent = runtime([[{ type: 'completed', text: 'partial', toolOwnership: 'host', toolCalls: [call] }]])
    const execute = vi.fn()
    let cancelled = false
    const result = await runAgentRuntimeLoop({
      runtime: agent, runtimeSession: session, model: 'model', messages: [], executeHostTool: execute,
      isCancelled: () => cancelled,
      onEvent: () => { cancelled = true },
    })
    expect(result.cancelled).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips a model call entirely when already cancelled', async () => {
    const agent = runtime([])
    const result = await runAgentRuntimeLoop({ runtime: agent, runtimeSession: session, model: 'model', messages: [], isCancelled: () => true })
    expect(result).toMatchObject({ cancelled: true, turns: 0 })
    expect(agent.send).not.toHaveBeenCalled()
  })

  it.each(['duplicate', 'missing-id'] as const)('validates the whole host batch before any %s call side effects', async scenario => {
    const bad = scenario === 'duplicate' ? call : { ...call, callId: '' }
    const agent = runtime([[{ type: 'completed', text: '', toolOwnership: 'host', toolCalls: [call, bad] }]])
    const execute = vi.fn()
    await expect(runAgentRuntimeLoop({ runtime: agent, runtimeSession: session, model: 'model', messages: [], executeHostTool: execute }))
      .rejects.toThrow(scenario === 'duplicate' ? 'RUNTIME_DUPLICATE_TOOL_CALL' : 'RUNTIME_INVALID_TOOL_CALL')
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a last-budget host call before executing it', async () => {
    const agent = runtime([[{ type: 'completed', text: '', toolOwnership: 'host', toolCalls: [call] }]])
    const execute = vi.fn()
    await expect(runAgentRuntimeLoop({ runtime: agent, runtimeSession: session, model: 'model', messages: [], maxTurns: 1, executeHostTool: execute }))
      .rejects.toThrow('RUNTIME_MAX_TURNS_EXCEEDED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('enforces a bounded turn limit rather than silently truncating a tool chain', async () => {
    const agent = runtime(Array.from({ length: 2 }, () => [{ type: 'completed', text: '', toolOwnership: 'host', toolCalls: [call] }]))
    await expect(runAgentRuntimeLoop({
      runtime: agent,
      runtimeSession: session,
      model: 'model',
      messages: [],
      maxTurns: 2,
      executeHostTool: async () => 'ok',
    })).rejects.toThrow('RUNTIME_MAX_TURNS_EXCEEDED')
  })
})
