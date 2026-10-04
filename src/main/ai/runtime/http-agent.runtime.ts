import crypto from 'crypto'
import type { AgentRuntime, AgentRuntimeKind, RuntimeApprovalInput, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession, RuntimeToolCall } from './types'

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
    const prompt = await this.requestPrompt(this.config.promptPath || '/prompt', { sessionId: session.id, model: input.model, messages, tools: input.tools || [] })
    const response = prompt.response
    yield { type: 'session-started', sessionId: session.id }
    const streamedEvents = prompt.events.length ? prompt.events : (Array.isArray(response.events) ? response.events as unknown[] : [])
    if (streamedEvents.length) {
      for (const item of streamedEvents) {
        const event = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        if (event.type === 'text-delta') yield { type: 'text-delta', text: String(event.text || '') }
        else if (event.type === 'tool-started' || event.type === 'tool-call') yield { type: 'tool-started', callId: String(event.callId || event.requestId || ''), name: String(event.name || event.tool || ''), input: event.input ?? event.arguments }
        else if (event.type === 'tool-finished' || event.type === 'tool-result') yield { type: 'tool-finished', callId: String(event.callId || event.requestId || ''), output: event.output ?? event.result, error: typeof event.error === 'string' ? event.error : undefined }
        else if (event.type === 'permission-requested') yield { type: 'permission-requested', requestId: String(event.requestId || ''), action: String(event.action || ''), detail: event.detail }
        else if (event.type === 'failed') yield { type: 'failed', error: String(event.error || 'Agent Runtime 失败') }
      }
    }
    const text = typeof response.text === 'string' ? response.text : streamedEvents.filter(item => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text-delta').map(item => String((item as Record<string, unknown>).text || '')).join('')
    if (text && !streamedEvents.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text-delta')) yield { type: 'text-delta', text }
    session.messages = [...messages, { role: 'assistant', content: text }]
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls as RuntimeToolCall[] : undefined
    yield { type: 'completed', text, ...(toolCalls?.length ? { toolCalls } : {}) }
  }
  async interrupt(sessionId: string) { await this.request(this.config.interruptPath || '/interrupt', { sessionId }) }
  async approve(input: RuntimeApprovalInput) { await this.request(this.config.approvalPath || '/approval', { ...input, decision: input.decision === 'decline' ? 'accept' : input.decision }) }
  async reject(input: RuntimeApprovalInput) { await this.request(this.config.approvalPath || '/approval', { ...input, decision: 'decline' }) }
  async listTools() { const response = await this.request(this.config.toolsPath || '/tools', undefined, 'GET'); return Array.isArray(response.tools) ? response.tools : [] }
  private async requestPrompt(path: string, body: unknown): Promise<{ response: Record<string, any>; events: unknown[] }> {
    const headers: Record<string, string> = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
    if (this.config.token) headers.authorization = 'Bearer ' + this.config.token
    const response = await fetch(this.config.endpoint + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })
    const raw = await response.text()
    if (!response.ok) {
      let error: Record<string, unknown> = {}
      try { error = JSON.parse(raw) as Record<string, unknown> } catch {}
      throw new Error(String(error.error || error.message || raw || 'Agent Runtime HTTP ' + response.status))
    }
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream') && !raw.includes('data:')) {
      try { return { response: JSON.parse(raw) as Record<string, any>, events: [] } } catch { return { response: {}, events: [] } }
    }
    const events: unknown[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const value = line.slice(5).trim()
      if (!value || value === '[DONE]') continue
      try { events.push(JSON.parse(value)) } catch {}
    }
    return { response: {}, events }
  }
  private async request(path: string, body?: unknown, method = 'POST'): Promise<Record<string, any>> {
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' }
    if (this.config.token) headers.authorization = 'Bearer ' + this.config.token
    const response = await fetch(this.config.endpoint + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(60_000) })
    const data = await response.json().catch(() => ({})) as Record<string, any>
    if (!response.ok) throw new Error(data.error || data.message || 'Agent Runtime HTTP ' + response.status)
    return data
  }
}
