import crypto from "crypto"
import { chatStream, createClient } from "../client"
import type { AgentRuntime, RuntimeEvent, RuntimeMessage, RuntimeProviderProtocol, RuntimeSendInput, RuntimeSession, RuntimeToolCall } from "./types"

type OpenAICompatibleConfig = { baseUrl?: string; apiKey?: string; protocol?: RuntimeProviderProtocol }

function responseInput(messages: RuntimeMessage[]): unknown[] {
  const responseContent = (content: string | unknown[]) => {
    if (typeof content === 'string') return content
    return content.map(part => {
      if (!part || typeof part !== 'object') return part
      const value = part as Record<string, unknown>
      if (value.type === 'image_url' && value.image_url && typeof value.image_url === 'object') return { type: 'input_image', image_url: String((value.image_url as Record<string, unknown>).url || '') }
      if (value.type === 'text') return { type: 'input_text', text: String(value.text || '') }
      return value
    })
  }
  const items: unknown[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: message.toolCallId || '', output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) })
      continue
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.content) items.push({ role: 'assistant', content: responseContent(message.content) })
      for (const call of message.toolCalls) items.push({ type: 'function_call', call_id: call.callId, name: call.name, arguments: JSON.stringify(call.input ?? {}) })
      continue
    }
    items.push({ role: message.role === 'system' ? 'system' : message.role, content: responseContent(message.content) })
  }
  return items
}

