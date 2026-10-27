import crypto from 'crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { AgentRuntime, RuntimeApprovalInput, RuntimeCapabilities, RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession } from './types'
import { HttpAgentRuntime } from './http-agent.runtime'
import { nativeRuntimeCapabilities } from './capabilities'
import { runtimeProcessEnvironment } from '../../services/agent-runtime-safety.service'

export class CodexRuntime extends HttpAgentRuntime {
  constructor(config: { endpoint: string; token?: string }) {
    super({ ...config, runtime: 'codex', promptPath: '/agent/codex/prompt', interruptPath: '/agent/codex/interrupt', toolsPath: '/agent/codex/tools', approvalPath: '/agent/codex/approval' })
  }
}

export class OpenCodeRuntime extends HttpAgentRuntime {
  private readonly endpoint: string
  private readonly token?: string
  private readonly directory?: string
  private readonly defaultModel?: string
  private readonly remoteSessions = new Map<string, string>()
  private readonly opencodeSessions = new Map<string, RuntimeSession>()
  private readonly permissionSessions = new Map<string, { remoteSessionId: string; localSessionId: string; callId?: string; action: string; turn: { controller: AbortController }; deciding: boolean }>()
  private readonly readers = new Set<ReadableStreamDefaultReader<Uint8Array>>()
  private readonly activeSends = new Map<string, { controller: AbortController; interrupted: boolean; remoteSessionId?: string }>()
  private readonly nativeToolPolicy: 'disabled' | 'ask'
  private readonly enableNativeSessionOperations: boolean
  private closed = false
  constructor(config: {
    endpoint: string; token?: string; directory?: string; model?: string; remoteSessionId?: string
    /** Main-only opt-in; the managed server must also use an explicit approval policy. */
    nativeToolPolicy?: 'disabled' | 'ask'
    /** Legacy fork/summarize only; neither durable replay nor business-history recovery. */
    enableNativeSessionOperations?: boolean
  }) {
    super({ ...config, runtime: 'opencode', promptPath: '/session/:sessionID/message', interruptPath: '/session/:sessionID/abort', toolsPath: '/tool', approvalPath: '/permission/:requestID/reply' })
    this.endpoint = config.endpoint.replace(/\/$/, '')
    this.token = config.token
    this.directory = config.directory
    this.defaultModel = config.model
    this.initialRemoteSessionId = config.remoteSessionId
    if (config.nativeToolPolicy !== undefined && config.nativeToolPolicy !== 'disabled' && config.nativeToolPolicy !== 'ask') throw new Error('OPENCODE_NATIVE_TOOL_POLICY_INVALID')
    this.nativeToolPolicy = config.nativeToolPolicy ?? 'disabled'
    this.enableNativeSessionOperations = config.enableNativeSessionOperations === true
  }
  private initialRemoteSessionId?: string
  private effectiveModel(model: string) {
    return model.includes('/') || !this.defaultModel ? model : this.defaultModel
  }
  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    if (this.closed) throw new Error('OpenCode Runtime 已关闭')
    const session: RuntimeSession = { id: 'opencode-session-' + crypto.randomUUID().replaceAll('-', '').slice(0, 18), runtime: this.kind, model: this.effectiveModel(model), createdAt: new Date().toISOString(), messages: [...messages] }
    this.loadSession(session)
    return session
  }
  loadSession(session: RuntimeSession) {
    if (this.closed) throw new Error('OpenCode Runtime 已关闭')
    if (this.activeSends.has(session.id)) throw new Error('OpenCode Session 已有正在运行的请求')
    this.opencodeSessions.set(session.id, session)
    if (this.initialRemoteSessionId) {
      this.remoteSessions.set(session.id, this.initialRemoteSessionId)
      // A restored native reference belongs to one local session, never its branches.
      this.initialRemoteSessionId = undefined
    }
  }
  getSessionReference(sessionId: string) { return this.remoteSessions.get(sessionId) }
  getCapabilities(): RuntimeCapabilities { return nativeRuntimeCapabilities('opencode', { persistent: this.remoteSessions.size > 0 }) }
  private headers() { return { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(this.token ? { authorization: 'Bearer ' + this.token } : {}) } }
  private modelRef(model: string) {
    const slash = model.indexOf('/')
    return slash > 0 ? { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) } : undefined
  }
  private async ensureRemoteSession(session: RuntimeSession, signal: AbortSignal) {
    const existing = this.remoteSessions.get(session.id)
    if (existing) return existing
    const model = this.modelRef(session.model)
    const response = await fetch(this.endpoint + '/api/session', { method: 'POST', headers: this.headers(), body: JSON.stringify({ agent: 'build', ...(model ? { model: { providerID: model.providerID, id: model.modelID } } : {}), ...(this.directory ? { location: { directory: this.directory } } : {}) }), signal })
    try {
      if (!response.ok) throw new Error('OpenCode 创建 Session 失败：HTTP ' + response.status + ' ' + (await response.text()).slice(0, 300))
      const data = await response.json() as Record<string, unknown>
      signal.throwIfAborted()
      const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : data
      const id = String(nested.id || nested.sessionID || nested.sessionId || '')
      if (!id) throw new Error('OpenCode 未返回 Session ID')
      this.remoteSessions.set(session.id, id)
      return id
    } finally { try { await response.body?.cancel() } catch {} }
  }
  private legacyUrl(route: string) {
    const url = new URL(this.endpoint + route)
    if (this.directory) url.searchParams.set('directory', this.directory)
    return url.toString()
  }
  private async applyNativePolicy(remoteId: string, signal: AbortSignal) {
    // Source SessionPrompt.prompt turns boolean `tools` into allow/deny rules,
    // never ask rules. Use the legacy PATCH ruleset for explicit approval mode.
    // task/skill/question could escape the audited top-level execution boundary.
    const permission = [
      { permission: '*', pattern: '*', action: this.nativeToolPolicy === 'ask' ? 'ask' : 'deny' },
      ...['external_directory', 'task', 'skill', 'question'].map(permission => ({ permission, pattern: '*', action: 'deny' })),
    ]
    const response = await fetch(this.legacyUrl('/session/' + encodeURIComponent(remoteId)), { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ permission }), signal })
    try { if (!response.ok) throw new Error('OpenCode 权限策略失败：HTTP ' + response.status) }
    finally { try { await response.body?.cancel() } catch {} }
    signal.throwIfAborted()
  }
  private clearPermissions(localSessionId: string) {
    for (const [id, pending] of this.permissionSessions) if (pending.localSessionId === localSessionId) this.permissionSessions.delete(id)
  }
  private async *readSse(response: Response, signal: AbortSignal): AsyncGenerator<Record<string, unknown>, void, unknown> {
    if (!response.body) throw new Error('OpenCode 事件流为空')
    const reader = response.body.getReader()
    this.readers.add(reader)
    // Also cancel the reader explicitly: aborting fetch is not sufficient for an
    // already acquired stream (or a custom transport supplying a Response).
    const onAbort = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener('abort', onAbort, { once: true })
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        signal.throwIfAborted()
        const chunk = await reader.read()
        signal.throwIfAborted()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const records = buffer.split(/\r?\n\r?\n/)
        buffer = records.pop() || ''
        for (const record of records) {
          const data = record.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
          if (!data || data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            const value = parsed.data && typeof parsed.data === 'object' && typeof parsed.type !== 'string' ? parsed.data as Record<string, unknown> : parsed
            yield value
          } catch {}
        }
      }
      // A server may close immediately after the final line. Accept a complete
      // JSON event still buffered, but never turn EOF itself into success.
      const tail = buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (tail && tail !== '[DONE]') {
        try {
          const parsed = JSON.parse(tail) as Record<string, unknown>
          const value = parsed.data && typeof parsed.data === 'object' && typeof parsed.type !== 'string' ? parsed.data as Record<string, unknown> : parsed
          yield value
        } catch {}
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.readers.delete(reader)
      try { await reader.cancel() } catch {}
      reader.releaseLock()
    }
  }
  private normalizeEvent(value: Record<string, unknown>, context: {
    localSessionId: string; remoteSessionId: string; turn: { controller: AbortController }
    messageRoles: Map<string, string>
    parts: Map<string, { type: 'text' | 'reasoning'; text: string }>
    tools: Map<string, { started: boolean; finished: boolean }>
    permissions: Map<string, 'pending' | 'resolved'>
    seenEventIds: Set<string>
  }): RuntimeEvent[] {
    // Version-matched SessionV1 / PermissionV1 schemas, not substring matching.
    const type = String(value.type || '')
    if (!['message.updated', 'message.part.updated', 'message.part.delta', 'permission.asked', 'permission.replied', 'session.compacted', 'session.status', 'session.idle', 'session.error'].includes(type)) return []
    const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const properties = object(value.properties)
    const info = object(properties.info)
    const part = object(properties.part)
    const sessionIds = [properties.sessionID, properties.sessionId, info.sessionID, part.sessionID].filter(id => typeof id === 'string' && id.length > 0)
    // The stream is instance-wide. Even a terminal must identify this session.
    // Filter BEFORE dedupe so another session cannot poison our bounded window.
    if (!sessionIds.length || sessionIds.some(id => id !== context.remoteSessionId)) return []
    const eventId = typeof value.id === 'string' ? value.id : ''
    if (eventId) {
      if (context.seenEventIds.has(eventId)) return []
      context.seenEventIds.add(eventId)
      if (context.seenEventIds.size > 4096) context.seenEventIds.delete(context.seenEventIds.values().next().value as string)
    }
    const events: RuntimeEvent[] = []
    if (type === 'message.updated') {
      if (typeof info.id === 'string' && (info.role === 'assistant' || info.role === 'user')) context.messageRoles.set(info.id, info.role)
    }
    if (type === 'message.part.updated') {
      const messageId = typeof part.messageID === 'string' ? part.messageID : ''
      const partId = typeof part.id === 'string' ? part.id : ''
      // Unknown role is not assistant. The source publishes metadata before parts.
      if (!messageId || !partId || context.messageRoles.get(messageId) !== 'assistant') return []
      const key = JSON.stringify([messageId, partId])
      if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string') {
        const previous = context.parts.get(key)
        if (previous && previous.type !== part.type) return []
        const current = previous?.text ?? ''
        // Snapshot + deltas refer to ONE part. An old/short snapshot cannot reset
        // that part, and a second assistant message cannot replace the first.
        if (part.text.startsWith(current)) {
          context.parts.set(key, { type: part.type, text: part.text })
          const delta = part.text.slice(current.length)
          if (delta) events.push({ type: part.type === 'text' ? 'text-delta' : 'reasoning-delta', text: delta })
        }
      }
      if (part.type === 'tool') {
        const state = object(part.state)
        const callId = typeof part.callID === 'string' ? part.callID : ''
        const name = typeof part.tool === 'string' ? part.tool : ''
        if (!callId || !name || !['pending', 'running', 'completed', 'error'].includes(String(state.status))) return []
        const toolKey = JSON.stringify([messageId, callId])
        const tool = context.tools.get(toolKey) ?? { started: false, finished: false }
        context.tools.set(toolKey, tool)
        if (tool.finished || state.status === 'pending') return []
        if (!tool.started) {
          tool.started = true
          events.push({ type: 'tool-started', ownership: 'runtime', callId, name, input: state.input ?? part.input })
        }
        if (state.status === 'completed' || state.status === 'error') {
          tool.finished = true
          events.push({ type: 'tool-finished', ownership: 'runtime', callId, output: state.output ?? state.result, error: state.status === 'error' ? String(state.error || 'OpenCode Tool failed') : undefined })
          // Source processor.failToolCall settles the tool, not the whole turn.
        }
      }
    }
    if (type === 'message.part.delta' && properties.field === 'text' && typeof properties.delta === 'string') {
      if (context.messageRoles.get(String(properties.messageID || '')) !== 'assistant') return []
      const part = context.parts.get(JSON.stringify([properties.messageID, properties.partID]))
      if (part && properties.delta) {
        part.text += properties.delta
        events.push({ type: part.type === 'reasoning' ? 'reasoning-delta' : 'text-delta', text: properties.delta })
      }
    }
    if (type === 'permission.asked') {
      const requestId = String(properties.id || properties.permissionID || '')
      const action = String(properties.permission || properties.action || '')
      if (!requestId || !action || context.permissions.has(requestId)) return []
      // Never rebind a native request to another local session/turn.
      if (this.permissionSessions.has(requestId)) return []
      const tool = object(properties.tool)
      const callId = typeof tool.callID === 'string' ? tool.callID : undefined
      context.permissions.set(requestId, 'pending')
      this.permissionSessions.set(requestId, { remoteSessionId: context.remoteSessionId, localSessionId: context.localSessionId, callId, action, turn: context.turn, deciding: false })
      events.push({ type: 'permission-requested', requestId, action, detail: { ...properties, localSessionId: context.localSessionId, remoteSessionId: context.remoteSessionId } })
    }
    if (type === 'permission.replied') {
      const requestId = String(properties.requestID || '')
      if (context.permissions.get(requestId) !== 'pending') return []
      context.permissions.set(requestId, 'resolved')
      this.permissionSessions.delete(requestId)
      events.push({ type: 'permission-resolved', requestId, decision: String(properties.reply || ''), detail: properties })
    }
    // 1.18.34 has session.compacted, NOT paired compaction start/end events.
    if (type === 'session.compacted') events.push({ type: 'compaction-finished', detail: properties })
    if (type === 'session.error') {
      const error = object(properties.error)
      const data = object(error.data)
      events.push({ type: 'failed', error: String(properties.message || data.message || error.message || properties.error || 'OpenCode 事件失败') })
    }
    if ((type === 'session.status' && object(properties.status).type === 'idle') || type === 'session.idle') {
      events.push({ type: 'completed', text: [...context.parts.values()].filter(part => part.type === 'text').map(part => part.text).join('') })
    }
    return events
  }
  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    if (this.closed) throw new Error('OpenCode Runtime 已关闭')
    const session = this.opencodeSessions.get(input.sessionId)
    if (!session) throw new Error('OpenCode Session 不存在')
    if (this.activeSends.has(session.id)) throw new Error('OpenCode Session 已有正在运行的请求')
    const active: { controller: AbortController; interrupted: boolean; remoteSessionId?: string } = { controller: new AbortController(), interrupted: false }
    const signal = active.controller.signal
    this.activeSends.set(session.id, active)
    const timeout = setTimeout(() => active.controller.abort(new Error('OpenCode 请求超时')), 120_000)
    let eventsResponse: Response | undefined
    let eventsResponsePromise: Promise<Response> | undefined
    let promptResponse: Response | undefined
    let promptGuard: Promise<void> | undefined
    let promptFailure: Error | undefined
    try {
      const remoteId = await this.ensureRemoteSession(session, signal)
      signal.throwIfAborted()
      if ([...this.activeSends.values()].some(other => other !== active && other.remoteSessionId === remoteId)) throw new Error('OpenCode Native Session 已有正在运行的请求')
      active.remoteSessionId = remoteId
      if (this.nativeToolPolicy === 'ask') await this.applyNativePolicy(remoteId, signal)
      const messages = input.messages.length ? input.messages : session.messages
      const lastUser = [...messages].reverse().find(item => item.role === 'user')
      const prompt = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content || '')
      // The v1.18.34 session event route is a wait-for-event stream: its fetch
      // promise does not resolve headers until the prompt produces an event. Start
      // the subscription before prompting, but do not await it here or the two
      // requests deadlock on a real server.
      // Source handlers/event.ts listens eagerly and emits live events only. JSON
      // `id` is useful for bounded dedupe, not a replay cursor; SSE id is undefined.
      eventsResponsePromise = fetch(this.legacyUrl('/event'), { headers: { accept: 'text/event-stream', ...(this.token ? { authorization: 'Bearer ' + this.token } : {}) }, signal }).then(response => {
        eventsResponse = response
        return response
      })
      // A fast HTTP error should fail before admitting the prompt. The real
      // stream waits for the first event, so yield one microtask and then admit
      // the prompt when the response is still pending.
      await Promise.race([eventsResponsePromise, new Promise<void>(resolve => queueMicrotask(resolve))])
      if (eventsResponse && !eventsResponse.ok) throw new Error('OpenCode 事件流失败：HTTP ' + eventsResponse.status)
      const model = this.modelRef(session.model)
      promptGuard = fetch(this.legacyUrl('/session/' + encodeURIComponent(remoteId) + '/message'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ agent: 'build', ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}), ...(this.nativeToolPolicy === 'disabled' ? { tools: { '*': false } } : {}), parts: [{ type: 'text', text: prompt }] }),
        signal,
      }).then(async response => {
        promptResponse = response
        try {
          if (!response.ok) throw new Error('OpenCode Prompt 失败：HTTP ' + response.status + ' ' + (await response.text()).slice(0, 300))
        } finally { try { await response.body?.cancel() } catch {} }
      }).catch(error => {
        // A legacy `/message` response may legitimately wait for a native
        // approval, but an actual transport/HTTP failure must unblock the
        // waiting SSE reader and terminate the turn.
        if (!signal.aborted) {
          promptFailure = error instanceof Error ? error : new Error(String(error))
          active.controller.abort(promptFailure)
        }
      })
      eventsResponse = await eventsResponsePromise
      signal.throwIfAborted()
      if (!eventsResponse.ok) throw new Error('OpenCode 事件流失败：HTTP ' + eventsResponse.status)
      yield { type: 'session-started', sessionId: session.id }
      const context = {
        localSessionId: session.id, remoteSessionId: remoteId, turn: active,
        messageRoles: new Map<string, string>(),
        parts: new Map<string, { type: 'text' | 'reasoning'; text: string }>(),
        tools: new Map<string, { started: boolean; finished: boolean }>(),
        permissions: new Map<string, 'pending' | 'resolved'>(), seenEventIds: new Set<string>(),
      }
      for await (const record of this.readSse(eventsResponse, signal)) {
        signal.throwIfAborted()
        for (const event of this.normalizeEvent(record, context)) {
          signal.throwIfAborted()
          if (event.type === 'completed' || event.type === 'failed') {
            if (event.type === 'completed') {
              await promptGuard
              if (promptFailure) throw promptFailure
              // Cancellation can win while a terminal is waiting for /message.
              signal.throwIfAborted()
              session.messages = [...messages, { role: 'assistant', content: event.text }]
            }
            this.clearPermissions(session.id)
            yield event
            return
          }
          yield event
        }
      }
      // Transport EOF, including a truncated final SSE record, proves neither
      // success nor idle. Only a source terminal record may complete the turn.
      this.clearPermissions(session.id)
      yield { type: 'failed', error: 'OpenCode 事件流提前结束：未收到终止事件' }
    } catch (error) {
      this.clearPermissions(session.id)
      if (active.interrupted) yield { type: 'cancelled', reason: 'user' }
      else yield { type: 'failed', error: signal.aborted ? String(signal.reason instanceof Error ? signal.reason.message : signal.reason) : error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timeout)
      active.controller.abort()
      this.clearPermissions(session.id)
      // Drain BOTH promises after abort. A late prompt response must not arrive
      // after cleanup, leak a body, or reject without an observer.
      await Promise.allSettled([eventsResponsePromise, promptGuard])
      this.activeSends.delete(session.id)
      for (const response of [eventsResponse, promptResponse]) {
        if (response?.body && !response.body.locked) { try { await response.body.cancel() } catch {} }
      }
    }
  }
  async interrupt(sessionId: string) {
    const active = this.activeSends.get(sessionId)
    this.clearPermissions(sessionId)
    if (active) {
      active.interrupted = true
      active.controller.abort(new Error('OpenCode 用户中断'))
    }
    const remoteId = this.remoteSessions.get(sessionId)
    if (!remoteId) return
    const response = await fetch(this.legacyUrl('/session/' + encodeURIComponent(remoteId) + '/abort'), { method: 'POST', headers: this.headers(), signal: AbortSignal.timeout(5000) })
    try {
      if (!response.ok && response.status !== 404) throw new Error('OpenCode 中断失败：HTTP ' + response.status)
    } finally { try { await response.body?.cancel() } catch {} }
  }
  async approve(input: RuntimeApprovalInput) {
    if (!['accept', 'acceptForSession', 'decline'].includes(input.decision)) throw new Error('OpenCode 权限决策无效')
    const pending = this.permissionSessions.get(input.requestId)
    if (!pending || this.closed || pending.turn.controller.signal.aborted || this.activeSends.get(pending.localSessionId) !== pending.turn || this.remoteSessions.get(pending.localSessionId) !== pending.remoteSessionId) throw new Error('OpenCode 权限请求已失效')
    if (input.sessionId !== undefined && input.sessionId !== pending.localSessionId) throw new Error('OpenCode 权限请求会话不匹配')
    if (input.callId !== undefined && input.callId !== pending.callId) throw new Error('OpenCode 权限请求工具调用不匹配')
    if (input.action !== undefined && input.action !== pending.action) throw new Error('OpenCode 权限请求动作不匹配')
    if (input.decision !== 'decline' && ['external_directory', 'task', 'skill', 'question'].includes(pending.action)) throw new Error('OPENCODE_NATIVE_ACTION_DISABLED')
    if (pending.deciding) throw new Error('OpenCode 权限请求正在回复')
    pending.deciding = true // Claim synchronously, BEFORE the network await.
    // Source Permission.state.approved is INSTANCE-wide, not session-scoped.
    // Main's broker owns exact local grants; native `always` must never be sent.
    const reply = input.decision === 'decline' ? 'reject' : 'once'
    try {
      const response = await fetch(this.legacyUrl('/permission/' + encodeURIComponent(input.requestId) + '/reply'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ reply }), signal: AbortSignal.any([pending.turn.controller.signal, AbortSignal.timeout(5000)]) })
      try { if (!response.ok) throw new Error('OpenCode 权限回复失败：HTTP ' + response.status) }
      finally { try { await response.body?.cancel() } catch {} }
      pending.turn.controller.signal.throwIfAborted()
    } finally {
      // An HTTP/transport failure is ambiguous, never automatically retry approval.
      if (this.permissionSessions.get(input.requestId) === pending) this.permissionSessions.delete(input.requestId)
    }
  }
  async reject(input: RuntimeApprovalInput) { await this.approve({ ...input, decision: 'decline' }) }
  private async nativeSessionOperation<T>(sessionId: string, run: (session: RuntimeSession, remoteId: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.enableNativeSessionOperations) throw new Error('OPENCODE_NATIVE_SESSION_OPERATIONS_DISABLED')
    if (this.closed) throw new Error('OpenCode Runtime 已关闭')
    const session = this.opencodeSessions.get(sessionId)
    const remoteId = this.remoteSessions.get(sessionId)
    if (!session || !remoteId) throw new Error('OpenCode Native Session 不存在')
    if (this.activeSends.has(sessionId) || [...this.activeSends.values()].some(active => active.remoteSessionId === remoteId)) throw new Error('OpenCode Session 已有正在运行的请求')
    const active = { controller: new AbortController(), interrupted: false, remoteSessionId: remoteId }
    this.activeSends.set(sessionId, active)
    const timeout = setTimeout(() => active.controller.abort(new Error('OpenCode 请求超时')), 120_000)
    try { return await run(session, remoteId, active.controller.signal) }
    finally { clearTimeout(timeout); this.activeSends.delete(sessionId); this.clearPermissions(sessionId) }
  }
  /** Entire native history only. Source fork rewrites message/part IDs and does
   * not preserve a parentID/permission link. Main must persist NEW provenance. */
  async forkSession(sessionId: string): Promise<RuntimeSession> {
    return this.nativeSessionOperation(sessionId, async (session, remoteId, signal) => {
      const response = await fetch(this.legacyUrl('/session/' + encodeURIComponent(remoteId) + '/fork'), { method: 'POST', headers: this.headers(), body: '{}', signal })
      try {
        if (!response.ok) throw new Error('OpenCode Fork 失败：HTTP ' + response.status)
        const data = await response.json() as Record<string, unknown>
        const id = typeof data.id === 'string' ? data.id : ''
        signal.throwIfAborted()
        if (!id || id === remoteId || [...this.remoteSessions.values()].includes(id)) throw new Error('OpenCode Fork 未返回独立 Session ID')
        const fork = this.createSession(session.model, structuredClone(session.messages))
        this.remoteSessions.set(fork.id, id)
        return fork
      } finally { try { await response.body?.cancel() } catch {} }
    })
  }
  /** Await native summarize/loop; no synthetic compaction/recovery events.
   * Source may generate a follow-up turn. This is not lossless history recovery. */
  async compactSession(sessionId: string): Promise<void> {
    await this.nativeSessionOperation(sessionId, async (session, remoteId, signal) => {
      const model = this.modelRef(session.model)
      if (!model) throw new Error('OpenCode Compaction 需要 provider/model')
      await this.applyNativePolicy(remoteId, signal)
      const response = await fetch(this.legacyUrl('/session/' + encodeURIComponent(remoteId) + '/summarize'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ ...model, auto: false }), signal })
      try {
        if (!response.ok) throw new Error('OpenCode Compaction 失败：HTTP ' + response.status)
        if (await response.json() !== true) throw new Error('OpenCode Compaction 未返回原生成功状态')
        signal.throwIfAborted()
      } finally { try { await response.body?.cancel() } catch {} }
    })
  }
  async close() {
    this.closed = true
    this.permissionSessions.clear()
    for (const active of this.activeSends.values()) active.controller.abort(new Error('OpenCode Runtime 已关闭'))
    for (const reader of this.readers) { try { await reader.cancel() } catch {} }
    this.readers.clear()
  }
}

