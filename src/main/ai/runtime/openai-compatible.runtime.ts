import crypto from "crypto"
import { chatStream, createClient } from "../client"
import type { AgentRuntime, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession, RuntimeToolCall } from "./types"

export class OpenAICompatibleRuntime implements AgentRuntime {
  readonly kind = "openai-compatible" as const
  private readonly client
  private readonly sessions = new Map<string, RuntimeSession>()

  constructor(config: { baseUrl?: string; apiKey?: string }) {
    this.client = createClient({ base_url: config.baseUrl, api_key: config.apiKey })
  }

  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    const session: RuntimeSession = {
      id: "session_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
      runtime: this.kind,
      model,
      createdAt: new Date().toISOString(),
      messages: [...messages],
    }
    this.sessions.set(session.id, session)
    return session
  }

  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const session = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    const messages = input.messages.length ? input.messages : session.messages
    let fullText = ""
    yield { type: "session-started", sessionId: session.id }
    try {
      const apiMessages = messages.map(message => {
        if (message.role === 'assistant' && message.toolCalls?.length) {
          return {
            role: 'assistant',
            content: message.content,
            tool_calls: message.toolCalls.map(call => ({ id: call.callId, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) } })),
          }
        }
        if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId, name: message.name }
        return { role: message.role, content: message.content }
      })
      if (!input.tools?.length) {
        for await (const text of chatStream(this.client, input.model, apiMessages as Array<{ role: string; content: string | any[] }>)) {
          fullText += text
          yield { type: "text-delta", text }
        }
      } else {
        const stream = await this.client.chat.completions.create({ model: input.model, messages: apiMessages as any, tools: input.tools as any, stream: true })
        const toolCalls = new Map<number, { callId: string; name: string; arguments: string }>()
        for await (const chunk of stream as AsyncIterable<any>) {
          const delta = chunk.choices?.[0]?.delta
          if (typeof delta?.content === 'string' && delta.content) {
            fullText += delta.content
            yield { type: 'text-delta', text: delta.content }
          }
          for (const item of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
            const index = Number(item.index || 0)
            const current = toolCalls.get(index) || { callId: '', name: '', arguments: '' }
            if (item.id) current.callId = String(item.id)
            if (item.function?.name) current.name += String(item.function.name)
            if (item.function?.arguments) current.arguments += String(item.function.arguments)
            toolCalls.set(index, current)
          }
        }
        const normalized: RuntimeToolCall[] = []
        for (const item of toolCalls.values()) {
          if (!item.name) continue
          let parsed: unknown = {}
          try { parsed = item.arguments ? JSON.parse(item.arguments) : {} } catch { parsed = { raw: item.arguments } }
          normalized.push({ callId: item.callId || 'call_' + normalized.length, name: item.name, input: parsed })
        }
        for (const call of normalized) yield { type: 'tool-started', callId: call.callId, name: call.name, input: call.input }
        session.messages = [...messages, { role: 'assistant', content: fullText, toolCalls: normalized }]
        yield { type: 'completed', text: fullText, toolCalls: normalized }
        return
      }
      session.messages = [...messages, { role: "assistant", content: fullText }]
      yield { type: "completed", text: fullText }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: "failed", error: message }
    }
  }
}
