/**
 * Main-only, opt-in Pi 1.0.1 SDK adapter. Pi owns the agent loop and native
 * transcript; only explicitly configured host custom tools can execute. RPC is
 * not imported, selected, modified or replaced by this module.
 */
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { PiProviderInjection } from '../../../integrations/pi/modelInjection'
import {
  createPiSdkSession, piSdkDigest, type PiSdkSessionHandle, type PiSdkSessionReference,
} from '../../../integrations/pi/sdk-session'
import type {
  AgentRuntime, RuntimeApprovalInput, RuntimeCapabilities, RuntimeCapability,
  RuntimeEvent, RuntimeMessage, RuntimeSendInput, RuntimeSession,
} from './types'

export interface PiSdkHostTool {
  /** Provider-safe alias, explicitly mapped to a main-owned ToolRegistry tool. */
  name: string
  description: string
  parameters: ToolDefinition['parameters']
  /** Must honor signal and preserve the host ToolRegistry's own policy checks. */
  execute(input: unknown, context: { sessionId: string; callId: string; signal: AbortSignal }): Promise<unknown>
}

export interface PiSdkRuntimeConfig {
  /** Main-only flag; omission/false rejects before any SDK/resource loading. */
  enabled?: boolean
  ownerId: string
  cwd: string
  /** Main-selected composite model identity, not a renderer-supplied native ID. */
  model: string
  injection: PiProviderInjection
  systemPrompt?: string
  customTools?: readonly PiSdkHostTool[]
  toolAllowlist?: readonly string[]
  /** Optional existing canonical, main-owned execution-state root. */
  executionStateDir?: string
  /** Main-owned references only; loadSession checks the exact host history digest. */
  sessionReferences?: Readonly<Record<string, PiSdkSessionReference>>
  permissionTimeoutMs?: number
  turnTimeoutMs?: number
  maxToolCalls?: number
  /** Full-history SessionManager.forkFrom; not entry-based runtime.fork. */
  enableFork?: boolean
  /** Manual AgentSession.compact; automatic compaction/retry remain disabled. */
  enableCompaction?: boolean
}

type PendingApproval = {
  sessionId: string; callId: string; action: string; grant: string
  decide(decision: RuntimeApprovalInput['decision']): void
}
type Operation = {
  controller: AbortController
  events: RuntimeEvent[]
  bytes: number
  wake?: () => void
  done: boolean
  timedOut: boolean
  overflow: boolean
  calls: Set<string>
  task?: Promise<void>
}
type Entry = {
  session: RuntimeSession
  committed?: RuntimeMessage[]
  resume?: PiSdkSessionReference
  reference?: PiSdkSessionReference
  handle?: PiSdkSessionHandle
  opening?: Promise<PiSdkSessionHandle>
  active?: Operation
  grants: Set<string>
  invalid: boolean
}