export type PiRuntimeConfig = {
  command: string
  args?: string[]
  directory?: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  api?: string
  headers?: Record<string, string>
  /** A stable Grimoire-owned id passed to Pi's native session store. */
  sessionId?: string
  /** A main-owned session directory; omitted means ephemeral --no-session. */
  sessionDir?: string
  /** Native Pi tools/extensions are disabled until a host approval handoff is proven. */
  allowNativeTools?: boolean
  allowExtensions?: boolean
}

export function buildPiRpcArgs(config: PiRuntimeConfig): string[] {
  const args = [...(config.args || [])]
  const valueAfter = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const hasArg = (name: string) => args.includes(name)
  const reject = (condition: boolean, code: string) => { if (condition) throw new Error(code) }
  const model = config.provider && config.model?.startsWith(config.provider + '::') ? config.model.slice(config.provider.length + 2) : config.model

  reject(!config.allowNativeTools && args.some(arg => ['--tools', '-t', '--no-builtin-tools'].includes(arg)), 'PI_NATIVE_TOOLS_DISABLED')
  reject(!config.allowExtensions && args.some(arg => ['--extension', '-e'].includes(arg)), 'PI_EXTENSIONS_DISABLED')
  reject(args.includes('--api-key'), 'PI_API_KEY_ARG_FORBIDDEN')
  reject(args.includes('--session'), 'PI_SESSION_PATH_FORBIDDEN')
  reject(!config.sessionId && args.includes('--session-id'), 'PI_SESSION_ID_REQUIRED')
  reject(Boolean(config.sessionDir) && args.includes('--no-session'), 'PI_SESSION_PERSISTENCE_CONFLICT')
  reject(config.sessionDir === undefined && args.includes('--session-dir'), 'PI_SESSION_DIR_FORBIDDEN')
  reject(args.includes('--models') && !!model, 'PI_MODEL_SCOPE_CONFLICT')

  if (args.includes('--mode')) reject(valueAfter('--mode') !== 'rpc', 'PI_RPC_MODE_REQUIRED')
  if (config.provider && args.includes('--provider')) reject(valueAfter('--provider') !== config.provider, 'PI_PROVIDER_CONFLICT')
  if (model && args.includes('--model')) reject(valueAfter('--model') !== model, 'PI_MODEL_CONFLICT')
  if (config.sessionId && args.includes('--session-id')) reject(valueAfter('--session-id') !== config.sessionId, 'PI_SESSION_ID_CONFLICT')
  if (config.sessionDir && args.includes('--session-dir')) reject(valueAfter('--session-dir') !== config.sessionDir, 'PI_SESSION_DIR_CONFLICT')

  const extra: string[] = []
  if (!hasArg('--mode')) extra.push('--mode', 'rpc')
  if (config.provider && !hasArg('--provider')) extra.push('--provider', config.provider)
  if (model && !hasArg('--model')) extra.push('--model', model)
  if (config.sessionId && config.sessionDir && !hasArg('--session-id')) extra.push('--session-id', config.sessionId)
  if (config.sessionDir && !hasArg('--session-dir')) extra.push('--session-dir', config.sessionDir)
  if (!config.sessionDir && !hasArg('--session-id') && !hasArg('--no-session')) extra.push('--no-session')
  if (!config.allowNativeTools && !hasArg('--no-tools')) extra.push('--no-tools')
  if (!config.allowExtensions && !hasArg('--no-extensions')) extra.push('--no-extensions')
  return [...args, ...extra]
}

