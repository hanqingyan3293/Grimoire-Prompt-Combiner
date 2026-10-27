import crypto from "crypto"
import type { AgentRuntime, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession } from "./types"

function makeSession(kind: RuntimeSession["runtime"], model: string, messages: RuntimeMessage[]): RuntimeSession {
  return { id: "session_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20), runtime: kind, model, createdAt: new Date().toISOString(), messages: [...messages] }
}

function trimSlash(value: string) { return value.endsWith("/") ? value.slice(0, -1) : value }

async function readSse(response: Response, onData: (value: Record<string, unknown>) => void) {
  const raw = await response.text()
  for (const line of raw.split(String.fromCharCode(10))) {
    const normalized = line.replace(String.fromCharCode(13), "")
    if (!normalized.startsWith("data:")) continue
    const text = normalized.slice(5).trim()
    if (!text || text === "[DONE]") continue
    try { onData(JSON.parse(text) as Record<string, unknown>) } catch {}
  }
}

export class AnthropicRuntime implements AgentRuntime {
  readonly kind = "anthropic" as const
  private readonly sessions = new Map<string, RuntimeSession>()
  constructor(private readonly config: { baseUrl?: string; apiKey?: string }) {}
  createSession(model: string, messages: RuntimeMessage[] = []) { const value = makeSession(this.kind, model, messages); this.sessions.set(value.id, value); return value }
  loadSession(value: RuntimeSession) { this.sessions.set(value.id, value) }
  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const current = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    const system = input.messages.filter(item => item.role === "system").map(item => String(item.content)).join(String.fromCharCode(10))
    const messages = input.messages.filter(item => item.role !== "system").map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: typeof item.content === "string" ? item.content : JSON.stringify(item.content) }))
    const endpoint = trimSlash(this.config.baseUrl || "https://api.anthropic.com/v1") + "/messages"
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-api-key": this.config.apiKey || "", "anthropic-version": "2023-06-01", accept: "text/event-stream" }, body: JSON.stringify({ model: input.model, max_tokens: 4096, system: system || undefined, messages, stream: true }) })
    if (!response.ok) throw new Error("Anthropic Runtime HTTP " + response.status + ": " + (await response.text()).slice(0, 300))
    let text = ""
    const chunks: string[] = []
    yield { type: "session-started", sessionId: current.id }
    await readSse(response, value => {
      const delta = value.delta && typeof value.delta === "object" ? value.delta as Record<string, unknown> : {}
      if (typeof delta.text === "string") chunks.push(delta.text)
    })
    for (const chunk of chunks) { text += chunk; yield { type: "text-delta", text: chunk } }
    current.messages = [...input.messages, { role: "assistant", content: text }]
    yield { type: "completed", text }
  }
}

export class GoogleRuntime implements AgentRuntime {
  readonly kind = "google" as const
  private readonly sessions = new Map<string, RuntimeSession>()
  constructor(private readonly config: { baseUrl?: string; apiKey?: string }) {}
  createSession(model: string, messages: RuntimeMessage[] = []) { const value = makeSession(this.kind, model, messages); this.sessions.set(value.id, value); return value }
  loadSession(value: RuntimeSession) { this.sessions.set(value.id, value) }
  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const current = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    const endpoint = trimSlash(this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta") + "/models/" + encodeURIComponent(input.model) + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(this.config.apiKey || "")
    const contents = input.messages.filter(item => item.role !== "system").map(item => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: typeof item.content === "string" ? item.content : JSON.stringify(item.content) }] }))
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ contents }) })
    if (!response.ok) throw new Error("Google Runtime HTTP " + response.status + ": " + (await response.text()).slice(0, 300))
    let text = ""
    const chunks: string[] = []
    yield { type: "session-started", sessionId: current.id }
    await readSse(response, value => {
      const candidates = Array.isArray(value.candidates) ? value.candidates : []
      const content = candidates[0] && typeof candidates[0] === "object" ? (candidates[0] as Record<string, unknown>).content : null
      const parts: unknown[] = content && typeof content === "object" && Array.isArray((content as Record<string, unknown>).parts) ? (content as Record<string, unknown>).parts as unknown[] : []
      for (const part of parts) if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") chunks.push(String((part as Record<string, unknown>).text))
    })
    for (const chunk of chunks) { text += chunk; yield { type: "text-delta", text: chunk } }
    current.messages = [...input.messages, { role: "assistant", content: text }]
    yield { type: "completed", text }
  }
}

