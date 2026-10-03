export type AgentRuntimeKind = "openai-compatible" | "codex" | "opencode" | "pi"

export type RuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | unknown[]
}

export type RuntimeEvent =
  | { type: "session-started"; sessionId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-started"; callId: string; name: string; input?: unknown }
  | { type: "tool-finished"; callId: string; output?: unknown; error?: string }
  | { type: "permission-requested"; requestId: string; action: string; detail?: unknown }
  | { type: "completed"; text: string }
  | { type: "failed"; error: string }

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

export interface AgentRuntime {
  readonly kind: AgentRuntimeKind
  createSession(model: string, messages?: RuntimeMessage[]): RuntimeSession
  send(input: RuntimeSendInput): AsyncGenerator<RuntimeEvent, void, unknown>
  interrupt?(sessionId: string): Promise<void>
  close?(): Promise<void>
}

export type RuntimeFactory = (config?: Record<string, unknown>) => AgentRuntime