export class PiRuntime implements AgentRuntime {
  readonly kind = 'pi' as const
  private child: ChildProcessWithoutNullStreams | null = null
  private childStart: Promise<void> | null = null
  private sessions = new Map<string, RuntimeSession>()
  private lineQueue: string[] = []
  private lineWaiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = []
  private stdoutBuffer = Buffer.alloc(0)
  private stderrBuffer = ''
  private tempAgentDir: string | null = null
  private readonly config: PiRuntimeConfig
  constructor(command: string, args?: string[], directory?: string)
  constructor(config: PiRuntimeConfig)
  constructor(commandOrConfig: string | PiRuntimeConfig, args: string[] = [], directory?: string) {
    this.config = typeof commandOrConfig === 'string'
      ? { command: commandOrConfig, args, directory }
      : { ...commandOrConfig, args: commandOrConfig.args || [] }
  }
  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    const session = { id: this.config.sessionId || 'pi-session-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16), runtime: this.kind, model, createdAt: new Date().toISOString(), messages: [...messages] }
    this.sessions.set(session.id, session)
    return session
  }
  loadSession(session: RuntimeSession) { this.sessions.set(session.id, session) }
  getSessionReference(sessionId: string) { return this.config.sessionDir && this.sessions.has(sessionId) ? sessionId : undefined }
  getCapabilities(): RuntimeCapabilities { return nativeRuntimeCapabilities('pi', { persistent: Boolean(this.config.sessionDir && this.config.sessionId) }) }
  private effectiveModel(model = this.config.model || 'default'): string {
    const prefix = this.config.provider ? this.config.provider + '::' : ''
    return prefix && model.startsWith(prefix) ? model.slice(prefix.length) : model
  }
  private async prepareAgentDir(): Promise<void> {
    if (this.tempAgentDir) return
    this.tempAgentDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-pi-'))
    if (!this.config.provider || !this.config.baseUrl || !this.config.api) {
      await fs.promises.writeFile(path.join(this.tempAgentDir, 'models.json'), JSON.stringify({ providers: {} }), { encoding: 'utf8', mode: 0o600 })
      await fs.promises.writeFile(path.join(this.tempAgentDir, 'auth.json'), '{}', { encoding: 'utf8', mode: 0o600 })
      return
    }
    const provider = this.config.provider
    const model = this.effectiveModel()
    const modelConfig = {
      id: model,
      name: model,
      api: this.config.api,
      baseUrl: this.config.baseUrl,
      headers: this.config.headers,
      reasoning: false,
      input: ['text'],
      contextWindow: 128_000,
      maxTokens: 8_192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    await fs.promises.writeFile(path.join(this.tempAgentDir, 'models.json'), JSON.stringify({ providers: { [provider]: { name: provider, api: this.config.api, baseUrl: this.config.baseUrl, models: [modelConfig] } } }), { encoding: 'utf8', mode: 0o600 })
    await fs.promises.writeFile(path.join(this.tempAgentDir, 'auth.json'), JSON.stringify(this.config.apiKey ? { [provider]: { type: 'api_key', key: this.config.apiKey } } : {}), { encoding: 'utf8', mode: 0o600 })
  }
  private async cleanupAgentDir(): Promise<void> {
    const dir = this.tempAgentDir
    this.tempAgentDir = null
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  private async ensureChild(): Promise<void> {
    if (this.child) return
    if (this.childStart) return this.childStart
    this.childStart = (async () => {
      try {
        await this.prepareAgentDir()
      const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.config.command)
      const env = { ...runtimeProcessEnvironment(), ...(this.tempAgentDir ? { PI_CODING_AGENT_DIR: this.tempAgentDir } : {}) }
      this.child = spawn(this.config.command, buildPiRpcArgs(this.config), { stdio: 'pipe', windowsHide: true, shell, ...(this.config.directory ? { cwd: this.config.directory } : {}), env })
      this.child.stdout.on('data', (data: Buffer) => {
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, data])
        while (true) {
          const index = this.stdoutBuffer.indexOf(0x0a)
          if (index < 0) break
          const line = this.stdoutBuffer.subarray(0, index).toString('utf8').replace(/\r$/, '')
          this.stdoutBuffer = this.stdoutBuffer.subarray(index + 1)
          const waiter = this.lineWaiters.shift()
          if (waiter) waiter.resolve(line)
          else this.lineQueue.push(line)
        }
      })
      this.child.stderr.on('data', data => { this.stderrBuffer = (this.stderrBuffer + String(data)).slice(-16_000) })
      this.child.once('error', error => {
        while (this.lineWaiters.length) this.lineWaiters.shift()!.reject(error)
        void this.close()
      })
      this.child.once('exit', (code, signal) => {
        if (!this.child) return
        const error = new Error('Pi Runtime exited (' + String(code ?? 'null') + (signal ? ', ' + signal : '') + ')')
        while (this.lineWaiters.length) this.lineWaiters.shift()!.reject(error)
        this.child = null
        void this.cleanupAgentDir()
      })
      } catch (error) {
        await this.cleanupAgentDir()
        throw error
      }
    })()
    try { await this.childStart } finally { this.childStart = null }
  }
  private nextLine(): Promise<string> {
    const line = this.lineQueue.shift()
    if (line !== undefined) return Promise.resolve(line)
    if (!this.child) return Promise.reject(new Error('Pi Runtime 未启动'))
    return new Promise((resolve, reject) => { this.lineWaiters.push({ resolve, reject }) })
  }
  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const session = this.sessions.get(input.sessionId) || this.createSession(input.model, input.messages)
    await this.ensureChild()
    if (!this.child) throw new Error('Pi Runtime 启动失败')
    const message = [...(input.messages.length ? input.messages : session.messages)].reverse().find(item => item.role === 'user')?.content
    const prompt = typeof message === 'string' ? message : JSON.stringify(message || '')
    const requestId = 'pi_req_' + crypto.randomUUID().replaceAll('-', '').slice(0, 18)
    this.child.stdin.write(JSON.stringify({ id: requestId, type: 'prompt', message: prompt }) + String.fromCharCode(10))
    yield { type: 'session-started', sessionId: session.id }
    let text = ''
    const state: PiRpcTurnState = {}
    while (true) {
      const line = await this.nextLine()
      let value: Record<string, unknown>
      try { value = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (value.type === 'response' && typeof value.id === 'string' && value.id !== requestId) continue
      for (const event of normalizePiRpcRecord(value, state)) {
        if (event.type === 'text-delta') { text += event.text; yield event }
        else if (event.type === 'completed') { const finalText = state.text ?? text; session.messages = [...input.messages, { role: 'assistant', content: finalText }]; yield { ...event, text: finalText }; return }
        else if (event.type === 'failed') { yield event; return }
        else yield event
      }
    }
  }
  async interrupt() { this.child?.stdin.write(JSON.stringify({ id: 'pi_abort_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12), type: 'abort' }) + String.fromCharCode(10)) }
  async close() {
    const child = this.child
    try { child?.stdin.end() } catch {}
    try { child?.kill() } catch {}
    this.child = null
    const error = new Error('Pi Runtime 已关闭')
    while (this.lineWaiters.length) this.lineWaiters.shift()!.reject(error)
    this.lineQueue = []
    this.stdoutBuffer = Buffer.alloc(0)
    this.stderrBuffer = ''
    await this.cleanupAgentDir()
  }
}

/** State belongs to one prompt. agent_end is authoritative but may be followed by
 * retries; only the payload-free agent_settled terminates the RPC turn.
 */
export type PiRpcTurnState = { text?: string; willRetry?: boolean }

export function normalizePiRpcRecord(value: Record<string, unknown>, state: PiRpcTurnState = {}): RuntimeEvent[] {
  const events: RuntimeEvent[] = []
  if (value.type === 'response' && value.success === false) events.push({ type: 'failed', error: String(value.error || 'Pi RPC 请求失败') })
  if (value.type === 'message_update') {
    const event = value.assistantMessageEvent && typeof value.assistantMessageEvent === 'object' ? value.assistantMessageEvent as Record<string, unknown> : {}
    if (event.type === 'text_delta') events.push({ type: 'text-delta', text: String(event.delta || '') })
    if (event.type === 'thinking_delta') events.push({ type: 'reasoning-delta', text: String(event.delta || '') })
    // toolcall_start/end describe generation, not execution. Execution starts once,
    // at tool_execution_start, with the complete arguments (Pi json-event.ts).
  }
  if (value.type === 'tool_execution_start') events.push({ type: 'tool-started', ownership: 'runtime', callId: String(value.toolCallId || ''), name: String(value.toolName || ''), input: value.args })
  if (value.type === 'tool_execution_update') events.push({ type: 'tool-progress', ownership: 'runtime', callId: String(value.toolCallId || ''), name: String(value.toolName || ''), status: 'running', output: value.partialResult })
  if (value.type === 'tool_execution_end') events.push({ type: 'tool-finished', ownership: 'runtime', callId: String(value.toolCallId || ''), output: value.result, error: value.isError ? String(value.result || 'Pi Tool failed') : undefined })
  if (value.type === 'agent_end') {
    state.willRetry = value.willRetry === true
    if (Array.isArray(value.messages)) state.text = value.messages.filter(message => message && typeof message === 'object' && (message as Record<string, unknown>).role === 'assistant').map(extractPiMessageText).join('')
  }
  if (value.type === 'agent_settled') events.push({ type: 'completed', text: state.text ?? '' })
  return events
}

function extractPiMessageText(value: unknown): string {
  if (!value) return ''
  if (Array.isArray(value)) return value.map(extractPiMessageText).join('')
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string' && (!record.type || record.type === 'text')) return record.text
  if (Array.isArray(record.content)) return record.content.map(extractPiMessageText).join('')
  if (typeof record.message === 'object') return extractPiMessageText(record.message)
  return ''
}