const NATIVE_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'powershell', 'codemode', 'tool_search'])
function bounded(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Pi SDK limit is out of bounds')
  return value
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    }
    return item
  })
}
function secretDeltaFilter(secrets: readonly string[]) {
  let pending = ''
  return (delta: string, final = false): string => {
    pending += delta
    let cursor = 0
    let output = ''
    while (cursor < pending.length) {
      const match = secrets.find(secret => secret && pending.startsWith(secret, cursor))
      if (match) { output += '[REDACTED]'; cursor += match.length; continue }
      const remaining = pending.length - cursor
      if (!final && secrets.some(secret => secret.length > remaining && secret.startsWith(pending.slice(cursor)))) break
      output += pending[cursor++]
    }
    pending = pending.slice(cursor)
    return output
  }
}
function textHistory(messages: RuntimeMessage[]): RuntimeMessage[] {
  if (!Array.isArray(messages) || messages.length > 1024 || JSON.stringify(messages).length > 4 * 1024 * 1024) {
    throw new Error('Pi SDK host history limit exceeded')
  }
  return messages.map(message => {
    if (!['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' ||
      message.toolCalls?.length || message.toolCallId || message.name) {
      throw new Error('Pi SDK bounded adapter requires text history; native tool history must remain source-owned')
    }
    return { role: message.role, content: message.content }
  })
}

export class PiSdkRuntime implements AgentRuntime {
  readonly kind = 'pi' as const
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, PendingApproval>()
  private readonly config: Omit<PiSdkRuntimeConfig, 'injection' | 'customTools' | 'sessionReferences'>
  #injection?: PiProviderInjection
  private tools: PiSdkHostTool[]
  private references: Record<string, PiSdkSessionReference>
  private readonly fingerprint: string
  private readonly permissionTimeout: number
  private readonly turnTimeout: number
  private readonly maxToolCalls: number
  private closed = false
  private closePromise?: Promise<void>

  constructor(config: PiSdkRuntimeConfig) {
    if ((process as NodeJS.Process & { type?: string }).type === 'renderer') throw new Error('Pi SDK runtime is main-only')
    if (config.enabled !== true) throw new Error('Pi SDK runtime feature gate is disabled')
    if (!config.ownerId?.trim() || !config.cwd || !config.model?.trim() || !config.injection) {
      throw new Error('Pi SDK requires a main-owned owner, workspace and selected model injection')
    }
    if (config.injection.api === 'azure-openai-responses' || Object.keys(config.injection.requestEnvironment ?? {}).length) {
      throw new Error('Pi SDK requestEnvironment/Azure injection is not supported')
    }
    const allowlist = [...(config.toolAllowlist ?? [])]
    this.tools = [...(config.customTools ?? [])].map(tool => ({ ...tool }))
    if (new Set(allowlist).size !== allowlist.length || new Set(this.tools.map(tool => tool.name)).size !== this.tools.length ||
      allowlist.length !== this.tools.length || this.tools.some(tool =>
        !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(tool.name) || NATIVE_TOOLS.has(tool.name.toLowerCase()) ||
        !allowlist.includes(tool.name) || typeof tool.execute !== 'function' || (tool.parameters as unknown as { type?: string })?.type !== 'object')) {
      throw new Error('Pi SDK requires an exact custom tool allowlist; native tools are forbidden')
    }
    this.permissionTimeout = bounded(config.permissionTimeoutMs, 60_000, 300_000)
    this.turnTimeout = bounded(config.turnTimeoutMs, 120_000, 600_000)
    this.maxToolCalls = bounded(config.maxToolCalls, 32, 128)
    const { injection, customTools: _tools, sessionReferences, ...safeConfig } = config
    this.config = { ...safeConfig, cwd: realpathSync(config.cwd), toolAllowlist: allowlist }
    this.#injection = { ...injection, providerConfig: structuredClone(injection.providerConfig) }
    this.references = structuredClone(sessionReferences ?? {})
    // Only the digest is persisted. No key, headers, model config or prompt is
    // serialized into references. Credential rotation is not a session identity.
    this.fingerprint = piSdkDigest({
      sdk: '1.0.1', owner: config.ownerId, cwd: this.config.cwd, model: config.model,
      provider: injection.providerName, api: injection.api, providerConfig: injection.providerConfig,
      systemPrompt: config.systemPrompt ?? '',
      tools: this.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      boundary: 'no-external-resources;no-native-tools;exact-tool-input-grants-v1',
    })
  }

  getCapabilities(): RuntimeCapabilities {
    const result = {} as Record<RuntimeCapability, RuntimeCapabilities[RuntimeCapability]>
    const set = (name: RuntimeCapability, supported: boolean, reason: string) => {
      result[name] = { state: supported ? 'supported' : 'unavailable', reason }
    }
    set('streaming', true, 'Pi 1.0.1 AgentSession.subscribe; completion requires agent_settled and idle')
    set('session.resume', !!this.config.executionStateDir, 'Exact SessionManager.open with owner/config/header/checkpoint and host-history validation; opt-in execution state only')
    set('session.fork', !!this.config.executionStateDir && this.config.enableFork === true, 'Opt-in full-history SessionManager.forkFrom creates a new local/native identity; entry-based fork is not exposed')
    for (const name of ['permission.once', 'permission.deny', 'permission.session'] as const) {
      set(name, this.tools.length > 0, 'Host custom-tool boundary only; grants are local-session + exact tool + exact validated input, never native approval')
    }
    set('native.tools', false, 'All native tools are suppressed; only constructor-allowlisted host custom tools exist')
    set('compaction', this.config.enableCompaction === true, 'Opt-in compactSession calls public AgentSession.compact; no automatic compaction or fabricated recovery')
    set('event.replay', false, 'AgentSession.subscribe has no public durable event cursor')
    set('recovery', false, 'No durable recovery contract; interrupted/unsettled execution cannot be resumed from a stale checkpoint')
    set('process.lease', false, 'In-process ESM SDK; no subprocess or shared-process lease')
    return result
  }

  createSession(model: string, messages: RuntimeMessage[] = []): RuntimeSession {
    this.assertOpen()
    if (model !== this.config.model) throw new Error('Pi SDK selected model mismatch')
    const session: RuntimeSession = {
      id: randomUUID(), runtime: 'pi', model, messages: textHistory(messages), createdAt: new Date().toISOString(),
    }
    this.add(session)
    return structuredClone(session)
  }

  loadSession(session: RuntimeSession): void {
    this.assertOpen()
    if (!session.id || session.runtime !== 'pi' || session.model !== this.config.model || this.entries.has(session.id)) {
      throw new Error('Pi SDK invalid or duplicate local session')
    }
    const messages = textHistory(session.messages)
    const reference = this.references[session.id]
    if (!reference || reference.ownerId !== this.config.ownerId || reference.localSessionId !== session.id ||
      reference.configFingerprint !== this.fingerprint || reference.historyDigest !== piSdkDigest(messages)) {
      throw new Error('Pi SDK resume requires a main-owned matching native reference and host history')
    }
    const entry = this.add({ ...session, messages })
    entry.committed = messages
    entry.resume = reference
  }

  private add(session: RuntimeSession): Entry {
    const entry: Entry = { session: structuredClone(session), grants: new Set(), invalid: false }
    this.entries.set(session.id, entry)
    return entry
  }

  getNativeSessionReference(sessionId: string): PiSdkSessionReference | undefined {
    const ref = this.entries.get(sessionId)?.reference
    return ref ? structuredClone(ref) : undefined
  }

  getSessionReference(sessionId: string): string | undefined {
    const ref = this.getNativeSessionReference(sessionId)
    return ref ? JSON.stringify(ref) : undefined
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Pi SDK runtime is closed')
  }

  private emit(op: Operation, event: RuntimeEvent): void {
    if (op.done) return
    const safe = this.sanitize(event)
    const size = JSON.stringify(safe).length
    if (op.events.length >= 2048 || op.bytes + size > 2 * 1024 * 1024) {
      op.overflow = true
      op.controller.abort()
      if (!['failed', 'cancelled'].includes(event.type)) return
      // A bounded buffer failure must still deliver its terminal outcome.
      op.events = []
      op.bytes = 0
    }
    op.events.push(safe)
    op.bytes += size
    op.wake?.()
  }

  private sanitize<T>(value: T): T {
    const secrets = [this.#injection?.apiKey, ...Object.values(this.#injection?.providerConfig.headers ?? {})]
      .filter((secret): secret is string => typeof secret === 'string' && secret.length > 0)
    return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item !== 'string') return item
      for (const secret of secrets) item = (item as string).replaceAll(secret, '[REDACTED]')
      return item
    })) as T
  }

  private async open(entry: Entry, forkFrom?: PiSdkSessionReference): Promise<PiSdkSessionHandle> {
    if (entry.handle) return entry.handle
    if (!entry.opening) {
      if (!this.#injection) throw new Error('Pi SDK runtime is closed')
      entry.opening = createPiSdkSession({
        ownerId: this.config.ownerId, localSessionId: entry.session.id, cwd: this.config.cwd,
        configFingerprint: this.fingerprint, injection: this.#injection,
        systemPrompt: this.config.systemPrompt ?? '', executionStateDir: this.config.executionStateDir,
        reference: entry.resume, forkFrom,
        customTools: this.tools.map(tool => ({
          name: tool.name, label: tool.name, description: tool.description,
          parameters: tool.parameters, executionMode: 'sequential',
          execute: async (callId, input, signal) => {
            const op = entry.active
            if (!op || op.controller.signal.aborted || signal?.aborted || op.calls.has(callId) || op.calls.size >= this.maxToolCalls) {
              throw new Error('Pi SDK tool call is cancelled, duplicate or exceeds the turn limit')
            }
            op.calls.add(callId)
            const linked = signal ? AbortSignal.any([signal, op.controller.signal]) : op.controller.signal
            const args: unknown = structuredClone(input)
            if (!await this.authorize(entry, op, tool.name, callId, args, linked)) throw new Error('Host tool permission denied')
            linked.throwIfAborted()
            let onAbort: (() => void) | undefined
            try {
              const aborted = new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(new Error('Host tool cancelled'))
                linked.addEventListener('abort', onAbort, { once: true })
              })
              // Host callbacks must still honor signal. Racing only bounds the SDK
              // wait; it does not claim to undo an uncooperative host side effect.
              const output = await Promise.race([
                tool.execute(structuredClone(args), { sessionId: entry.session.id, callId, signal: linked }), aborted,
              ])
              linked.throwIfAborted()
              const safe = this.sanitize(output ?? null)
              const text = typeof safe === 'string' ? safe : JSON.stringify(safe)
              if (text.length > 256 * 1024) throw new Error('Host tool output limit exceeded')
              return { content: [{ type: 'text', text }], details: undefined }
            } catch {
              throw new Error(linked.aborted ? 'Host tool cancelled' : 'Host tool execution failed')
            } finally {
              if (onAbort) linked.removeEventListener('abort', onAbort)
            }
          },
        })),
      })
    }
    entry.handle = await entry.opening
    if (this.closed) {
      await entry.handle.dispose()
      throw new Error('Pi SDK runtime closed during session setup')
    }
    return entry.handle
  }

  private authorize(entry: Entry, op: Operation, action: string, callId: string, input: unknown, signal: AbortSignal): Promise<boolean> {
    const grant = piSdkDigest([action, canonical(input)])
    if (entry.grants.has(grant)) return Promise.resolve(!signal.aborted)
    const requestId = randomUUID()
    return new Promise(resolve => {
      let finished = false
      const finish = (decision: RuntimeApprovalInput['decision']) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        this.pending.delete(requestId)
        const effective = signal.aborted ? 'decline' : decision
        if (effective === 'acceptForSession') entry.grants.add(grant)
        this.emit(op, { type: 'permission-resolved', requestId, decision: effective,
          detail: { sessionId: entry.session.id, toolCallId: callId, action } })
        resolve(effective !== 'decline')
      }
      const onAbort = () => finish('decline')
      const timeout = setTimeout(() => finish('decline'), this.permissionTimeout)
      this.pending.set(requestId, { sessionId: entry.session.id, callId, action, grant, decide: finish })
      signal.addEventListener('abort', onAbort, { once: true })
      this.emit(op, { type: 'permission-requested', requestId, action,
        detail: { sessionId: entry.session.id, toolCallId: callId, input, scope: 'exact-tool-and-input' } })
      if (signal.aborted) onAbort()
    })
  }

  async approve(input: RuntimeApprovalInput): Promise<void> {
    const pending = this.pending.get(input.requestId)
    if (this.closed || !pending || !input.sessionId || input.sessionId !== pending.sessionId ||
      (input.callId !== undefined && input.callId !== pending.callId) ||
      (input.action !== undefined && input.action !== pending.action) ||
      !['accept', 'acceptForSession', 'decline'].includes(input.decision)) {
      throw new Error('Pi SDK unknown, stale or mismatched permission decision')
    }
    pending.decide(input.decision)
  }

  async reject(input: RuntimeApprovalInput): Promise<void> {
    await this.approve({ ...input, decision: 'decline' })
  }

  async *send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent> {
    const entry = this.entries.get(input.sessionId)
    if (this.closed || !entry || entry.invalid || entry.active || input.model !== this.config.model) {
      yield { type: 'failed', error: 'Pi SDK session is unavailable, busy, invalidated or has a different model' }
      return
    }
    let messages: RuntimeMessage[]
    try {
      if (input.tools?.length) throw new Error('Pi SDK prompt-supplied tools are disabled; use the main custom tool allowlist')
      messages = textHistory(input.messages)
      const newest = messages.at(-1)
      const systems = messages.filter(message => message.role === 'system')
      if (!newest || newest.role !== 'user' || !(newest.content as string).trim() ||
        systems.map(message => message.content).join('\n\n') !== (this.config.systemPrompt ?? '') ||
        systems.some((message, index) => messages[index] !== message)) throw new Error('Pi SDK requires a final text user prompt and the configured system prompt')
      const prefix = messages.slice(0, -1)
      if (entry.committed ? canonical(prefix) !== canonical(entry.committed) : prefix.some(message => message.role !== 'system')) {
        throw new Error('Pi SDK history mismatch; resume requires a native checkpoint, not lossy RuntimeMessage replay')
      }
    } catch (error) {
      yield { type: 'failed', error: error instanceof Error ? error.message : 'Pi SDK invalid prompt' }
      return
    }
    const op: Operation = {
      controller: new AbortController(), events: [], bytes: 0, done: false,
      timedOut: false, overflow: false, calls: new Set(),
    }
    entry.active = op
    entry.reference = undefined
    op.task = this.run(entry, messages, op)
    try {
      while (!op.done || op.events.length) {
        const event = op.events.shift()
        if (event) {
          op.bytes -= JSON.stringify(event).length
          yield event
        } else if (!op.done) {
          await new Promise<void>(resolve => { op.wake = resolve })
          op.wake = undefined
        }
      }
      await op.task
    } finally {
      if (!op.done) {
        op.controller.abort()
        await entry.handle?.runtime.session.abort()
      }
      await op.task
    }
  }

  private async run(entry: Entry, messages: RuntimeMessage[], op: Operation): Promise<void> {
    let unsubscribe: (() => void) | undefined
    let text = ''
    let settled = false
    let sourceFailure = false
    let sourceAbort = false
    const secrets = [this.#injection?.apiKey, ...Object.values(this.#injection?.providerConfig.headers ?? {})]
      .filter((secret): secret is string => typeof secret === 'string' && secret.length > 0)
    const safeTextDelta = secretDeltaFilter(secrets)
    const safeReasoningDelta = secretDeltaFilter(secrets)
    const timer = setTimeout(() => { op.timedOut = true; op.controller.abort() }, this.turnTimeout)
    const onAbort = () => { void entry.handle?.runtime.session.abort().catch(() => undefined) }
    op.controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      this.emit(op, { type: 'session-started', sessionId: entry.session.id })
      const handle = await this.open(entry)
      op.controller.signal.throwIfAborted()
      unsubscribe = handle.runtime.session.subscribe((event: AgentSessionEvent) => {
        switch (event.type) {
          case 'message_update': {
            const update = event.assistantMessageEvent
            if (update.type === 'text_delta') {
              text += update.delta
              if (text.length > 2 * 1024 * 1024) { op.overflow = true; op.controller.abort(); break }
              const delta = safeTextDelta(update.delta)
              if (delta) this.emit(op, { type: 'text-delta', text: delta })
            } else if (update.type === 'thinking_delta') {
              const delta = safeReasoningDelta(update.delta)
              if (delta) this.emit(op, { type: 'reasoning-delta', text: delta })
            }
            break
          }
          case 'message_end': {
            if (event.message.role !== 'assistant') break
            sourceFailure ||= event.message.stopReason === 'error'
            sourceAbort ||= event.message.stopReason === 'aborted'
            const usage = event.message.usage
            // Pi initializes empty failure usage to zero; do not report that as
            // known provider accounting. No fabricated costs are emitted.
            if (usage && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) {
              this.emit(op, { type: 'usage', inputTokens: usage.input, outputTokens: usage.output, cachedTokens: usage.cacheRead })
            }
            break
          }
          case 'tool_execution_start':
            this.emit(op, { type: 'tool-started', ownership: 'runtime', callId: event.toolCallId, name: event.toolName, input: event.args })
            break
          case 'tool_execution_update':
            this.emit(op, { type: 'tool-progress', ownership: 'runtime', callId: event.toolCallId, name: event.toolName, output: event.partialResult })
            break
          case 'tool_execution_end':
            this.emit(op, { type: 'tool-finished', ownership: 'runtime', callId: event.toolCallId,
              ...(event.isError ? { error: 'Pi SDK custom tool failed or was denied' } : { output: event.result }) })
            break
          case 'agent_settled': {
            const textRemainder = safeTextDelta('', true)
            const reasoningRemainder = safeReasoningDelta('', true)
            if (textRemainder) this.emit(op, { type: 'text-delta', text: textRemainder })
            if (reasoningRemainder) this.emit(op, { type: 'reasoning-delta', text: reasoningRemainder })
            settled = true
            break
          }
        }
      })
      await handle.runtime.session.prompt(messages.at(-1)!.content as string, { expandPromptTemplates: false })
      await handle.runtime.session.waitForIdle()
      if (op.timedOut || op.overflow) throw new Error('Pi SDK turn limit exceeded')
      if (op.controller.signal.aborted || sourceAbort) {
        entry.invalid = true
        this.emit(op, { type: 'cancelled', reason: 'Pi SDK turn interrupted' })
      } else if (sourceFailure || !settled) {
        throw new Error('Pi SDK model failed or ended without agent_settled')
      } else {
        const safeText = this.sanitize(text)
        entry.committed = [...messages, { role: 'assistant', content: safeText }]
        entry.session.messages = structuredClone(entry.committed)
        entry.reference = handle.checkpoint(piSdkDigest(entry.committed))
        this.emit(op, { type: 'completed', text: safeText, toolOwnership: 'runtime' })
      }
    } catch {
      entry.invalid = true
      this.emit(op, !op.timedOut && !op.overflow && op.controller.signal.aborted
        ? { type: 'cancelled', reason: 'Pi SDK turn interrupted' }
        : { type: 'failed', error: op.timedOut ? 'Pi SDK turn timed out' : op.overflow ? 'Pi SDK event buffer limit exceeded' : 'Pi SDK request failed or native execution state was rejected' })
    } finally {
      clearTimeout(timer)
      op.controller.signal.removeEventListener('abort', onAbort)
      unsubscribe?.()
      op.done = true
      if (entry.active === op) entry.active = undefined
      op.wake?.()
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry?.active) return
    entry.active.controller.abort()
    await entry.handle?.runtime.session.abort()
    await entry.active?.task
  }

  /** Full history, exact public SessionManager.forkFrom semantics. Parent stays live. */
  async forkSession(parentSessionId: string): Promise<RuntimeSession> {
    this.assertOpen()
    if (this.config.enableFork !== true || !this.config.executionStateDir) throw new Error('Pi SDK native full-history fork feature gate is disabled')
    const parent = this.entries.get(parentSessionId)
    if (!parent?.handle || parent.active || parent.invalid || !parent.reference || !parent.committed) throw new Error('Pi SDK fork requires an idle checkpointed parent')
    const session = this.createSession(this.config.model, parent.committed)
    const child = this.entries.get(session.id)!
    child.committed = structuredClone(parent.committed)
    try {
      const handle = await this.open(child, parent.reference)
      child.reference = handle.checkpoint(piSdkDigest(child.committed))
      return structuredClone(child.session)
    } catch (error) {
      await child.handle?.dispose()
      this.entries.delete(child.session.id)
      throw error
    }
  }

  /** Manual compaction, not a user turn. Emits only source compaction outcomes. */
  async *compactSession(sessionId: string, instructions?: string): AsyncGenerator<RuntimeEvent> {
    this.assertOpen()
    if (this.config.enableCompaction !== true) throw new Error('Pi SDK manual compaction feature gate is disabled')
    const entry = this.entries.get(sessionId)
    if (!entry?.handle || entry.active || entry.invalid || !entry.committed) throw new Error('Pi SDK compaction requires an idle live session')
    const op: Operation = { controller: new AbortController(), events: [], bytes: 0, done: false, timedOut: false, overflow: false, calls: new Set() }
    entry.active = op
    entry.reference = undefined
    const session = entry.handle.runtime.session
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'compaction_start') this.emit(op, { type: 'compaction-started', detail: { reason: event.reason } })
      if (event.type === 'compaction_end' && event.result && !event.aborted && !event.errorMessage) {
        this.emit(op, { type: 'compaction-finished', detail: { tokensBefore: event.result.tokensBefore } })
      }
    })
    const onAbort = () => session.abortCompaction()
    op.controller.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { op.timedOut = true; op.controller.abort() }, this.turnTimeout)
    op.task = (async () => {
      try {
        await session.compact(instructions)
        if (op.controller.signal.aborted) throw new Error('Compaction interrupted')
        entry.reference = entry.handle!.checkpoint(piSdkDigest(entry.committed))
      } catch {
        entry.invalid = true
        this.emit(op, { type: op.controller.signal.aborted && !op.timedOut ? 'cancelled' : 'failed',
          ...(op.controller.signal.aborted && !op.timedOut ? { reason: 'Pi SDK compaction interrupted' } : { error: 'Pi SDK manual compaction failed' }) } as RuntimeEvent)
      } finally {
        clearTimeout(timer)
        unsubscribe()
        op.controller.signal.removeEventListener('abort', onAbort)
        op.done = true
        if (entry.active === op) entry.active = undefined
        op.wake?.()
      }
    })()
    try {
      while (!op.done || op.events.length) {
        const event = op.events.shift()
        if (event) { op.bytes -= JSON.stringify(event).length; yield event }
        else if (!op.done) { await new Promise<void>(resolve => { op.wake = resolve }); op.wake = undefined }
      }
      await op.task
    } finally {
      if (!op.done) op.controller.abort()
      await op.task
    }
  }

  async listTools(): Promise<unknown[]> {
    this.assertOpen()
    return this.tools.map(({ name, description, parameters }) => ({ name, description, parameters: JSON.parse(JSON.stringify(parameters)) }))
  }

  close(): Promise<void> {
    return this.closePromise ??= (async () => {
      this.closed = true
      const entries = [...this.entries.values()]
      for (const entry of entries) entry.active?.controller.abort()
      for (const approval of this.pending.values()) approval.decide('decline')
      try {
        const results = await Promise.allSettled(entries.map(async entry => {
          const handle = entry.handle ?? await entry.opening?.catch(() => undefined)
          try {
            await handle?.runtime.session.abort()
            await entry.active?.task
          } finally {
            await handle?.dispose()
          }
        }))
        if (results.some(result => result.status === 'rejected')) throw new Error('Pi SDK runtime cleanup failed')
      } finally {
        this.entries.clear()
        this.pending.clear()
        this.references = {}
        this.tools = []
        this.#injection = undefined
      }
    })()
  }
}
