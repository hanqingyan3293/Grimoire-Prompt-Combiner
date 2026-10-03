import crypto from "crypto"
import { chatStream, createClient } from "../client"
import type { AgentRuntime, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession } from "./types"

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
      for await (const text of chatStream(this.client, input.model, messages)) {
        fullText += text
        yield { type: "text-delta", text }
      }
      session.messages = [...messages, { role: "assistant", content: fullText }]
      yield { type: "completed", text: fullText }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield { type: "failed", error: message }
    }
  }
}
