import crypto from 'crypto'
import type { AgentRuntime, AgentRuntimeKind, RuntimeApprovalInput, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession } from './types'

type HttpAgentRuntimeConfig = { endpoint: string; token?: string; runtime: AgentRuntimeKind; promptPath?: string; interruptPath?: string; toolsPath?: string; approvalPath?: string }

export class HttpAgentRuntime implements AgentRuntime {
  readonly kind: AgentRuntimeKind
  private readonly config: HttpAgentRuntimeConfig
  private readonly sessions = new Map<string, RuntimeSession>()
  constructor(config: HttpAgentRuntimeConfig) { this.kind = config.runtime; this.config = { ...config, endpoint: config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint } }
  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    const session: RuntimeSession = { id: 'session_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20), runtime: this.kind, model, createdAt: new Date().toISOString(), messages: [...messages] }
    this.sessions.set(session.id, session)
    return session
  }
  loadSession(session: RuntimeSession) { this.sessions.set(session.id, session) }
  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const session = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    const messages = input.messages.length ? input.messages : session.messages
    const response = await this.request(this.config.promptPath || '/prompt', { sessionId: session.id, model: input.model, messages, tools: input.tools || [] })
    yield { type: 'session-started', sessionId: session.id }
    const text = typeof response.text === 'string' ? response.text : ''
    if (text) yield { type: 'text-delta', text }
    session.messages = [...messages, { role: 'assistant', content: text }]
    yield { type: 'completed', text }
  }
  async interrupt(sessionId: string) { await this.request(this.config.interruptPath || '/interrupt', { sessionId }) }
  async approve(input: RuntimeApprovalInput) { await this.request(this.config.approvalPath || '/approval', input) }
  async reject(input: RuntimeApprovalInput) { await this.request(this.config.approvalPath || '/approval', input) }
  async listTools() { const response = await this.request(this.config.toolsPath || '/tools', undefined, 'GET'); return Array.isArray(response.tools) ? response.tools : [] }
  private async request(path: string, body?: unknown, method = 'POST'): Promise<Record<string, any>> {
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' }
    if (this.config.token) headers.authorization = 'Bearer ' + this.config.token
    const response = await fetch(this.config.endpoint + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })
    const data = await response.json().catch(() => ({})) as Record<string, any>
    if (!response.ok) throw new Error(data.error || data.message || 'Agent Runtime HTTP ' + response.status)
    return data
  }
}
