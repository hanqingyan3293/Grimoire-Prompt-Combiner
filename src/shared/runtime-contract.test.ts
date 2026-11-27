import { describe, expect, it } from 'vitest'
import {
  runtimeModelFallback,
  runtimeUsesFreeformModel,
  runtimeUsesGrimoireProvider,
  transitionRuntimeSelection,
  type RuntimeSelectionContract,
} from './runtime-contract'

const providerContract: RuntimeSelectionContract = { provider: 'grimoire', model: 'catalog' }
const runtimeContract: RuntimeSelectionContract = { provider: 'runtime', model: 'freeform' }

describe('runtime selection contract', () => {
  it('falls back to the active provider default only for a Grimoire-provider runtime', () => {
    expect(runtimeModelFallback({ contract: providerContract, providerDefaultModel: 'provider-default' })).toBe('provider-default')
    expect(runtimeModelFallback({ contract: runtimeContract, providerDefaultModel: 'provider-default' })).toBe('')
    expect(runtimeModelFallback({ contract: undefined, providerDefaultModel: 'provider-default' })).toBe('')
  })

  it('keeps an explicit or session model ahead of the provider default', () => {
    expect(runtimeModelFallback({ contract: providerContract, explicitModel: 'explicit', sessionModel: 'session', providerDefaultModel: 'provider-default' })).toBe('explicit')
    expect(runtimeModelFallback({ contract: providerContract, sessionModel: 'session', providerDefaultModel: 'provider-default' })).toBe('session')
    expect(runtimeModelFallback({ contract: runtimeContract, explicitModel: 'local-model', providerDefaultModel: 'provider-default' })).toBe('local-model')
  })

  it('reads provider/model ownership from the contract, never from a runtime name', () => {
    expect(runtimeUsesGrimoireProvider(providerContract)).toBe(true)
    expect(runtimeUsesFreeformModel(providerContract)).toBe(false)
    expect(runtimeUsesGrimoireProvider(runtimeContract)).toBe(false)
    expect(runtimeUsesFreeformModel(runtimeContract)).toBe(true)
  })

  it('clears the incompatible provider/model when switching to a runtime-owned contract', () => {
    const transition = transitionRuntimeSelection({
      fromRuntime: 'openai-compatible',
      toRuntime: 'pi',
      contract: runtimeContract,
      current: { providerId: 'provider', model: 'provider-model' },
      activeProviderId: 'provider',
      providerDefaultModel: 'provider-default',
      providerModels: ['provider-model'],
      memory: {},
    })
    expect(transition.selection).toEqual({ providerId: '', model: '' })
    expect(transition.memory['openai-compatible']).toBe('provider-model')
  })

  it('restores the remembered model when returning to a valid provider runtime', () => {
    const transition = transitionRuntimeSelection({
      fromRuntime: 'pi',
      toRuntime: 'openai-compatible',
      contract: providerContract,
      current: { providerId: '', model: '' },
      activeProviderId: 'provider',
      providerDefaultModel: 'provider-default',
      providerModels: ['provider-model', 'provider-default'],
      memory: { 'openai-compatible': 'provider-model', pi: 'local-model' },
    })
    expect(transition.selection).toEqual({ providerId: 'provider', model: 'provider-model' })
    expect(transition.memory.pi).toBe('local-model')
  })

  it('replaces a remembered model that the selected provider no longer advertises', () => {
    const transition = transitionRuntimeSelection({
      fromRuntime: 'pi',
      toRuntime: 'openai-compatible',
      contract: providerContract,
      current: { providerId: '', model: '' },
      activeProviderId: 'provider',
      providerDefaultModel: 'provider-default',
      providerModels: ['provider-default'],
      memory: { 'openai-compatible': 'removed-model' },
    })
    expect(transition.selection).toEqual({ providerId: 'provider', model: 'provider-default' })
  })

  it('keeps the selected model when the runtime does not change', () => {
    const transition = transitionRuntimeSelection({
      fromRuntime: 'pi',
      toRuntime: 'pi',
      contract: runtimeContract,
      current: { providerId: '', model: 'local-model' },
      memory: {},
    })
    expect(transition.selection).toEqual({ providerId: '', model: 'local-model' })
    expect(transition.memory.pi).toBe('local-model')
  })
})