function responseTools(tools: unknown[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined
  return tools.map(tool => {
    const value = tool && typeof tool === 'object' ? tool as Record<string, unknown> : {}
    const fn = value.function && typeof value.function === 'object' ? value.function as Record<string, unknown> : value
    return { type: 'function', name: String(fn.name || ''), description: typeof fn.description === 'string' ? fn.description : undefined, parameters: fn.parameters || { type: 'object', properties: {} }, strict: false }
  }).filter(tool => Boolean(tool.name))
}

export class OpenAICompatibleRuntime implements AgentRuntime {
  readonly kind = "openai-compatible" as const
  private readonly client
  private readonly protocol: RuntimeProviderProtocol
  private readonly sessions = new Map<string, RuntimeSession>()
  /**
   * Abort handles for in-flight calls, keyed by session.
   *
   * Without these the default runtime had NO `interrupt`, so the stop button returned `false`
   * and the stream ran to completion — the UI then had to wait out a response the user had
   * already cancelled. The handle is created per `send` and removed in `finally`, so a
   * completed call cannot be cancelled retroactively.
   */
  private readonly abortControllers = new Map<string, AbortController>()

  constructor(config: OpenAICompatibleConfig) {
    this.client = createClient({ base_url: config.baseUrl, api_key: config.apiKey })
    this.protocol = config.protocol || 'chat_completions'
  }

  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    const session: RuntimeSession = { id: "session_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20), runtime: this.kind, model, createdAt: new Date().toISOString(), messages: [...messages] }
    this.sessions.set(session.id, session)
    return session
  }

  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const session = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    const messages = input.messages.length ? input.messages : session.messages
    yield { type: "session-started", sessionId: session.id }
    const controller = new AbortController()
    this.abortControllers.set(session.id, controller)
    try {
      if (this.protocol === 'responses') {
        yield* this.sendResponses(session, input.model, messages, input.tools, controller.signal)
        return
      }
      yield* this.sendChatCompletions(session, input.model, messages, input.tools, controller.signal)
    } catch (error) {
      // An abort is a cancellation, not a failure. Reporting it as `failed` would show the
      // user an error for an action they took deliberately.
      if (isAbortError(error) || controller.signal.aborted) {
        yield { type: 'cancelled', reason: 'user' }
      } else {
        yield { type: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
    } finally {
      this.abortControllers.delete(session.id)
    }
    // The SDK does NOT throw on abort — it simply stops yielding, and the call then fell
    // through to the caller's `completed` path. Observed on a real SSE server: after an abort
    // the stream produced only the pre-abort token, yet the sequence was
    // `session-started, text-delta, completed` with no `cancelled`. The signal is the only
    // reliable evidence that the stream ended because the user asked it to, so it is checked
    // AFTER the body rather than relying on an exception that never arrives.
    if (controller.signal.aborted) {
      yield { type: 'cancelled', reason: 'user' }
    }
  }

  /**
   * Cancels the in-flight call for a session.
   *
   * Returns `void` to match the `AgentRuntime` contract. Whether a call was actually running
   * is observable from the event stream instead: an aborted call emits `cancelled`. Returning
   * a boolean here would have been a second, weaker source of truth for the same fact.
   */
  async interrupt(sessionId: string): Promise<void> {
    this.abortControllers.get(sessionId)?.abort()
  }

  private async *sendChatCompletions(session: RuntimeSession, model: string, messages: RuntimeMessage[], tools?: unknown[], signal?: AbortSignal): AsyncGenerator<RuntimeEvent, void, unknown> {
    const apiMessages = messages.map(message => {
      if (message.role === 'assistant' && message.toolCalls?.length) return { role: 'assistant', content: message.content, tool_calls: message.toolCalls.map(call => ({ id: call.callId, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) } })) }
      if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId, name: message.name }
      return { role: message.role, content: message.content }
    })
    let fullText = ''
    if (!tools?.length) {
      for await (const chunk of chatStream(this.client, model, apiMessages as Array<{ role: string; content: string | any[] }>, signal)) {
        if (chunk.text) { fullText += chunk.text; yield { type: 'text-delta', text: chunk.text } }
        // Usage arrives on the provider's final chunk; without this the no-tools path recorded
        // nothing at all (see `chatStream`).
        const usage = chatCompletionUsage(chunk.usage)
        if (usage) yield usage
      }
    } else {
      // `stream_options` is not in this SDK version's param type, so the whole call is cast — the
      // alternative was dropping usage capture entirely.
      const stream = await this.client.chat.completions.create({ model, messages: apiMessages as any, tools: tools as any, stream: true, stream_options: { include_usage: true } } as any, { signal }) as unknown as AsyncIterable<any>
      const toolCalls = new Map<number, { callId: string; name: string; arguments: string }>()
      for await (const chunk of stream as AsyncIterable<any>) {
        // Chat Completions reports usage on the FINAL chunk (which carries an empty `choices`
        // array) and only when `include_usage` was requested — hence the option above.
        const usage = chatCompletionUsage(chunk.usage)
        if (usage) yield usage
        const delta = chunk.choices?.[0]?.delta
        if (typeof delta?.content === 'string' && delta.content) { fullText += delta.content; yield { type: 'text-delta', text: delta.content } }
        for (const item of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
          const index = Number(item.index || 0)
          const current = toolCalls.get(index) || { callId: '', name: '', arguments: '' }
          if (item.id) current.callId = String(item.id)
          if (item.function?.name) current.name += String(item.function.name)
          if (item.function?.arguments) current.arguments += String(item.function.arguments)
          toolCalls.set(index, current)
        }
      }
      const normalized = Array.from(toolCalls.values()).filter(item => item.name).map((item, index): RuntimeToolCall => { let parsed: unknown = {}; try { parsed = item.arguments ? JSON.parse(item.arguments) : {} } catch { parsed = { raw: item.arguments } }; return { callId: item.callId || 'call_' + index, name: item.name, input: parsed } })
      for (const call of normalized) yield { type: 'tool-started', callId: call.callId, name: call.name, input: call.input }
      session.messages = [...messages, { role: 'assistant', content: fullText, toolCalls: normalized }]
      yield { type: 'completed', text: fullText, toolCalls: normalized, toolOwnership: 'host' }
      return
    }
    session.messages = [...messages, { role: 'assistant', content: fullText }]
    yield { type: 'completed', text: fullText }
  }

  private async *sendResponses(session: RuntimeSession, model: string, messages: RuntimeMessage[], tools?: unknown[], signal?: AbortSignal): AsyncGenerator<RuntimeEvent, void, unknown> {
    const stream = await this.client.responses.create({ model, input: responseInput(messages) as any, tools: responseTools(tools) as any, stream: true } as any, { signal })
    let fullText = ''
    const calls = new Map<string, { name: string; arguments: string }>()
    for await (const event of stream as unknown as AsyncIterable<any>) {
      // The Responses API reports counts on the terminal `response.completed` event, nested
      // under `response.usage` — a different shape from Chat Completions, normalized by the
      // same helper so consumers see one event type either way.
      if (event.type === 'response.completed') {
        const usage = responseApiUsage(event.response?.usage)
        if (usage) yield usage
      }
      if (event.type === 'response.output_text.delta') { fullText += String(event.delta || ''); yield { type: 'text-delta', text: String(event.delta || '') } }
      else if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') yield { type: 'reasoning-delta', text: String(event.delta || '') }
      else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') calls.set(String(event.item.call_id || event.item.id || ''), { name: String(event.item.name || ''), arguments: String(event.item.arguments || '') })
      else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        const id = String(event.item.call_id || event.item.id || '')
        const call = calls.get(id) || { name: '', arguments: '' }
        call.name = call.name || String(event.item.name || '')
        call.arguments = String(event.item.arguments || call.arguments)
        calls.set(id, call)
      }
      else if (event.type === 'response.function_call_arguments.delta') { const id = String(event.call_id || event.item_id || ''); const call = calls.get(id) || { name: '', arguments: '' }; call.arguments += String(event.delta || ''); calls.set(id, call) }
      else if (event.type === 'response.function_call_arguments.done') { const id = String(event.call_id || event.item_id || ''); const call = calls.get(id) || { name: String(event.name || ''), arguments: '' }; call.arguments = String(event.arguments || call.arguments); calls.set(id, call) }
      else if (event.type === 'response.failed' || event.type === 'response.error' || event.type === 'response.incomplete') { yield { type: 'failed', error: String(event.error?.message || event.message || event.response?.status || 'Responses API 请求失败') }; return }
      else if (event.type === 'response.completed' && event.response?.output && Array.isArray(event.response.output)) {
        for (const item of event.response.output) {
          if (item?.type !== 'function_call') continue
          const id = String(item.call_id || item.id || '')
          const call = calls.get(id) || { name: '', arguments: '' }
          call.name = call.name || String(item.name || '')
          call.arguments = String(item.arguments || call.arguments)
          calls.set(id, call)
        }
      }
    }
    const toolCalls: RuntimeToolCall[] = Array.from(calls.entries()).filter(([, call]) => call.name).map(([callId, call], index) => { let input: unknown = {}; try { input = call.arguments ? JSON.parse(call.arguments) : {} } catch { input = { raw: call.arguments } }; return { callId: callId || 'response_call_' + index, name: call.name, input } })
    for (const call of toolCalls) yield { type: 'tool-started', callId: call.callId, name: call.name, input: call.input }
    session.messages = [...messages, { role: 'assistant', content: fullText, ...(toolCalls.length ? { toolCalls } : {}) }]
    yield { type: 'completed', text: fullText, ...(toolCalls.length ? { toolCalls, toolOwnership: 'host' as const } : {}) }
  }
}

