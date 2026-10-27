import type { AgentBlueprintModelId } from '../../shared/agent-blueprint-types'

/**
 * Checked adapter for Cherry 2.1.4 shared/data/api/schemas/agents.ts and types/model.ts.
 * Direct import is not main-build safe: agents pulls jobs/workspaces plus model's runtime
 * @cherrystudio/provider-registry and aiSdk closure, using source-only aliases; root has no
 * zod dependency. Do not import the source application/ORM just to validate persistence.
 * Unknown configuration keys are retained, not reduced to a UI settings subset.
 */
export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`AGENT_BLUEPRINT_INVALID: ${field} must be an object`)
  }
  return value as Record<string, unknown>
}
export function string(value: unknown, field: string, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.length)) throw new Error(`AGENT_BLUEPRINT_INVALID: ${field} must be a string${nonempty ? ' (nonempty)' : ''}`)
}
export function model(value: unknown, nullable = false): asserts value is AgentBlueprintModelId | null {
  if (nullable && value === null) return
  // Source splits on the FIRST ::; further separators in modelId are valid.
  const index = typeof value === 'string' ? value.indexOf('::') : -1
  if (typeof value !== 'string' || index <= 0 || !value.slice(index + 2).length || /[?#]/.test(value.slice(index + 2))) {
    throw new Error('AGENT_BLUEPRINT_INVALID_MODEL: expected providerId::modelId')
  }
}
export function strings(value: unknown, field: string, nonempty = false): string[] {
  if (!Array.isArray(value)) throw new Error(`AGENT_BLUEPRINT_INVALID: ${field} must be an array`)
  value.forEach(item => string(item, field, nonempty))
  return [...new Set(value as string[])]
}
export function enumValue(value: unknown, choices: readonly unknown[], field: string): void {
  if (!choices.includes(value)) throw new Error(`AGENT_BLUEPRINT_INVALID: ${field}`)
}
export const runtimes = ['openai-compatible', 'anthropic', 'google', 'codex', 'opencode', 'pi'] as const
export const sourceTypes = ['claude-code', 'pi', 'dsh', null] as const

function jsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || !value || ancestors.has(value)) throw new Error('AGENT_BLUEPRINT_INVALID: configuration must be lossless JSON')
  ancestors.add(value)
  if (!Array.isArray(value)) object(value, 'configuration value')
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('AGENT_BLUEPRINT_INVALID: unsafe configuration key')
    if (key === 'env_vars') throw new Error('AGENT_BLUEPRINT_SECRET_WRITE_UNSUPPORTED: secure env_vars projection is not implemented')
    jsonValue(item, ancestors)
  }
  ancestors.delete(value)
}
export function configuration(value: unknown): Record<string, unknown> {
  const raw = object(value, 'configuration')
  if (Object.hasOwn(raw, 'builtin_role')) throw new Error('AGENT_BLUEPRINT_RESERVED: builtin_role is main-owned')
  if (Object.hasOwn(raw, 'env_vars')) throw new Error('AGENT_BLUEPRINT_SECRET_WRITE_UNSUPPORTED: secure env_vars projection is not implemented')
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(raw)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('AGENT_BLUEPRINT_INVALID: unsafe configuration key')
    if (item === undefined) { result[key] = undefined; continue }
    if (['avatar', 'scheduler_cron', 'scheduler_last_run'].includes(key)) string(item, key)
    if (key === 'slash_commands') strings(item, key)
    if (['bootstrap_completed', 'scheduler_enabled', 'heartbeat_enabled'].includes(key) && typeof item !== 'boolean') throw new Error(`AGENT_BLUEPRINT_INVALID: ${key}`)
    if (['scheduler_interval', 'scheduler_one_time_delay', 'heartbeat_interval'].includes(key) && (typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`AGENT_BLUEPRINT_INVALID: ${key}`)
    if (key === 'permission_mode') enumValue(item, ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'], key)
    if (key === 'reasoning_effort') enumValue(item, ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'auto'], key)
    if (key === 'service_tier') enumValue(item, ['standard', 'auto', 'fast', 'flex'], key)
    if (key === 'scheduler_type') enumValue(item, ['cron', 'interval', 'one-time'], key)
    let normalized = item
    if (key === 'language' && item !== null) {
      string(item, key)
      normalized = item.trim()
      if (!(normalized as string).length || (normalized as string).length > 50 || [...(normalized as string)].some(char => char === String.fromCharCode(10) || char === String.fromCharCode(13) || char === String.fromCharCode(0x2028) || char === String.fromCharCode(0x2029))) throw new Error('AGENT_BLUEPRINT_INVALID: language')
    }
    jsonValue(normalized)
    result[key] = normalized
  }
  return result
}

/** No stored env map may escape through read DTOs, including imported/older blobs. */
export function readConfiguration(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'env_vars' && key !== 'builtin_role').map(([key, item]) => [key, readSafeValue(item)]))
}
function readSafeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(readSafeValue)
  if (value && typeof value === 'object') return readConfiguration(value)
  return value
}
