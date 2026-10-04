import type { AgentRuntime, AgentRuntimeKind, RuntimeFactory } from "./types"
import { OpenAICompatibleRuntime } from './openai-compatible.runtime'
import { CodexRuntime, OpenCodeRuntime, PiRuntime } from './adapters'

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

export function registerBuiltInAgentRuntimes() {
  registerAgentRuntime('openai-compatible', config => new OpenAICompatibleRuntime({ baseUrl: String(config?.baseUrl || ''), apiKey: String(config?.apiKey || '') }))
  registerAgentRuntime('codex', config => new CodexRuntime({ endpoint: String(config?.endpoint || 'http://127.0.0.1:17371'), token: String(config?.token || '') }))
  registerAgentRuntime('opencode', config => new OpenCodeRuntime({ endpoint: String(config?.endpoint || 'http://127.0.0.1:4096'), token: String(config?.token || '') }))
  registerAgentRuntime('pi', config => new PiRuntime(String(config?.command || 'pi'), Array.isArray(config?.args) ? config?.args.map(String) : []))
}