/**
 * Normalizes a Chat Completions `usage` object, or `undefined` when the provider sent none.
 *
 * Returning `undefined` rather than zeros is deliberate: a provider that does not report
 * usage must not look like one that reported zero tokens, and the source's usage UI
 * distinguishes "no data" from "zero".
 *
 * `prompt_tokens_details.cached_tokens` is OpenAI's cache-hit count; providers that omit the
 * nested object yield no `cachedTokens` rather than 0, for the same reason.
 */
/**
 * Reads a token count, distinguishing "absent" from "zero".
 *
 * `Number(null)` is 0 and `Number('')` is 0, so a blind `Number()` would turn a missing or
 * empty field into a real-looking zero reading. Only an actual finite number (or a numeric
 * string) counts; anything else is treated as absent.
 */
function readTokenCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function chatCompletionUsage(usage: unknown): { type: 'usage'; inputTokens?: number; outputTokens?: number; cachedTokens?: number } | null {
  if (!usage || typeof usage !== 'object') return null
  const value = usage as Record<string, unknown>
  const input = readTokenCount(value.prompt_tokens)
  const output = readTokenCount(value.completion_tokens)
  const details = value.prompt_tokens_details && typeof value.prompt_tokens_details === 'object'
    ? value.prompt_tokens_details as Record<string, unknown>
    : null
  const cached = details ? readTokenCount(details.cached_tokens) : null
  if (input === null && output === null && cached === null) return null
  return {
    type: 'usage',
    ...(input !== null ? { inputTokens: input } : {}),
    ...(output !== null ? { outputTokens: output } : {}),
    ...(cached !== null ? { cachedTokens: cached } : {})
  }
}

/** Normalizes a Responses API `usage` object (`input_tokens` / `output_tokens` / `input_tokens_details.cached_tokens`). */
function responseApiUsage(usage: unknown): { type: 'usage'; inputTokens?: number; outputTokens?: number; cachedTokens?: number } | null {
  if (!usage || typeof usage !== 'object') return null
  const value = usage as Record<string, unknown>
  const input = readTokenCount(value.input_tokens)
  const output = readTokenCount(value.output_tokens)
  const details = value.input_tokens_details && typeof value.input_tokens_details === 'object'
    ? value.input_tokens_details as Record<string, unknown>
    : null
  const cached = details ? readTokenCount(details.cached_tokens) : null
  if (input === null && output === null && cached === null) return null
  return {
    type: 'usage',
    ...(input !== null ? { inputTokens: input } : {}),
    ...(output !== null ? { outputTokens: output } : {}),
    ...(cached !== null ? { cachedTokens: cached } : {})
  }
}

/**
 * True when an error came from an aborted request.
 *
 * SDKs surface this differently (`AbortError`, `APIUserAbortError`, or a plain `Error` whose
 * message mentions aborting), so the name and the message are both checked rather than one.
 */
function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const named = error as { name?: string; message?: string }
  if (named.name === 'AbortError' || named.name === 'APIUserAbortError') return true
  return /aborted|abort/i.test(String(named.message || ''))
}

export const __usageTest = { chatCompletionUsage, responseApiUsage, isAbortError }
