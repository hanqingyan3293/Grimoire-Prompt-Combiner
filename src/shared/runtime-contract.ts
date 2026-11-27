/**
 * UI-facing runtime selection metadata. The main process owns this projection so
 * renderers never branch on a concrete runtime name to decide provider/model UI.
 */
export type RuntimeSelectionContract = {
  provider: 'grimoire' | 'runtime'
  model: 'catalog' | 'freeform'
}

export const DEFAULT_RUNTIME_SELECTION: RuntimeSelectionContract = Object.freeze({ provider: 'grimoire', model: 'catalog' })

export function runtimeUsesGrimoireProvider(contract?: RuntimeSelectionContract | null): boolean {
  return contract?.provider === 'grimoire'
}

export function runtimeUsesFreeformModel(contract?: RuntimeSelectionContract | null): boolean {
  return contract?.model === 'freeform'
}

export type RuntimeSelectionValue = {
  providerId: string
  model: string
}

export type RuntimeModelMemory = Readonly<Record<string, string>>

/**
 * Resolve the model a send/create call may use.
 *
 * A runtime-owned contract owns both provider and model, so the active
 * Grimoire provider default is never a valid fallback there. Missing contract
 * metadata is treated as unknown and also refuses that fallback.
 */
export function runtimeModelFallback(input: {
  contract?: RuntimeSelectionContract | null
  explicitModel?: string
  sessionModel?: string
  providerDefaultModel?: string
}): string {
  const explicit = input.explicitModel?.trim()
  if (explicit) return explicit
  const session = input.sessionModel?.trim()
  if (session) return session
  return runtimeUsesGrimoireProvider(input.contract) ? (input.providerDefaultModel?.trim() || '') : ''
}

export type RuntimeSelectionTransitionInput = {
  fromRuntime: string
  toRuntime: string
  contract: RuntimeSelectionContract
  current: RuntimeSelectionValue
  activeProviderId?: string
  providerDefaultModel?: string
  providerModels?: readonly string[]
  memory?: RuntimeModelMemory
}

export type RuntimeSelectionTransition = {
  selection: RuntimeSelectionValue
  memory: RuntimeModelMemory
}

/**
 * Runtime changes are not model changes. Keep a model only when it belongs to
 * the target runtime/provider; a runtime-owned contract also drops the
 * Grimoire provider selection. The previous model is remembered per runtime so
 * switching back restores a still-advertised model.
 */
export function transitionRuntimeSelection(input: RuntimeSelectionTransitionInput): RuntimeSelectionTransition {
  const memory: Record<string, string> = { ...(input.memory || {}) }
  const currentModel = input.current.model.trim()
  if (currentModel) memory[input.fromRuntime] = currentModel
  if (input.fromRuntime === input.toRuntime) {
    return { selection: { providerId: input.current.providerId, model: input.current.model }, memory }
  }

  if (!runtimeUsesGrimoireProvider(input.contract)) {
    const remembered = (memory[input.toRuntime] || '').trim()
    if (remembered) return { selection: { providerId: '', model: remembered }, memory }
    return { selection: { providerId: '', model: '' }, memory }
  }

  const providerId = input.current.providerId?.trim() || input.activeProviderId?.trim() || ''
  const fallback = input.providerDefaultModel?.trim() || ''
  const remembered = (memory[input.toRuntime] || '').trim()
  const advertised = new Set([...(input.providerModels || []), fallback].filter(Boolean))
  const model = remembered && advertised.has(remembered) ? remembered : fallback
  return { selection: { providerId, model }, memory }
}
