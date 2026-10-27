import { describe, expect, it } from 'vitest'
import { permissionToApprovalPart, readParts, toSourcePart, toolStateFromStatus } from './part-projection'

describe('Grimoire → source Cherry message part projection', () => {
  it('keeps text, reasoning and code native to the source renderer', () => {
    expect(toSourcePart({ type: 'text', text: 'hello' })).toEqual({ type: 'text', text: 'hello' })
    expect(toSourcePart({ type: 'reasoning', text: 'why' })).toEqual({ type: 'reasoning', text: 'why', state: 'done' })
    // Source renders data-code as a real code block; no Markdown fence lowering.
    expect(toSourcePart({ type: 'code', code: 'const a = 1', language: 'ts' })).toEqual({
      type: 'data-code',
      data: { content: 'const a = 1', language: 'ts' }
    })
  })

  it('projects tool call/result parts into AI SDK dynamic-tool parts', () => {
    const call = toSourcePart({ type: 'tool-call', id: 'call_1', name: 'search', input: { q: 'x' }, status: 'running' })
    expect(call).toMatchObject({ type: 'dynamic-tool', toolName: 'search', toolCallId: 'call_1', state: 'input-available', input: { q: 'x' } })

    const result = toSourcePart({ type: 'tool-result', id: 'call_1', name: 'search', output: { hits: 3 } })
    expect(result).toMatchObject({ type: 'dynamic-tool', toolName: 'search', toolCallId: 'call_1', state: 'output-available', output: { hits: 3 } })

    const error = toSourcePart({ type: 'tool-result', id: 'call_2', name: 'bash', error: 'boom' })
    expect(error).toMatchObject({ state: 'output-available', output: 'boom', errorText: 'boom' })
    expect(toSourcePart({ type: 'tool-call', id: 'call_3', name: 'bash', status: 'failed' })).toMatchObject({ state: 'output-error' })
  })

  it('maps mcp parts to tool parts and errors to data-error', () => {
    expect(toSourcePart({ type: 'mcp', tool: 'docs_search', payload: { q: 'a' }, status: 'completed' })).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'docs_search',
      state: 'output-available',
      input: { q: 'a' }
    })
    expect(toSourcePart({ type: 'error', text: '请求失败' })).toEqual({ type: 'data-error', data: { message: '请求失败', name: 'Error' } })
  })

  it('projects a pending permission into an AI SDK approval-requested tool part', () => {
    const part = permissionToApprovalPart({ requestId: 'req_1', sessionId: 's1', permission: 'execute', detail: { tool: 'bash', command: 'ls' } })
    expect(part).toEqual({
      type: 'dynamic-tool',
      toolName: 'bash',
      toolCallId: 'req_1',
      state: 'approval-requested',
      approval: { id: 'req_1' },
      input: { tool: 'bash', command: 'ls' }
    })

    const fallback = permissionToApprovalPart({ requestId: 'req_2', permission: 'network' })
    expect(fallback.toolName).toBe('network')
    expect(fallback.state).toBe('approval-requested')
  })

  it('uses the tool-call id as the join key when the permission carries one', () => {
    // The source approval card correlates a decision to a CALL by `toolCallId` and
    // resolves the TOOL it belongs to from the same part — which is what the source
    // `autoApprove` action needs to persist a per-tool rule. The request id still
    // identifies the approval itself.
    const part = permissionToApprovalPart({
      requestId: 'req_9',
      sessionId: 's1',
      permission: 'network',
      detail: { tool: 'mcp:pvd_docs:search', toolCallId: 'call_xyz', input: { q: 'x' } }
    })
    expect(part.toolCallId).toBe('call_xyz')
    expect((part.approval as Record<string, unknown>).id).toBe('req_9')
    expect(part.toolName).toBe('mcp:pvd_docs:search')

    // A tool-call id of the empty string is not an identity — fall back to the request
    // id rather than emitting an empty join key that would match nothing.
    const empty = permissionToApprovalPart({ requestId: 'req_10', detail: { tool: 'bash', toolCallId: '' } })
    expect(empty.toolCallId).toBe('req_10')
  })

  it('reads parts arrays and plain-string content, and maps statuses', () => {
    expect(readParts({ parts: [{ type: 'text', text: 'a' }] })).toHaveLength(1)
    expect(readParts('plain')).toEqual([{ type: 'text', text: 'plain' }])
    expect(readParts({})).toEqual([])
    expect(toolStateFromStatus('failed')).toBe('output-error')
    expect(toolStateFromStatus('streaming')).toBe('input-available')
    expect(toolStateFromStatus('completed')).toBe('output-available')
  })
})
