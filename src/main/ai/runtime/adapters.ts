import crypto from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'
import type { AgentRuntime, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession } from './types'
import { HttpAgentRuntime } from './http-agent.runtime'

export class CodexRuntime extends HttpAgentRuntime {
  constructor(config: { endpoint: string; token?: string }) {
    super({ ...config, runtime: 'codex', promptPath: '/agent/codex/prompt', interruptPath: '/agent/codex/interrupt', toolsPath: '/agent/codex/tools', approvalPath: '/agent/codex/approval' })
  }
}

export class OpenCodeRuntime extends HttpAgentRuntime {
  constructor(config: { endpoint: string; token?: string }) {
    super({ ...config, runtime: 'opencode', promptPath: '/session/prompt', interruptPath: '/session/interrupt', toolsPath: '/tool', approvalPath: '/permission/reply' })
  }
}

export class PiRuntime implements AgentRuntime {
  readonly kind = 'pi' as const
  private child: ChildProcessWithoutNullStreams | null = null
  private sessions = new Map<string, RuntimeSession>()
  constructor(private readonly command: string, private readonly args: string[] = []) {}
  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    const session = { id: 'pi-session-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16), runtime: this.kind, model, createdAt: new Date().toISOString(), messages: [...messages] }
    this.sessions.set(session.id, session)
    return session
  }
  loadSession(session: RuntimeSession) { this.sessions.set(session.id, session) }
  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const session = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    if (!this.child) this.child = spawn(this.command, this.args, { stdio: 'pipe', windowsHide: true })
    const reader = readline.createInterface({ input: this.child.stdout })
    this.child.stdin.write(JSON.stringify({ type: 'prompt', sessionId: session.id, model: input.model, messages: input.messages.length ? input.messages : session.messages }) + String.fromCharCode(10))
    yield { type: 'session-started', sessionId: session.id }
    try {
      for await (const line of reader) {
        const value = JSON.parse(line) as Record<string, unknown>
        if (value.type === 'text-delta') yield { type: 'text-delta', text: String(value.text || '') }
        if (value.type === 'completed') { yield { type: 'completed', text: String(value.text || '') }; break }
        if (value.type === 'failed') { yield { type: 'failed', error: String(value.error || 'Pi Runtime 失败') }; break }
      }
    } finally {
      reader.close()
    }
  }
  async interrupt(sessionId: string) { this.child?.stdin.write(JSON.stringify({ type: 'interrupt', sessionId }) + String.fromCharCode(10)) }
  async close() { this.child?.kill(); this.child = null }
}
