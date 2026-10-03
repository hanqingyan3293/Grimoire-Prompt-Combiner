import type { AgentRuntime, AgentRuntimeKind, RuntimeFactory } from "./types"

const factories = new Map<AgentRuntimeKind, RuntimeFactory>()

export function registerAgentRuntime(kind: AgentRuntimeKind, factory: RuntimeFactory) {
  factories.set(kind, factory)
}

export function hasAgentRuntime(kind: AgentRuntimeKind) {
  return factories.has(kind)
}

export function createAgentRuntime(kind: AgentRuntimeKind, config: Record<string, unknown> = {}): AgentRuntime {
  const factory = factories.get(kind)
  if (!factory) throw new Error("Agent Runtime 未注册：" + kind)
  return factory(config)
}

export function listAgentRuntimes() {
  return Array.from(factories.keys())
}
