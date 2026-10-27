export type AgentRuntimeKind = "openai-compatible" | "anthropic" | "google" | "codex" | "opencode" | "pi"
export type RuntimeProviderProtocol = "chat_completions" | "responses"

export type RuntimeCapability =
  | "streaming"
  | "session.resume"
  | "session.fork"
  | "event.replay"
  | "permission.once"
  | "permission.deny"
  | "permission.session"
  | "native.tools"
  | "compaction"
  | "recovery"
  | "process.lease"

export type RuntimeCapabilityState = "supported" | "unavailable" | "blocked" | "not-implemented"

export type RuntimeCapabilityStatus = {
  state: RuntimeCapabilityState
  reason: string
  unblock?: string
}

export type RuntimeCapabilities = Readonly<Record<RuntimeCapability, RuntimeCapabilityStatus>>

export const runtimeCapabilityKeys: readonly RuntimeCapability[] = [
  'streaming', 'session.resume', 'session.fork', 'event.replay',
  'permission.once', 'permission.deny', 'permission.session',
  'native.tools', 'compaction', 'recovery', 'process.lease',
]

export type RuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | unknown[]
  name?: string
  toolCallId?: string
  toolCalls?: RuntimeToolCall[]
}

export type RuntimeToolCall = {
  callId: string
  name: string
  input: unknown
}

/** Telemetry is never an execution request. Only an explicitly host-owned
 * completed.toolCalls batch may be executed by Grimoire's ToolRegistry.
 * Pi/OpenCode execute native tools themselves; this does not imply a Pi RPC
 * permission bridge (none is proven) or recovery support.
 */
export type RuntimeToolOwnership = "host" | "runtime"

export type RuntimeEvent =
  | { type: "session-started"; sessionId: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-started"; ownership?: RuntimeToolOwnership; callId: string; name: string; input?: unknown }
  | { type: "tool-progress"; ownership?: RuntimeToolOwnership; callId: string; name?: string; status?: string; output?: unknown; error?: string }
  | { type: "tool-finished"; ownership?: RuntimeToolOwnership; callId: string; output?: unknown; error?: string }
  | { type: "agent-status"; status: string; detail?: unknown }
  | { type: "mcp"; serverId: string; tool: string; payload?: unknown; error?: string }
  | { type: "permission-requested"; requestId: string; action: string; detail?: unknown }
  | { type: "permission-resolved"; requestId: string; decision: string; detail?: unknown }
  | { type: "compaction-started"; detail?: unknown }
  | { type: "compaction-finished"; detail?: unknown }
  /**
   * Token accounting for one model call, emitted when the provider reports it.
   *
   * Normalized across the two wire shapes this runtime speaks, because they differ: Chat
   * Completions puts a `usage` object on the final chunk, while the Responses API reports
   * counts inside `response.completed`. Both are mapped to these three fields rather than
   * passing the provider payload through, so a consumer never branches on provider name
   * (the project's rule that UI must not decide behaviour by runtime name).
   *
   * `cachedTokens` is separate from `inputTokens` because the source's usage UI reports
   * cache hit rate, and providers that do not report it emit no value rather than 0 — a
   * fabricated 0 would read as "cache never used".
   */
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cachedTokens?: number }
  /**
   * The call was cancelled by the user, as distinct from `failed`.
   *
   * Separating them matters because the UI shows an error for `failed` and nothing for a
   * cancellation the user asked for — reporting an abort as a failure would blame the user
   * for their own action.
   */
  | { type: "cancelled"; reason?: string }
  | { type: "completed"; text: string; toolCalls?: RuntimeToolCall[]; toolOwnership?: RuntimeToolOwnership }
  | { type: "failed"; error: string }
  /**
   * NOT EMITTED BY ANY RUNTIME YET — declared for the adapter contract, not implemented.
   *
   * Verified by search: no runtime, adapter or integration constructs this event, so the IPC
   * layer's `recovery` branch is currently unreachable. It is kept (rather than deleted)
   * because the Pi/OpenCode adapters are expected to report recovery phases and removing the
   * variant would make that an interface change rather than an addition.
   *
   * The matrix records this as NOT_IMPLEMENTED, not as a supported state: a UI that renders a
   * recovery affordance today would be waiting for an event that never fires.
   */
  | { type: "recovery"; phase: "started" | "finished"; detail?: unknown }

export type RuntimeSession = {
  id: string
  runtime: AgentRuntimeKind
  model: string
  createdAt: string
  messages: RuntimeMessage[]
}

export type RuntimeSendInput = {
  sessionId: string
  model: string
  messages: RuntimeMessage[]
  tools?: unknown[]
}

export type RuntimeApprovalInput = {
  requestId: string
  decision: 'accept' | 'acceptForSession' | 'decline'
  /** Local runtime session identity; main IPC supplies this to prevent cross-session replies. */
  sessionId?: string
  /** Optional native call/action provenance used for stale-call rejection and audit. */
  callId?: string
  action?: string
}

export interface AgentRuntime {
  readonly kind: AgentRuntimeKind
  createSession(model: string, messages?: RuntimeMessage[]): RuntimeSession
  loadSession?(session: RuntimeSession): void
  /** Main-owned native/remote session identity for persistence and recovery. */
  getSessionReference?(sessionId: string): string | undefined
  getCapabilities?(): RuntimeCapabilities
  send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown>
  interrupt?(sessionId: string): Promise<void>
  approve?(input: RuntimeApprovalInput): Promise<void>
  reject?(input: RuntimeApprovalInput): Promise<void>
  listTools?(): Promise<unknown[]>
  close?(): Promise<void>
}

export type RuntimeFactory = (config?: Record<string, unknown>) => AgentRuntime
