import { describe, expect, it } from 'vitest'
import { OpenAICompatibleRuntime } from './openai-compatible.runtime'

async function* events(items: unknown[]) { for (const item of items) yield item }

describe('OpenAI-compatible protocol routing', () => {
  it('uses Responses API events for text and reasoning output', async () => {
    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'responses' })
    ;(runtime as any).client = { responses: { create: async () => events([
      { type: 'response.output_text.delta', delta: '你好' },
      { type: 'response.reasoning_summary_text.delta', delta: '思考' },
      { type: 'response.completed' },
    ]) } }
    const session = runtime.createSession('gpt-6-luna', [{ role: 'user', content: 'hi' }])
    const result = []
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages })) result.push(event)
    expect(result).toEqual(expect.arrayContaining([
      { type: 'session-started', sessionId: session.id },
      { type: 'text-delta', text: '你好' },
      { type: 'reasoning-delta', text: '思考' },
      { type: 'completed', text: '你好' },
    ]))
  })

  it('normalizes Responses function calls into tool-started events', async () => {
    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'responses' })
    ;(runtime as any).client = { responses: { create: async () => events([
      { type: 'response.output_item.added', item: { type: 'function_call', call_id: 'call-1', name: 'grimoire.tags.search' } },
      { type: 'response.function_call_arguments.delta', call_id: 'call-1', delta: '{"query":"猫"}' },
      { type: 'response.function_call_arguments.done', call_id: 'call-1', arguments: '{"query":"猫"}' },
      { type: 'response.completed' },
    ]) } }
    const session = runtime.createSession('gpt-6-luna', [{ role: 'user', content: '找标签' }])
    const result = []
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages, tools: [{ type: 'function', function: { name: 'grimoire.tags.search', parameters: { type: 'object' } } }] })) result.push(event)
    expect(result).toContainEqual({ type: 'tool-started', callId: 'call-1', name: 'grimoire.tags.search', input: { query: '猫' } })
  })

  it('accepts a completed Responses output item when argument events are absent', async () => {
    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'responses' })
    ;(runtime as any).client = { responses: { create: async () => events([
      { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call-2', name: 'grimoire.images.search', arguments: '{"tag":"portrait"}' } },
      { type: 'response.completed' },
    ]) } }
    const session = runtime.createSession('gpt-6-luna', [{ role: 'user', content: '找图' }])
    const result = []
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages, tools: [{ type: 'function', function: { name: 'grimoire.images.search', parameters: { type: 'object' } } }] })) result.push(event)
    expect(result).toContainEqual({ type: 'tool-started', callId: 'call-2', name: 'grimoire.images.search', input: { tag: 'portrait' } })
  })

  it('converts Chat-style image parts to Responses input_image parts', async () => {
    let request: any = null
    const runtime = new OpenAICompatibleRuntime({ baseUrl: 'https://example.test/v1', apiKey: 'test', protocol: 'responses' })
    ;(runtime as any).client = { responses: { create: async (value: unknown) => { request = value; return events([{ type: 'response.output_text.delta', delta: '收到' }, { type: 'response.completed' }]) } } }
    const session = runtime.createSession('gpt-6-luna', [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }])
    for await (const _event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages })) {}
    expect(request.input[0].content).toEqual([{ type: 'input_text', text: '看图' }, { type: 'input_image', image_url: 'data:image/png;base64,abc' }])
  })
})
