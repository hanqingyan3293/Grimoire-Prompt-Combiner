/**
 * Bounded extraction/adaptation of Cherry runtime/pi/modelInjection.ts,
 * agentContextWindow.ts and agentProviderHeaders.ts (AGPL-3.0).
 *
 * Main-owned ports replace Cherry application/data-service singletons. The host
 * must resolve endpoint preference/dialect/base URL and immutable model facts.
 * No Grimoire DB, renderer, IPC, environment mutation, credential persistence,
 * gateway, OAuth transport, usage accounting, or agent loop lives here.
 * Unsupported routes fail closed rather than pretending to have source parity.
 */
import type { ProviderConfig, ProviderModelConfig } from '@earendil-works/pi-coding-agent'

export type PiApi = 'anthropic-messages' | 'openai-completions' | 'openai-responses' |
  'azure-openai-responses' | 'google-generative-ai'
type PiChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>

export const PI_PLACEHOLDER_API_KEY = 'cherry-managed-runtime-key'
const SUPPORTED_APIS: readonly string[] = [
  'anthropic-messages', 'openai-completions', 'openai-responses',
  'azure-openai-responses', 'google-generative-ai'
]
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export interface PiProviderSnapshot {
  id: string
  name: string
  /** Already formatted for this wire family by the main host endpoint resolver. */
  baseUrl: string
  api: string | undefined
  route: 'direct-api-key' | 'oauth' | 'gateway' | 'external-cli'
  authOptional?: boolean
  headers?: Record<string, unknown>
  supportsDeveloperRole?: boolean
  /** Source CherryIN replay also needs an approved stream wrapper; not enabled here. */
  requiresThinkingReplay?: boolean
  apiVersion?: string
}

export interface PiModelSnapshot {
  /** Composite identity of the captured model row. */
  id: string
  providerId: string
  /** Exact resolved wire ID, not the composite storage ID. */
  apiModelId: string
  name: string
  capabilities: readonly string[]
  inputModalities?: readonly string[]
  contextWindow?: number
  maxOutputTokens?: number
  reasoning?: { selectableEfforts?: readonly string[] }
}

/** Internal main-only contract. Never export this result to renderer/logs/storage. */
export interface PiProviderInjection {
  providerName: string
  api: PiApi
  providerConfig: ProviderConfig & { models: PiChatModelConfig[] }
  apiKey: string
  modelId: string
  requestEnvironment?: Record<string, string>
}

export interface PiInjectionHostPorts {
  /** One immutable main-owned snapshot; owns endpoint selection and URL normalization. */
  getSnapshot(uniqueModelId: string): Promise<{ provider: PiProviderSnapshot; model: PiModelSnapshot }>
  /** Main-only credential selection; called only after compatibility validation. */
  resolveApiKey(providerId: string): Promise<string>
}

export class PiUnsupportedProviderError extends Error {
  constructor(readonly providerId: string) {
    super(`Provider "${providerId}" requires an unsupported Pi route or API family`)
    this.name = 'PiUnsupportedProviderError'
  }
}

export class PiMissingApiKeyError extends Error {
  constructor(readonly providerId: string) {
    super(`Provider "${providerId}" has no API key configured for pi agents`)
    this.name = 'PiMissingApiKeyError'
  }
}

function assertCompatible(provider: PiProviderSnapshot, model: PiModelSnapshot): asserts provider is PiProviderSnapshot & { api: PiApi } {
  if (provider.route !== 'direct-api-key' || !SUPPORTED_APIS.includes(provider.api ?? '') || provider.requiresThinkingReplay) {
    throw new PiUnsupportedProviderError(provider.id)
  }
  if (!provider.id || model.providerId !== provider.id || !model.apiModelId.trim()) {
    throw new Error('Pi provider/model snapshot identity mismatch')
  }
  // Pi config treats these as interpolation syntax. A resolved endpoint is a
  // literal URL, never an environment reference or command to run.
  try {
    const url = new URL(provider.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[$!]/.test(provider.baseUrl)) throw new Error()
  } catch {
    throw new Error('Pi requires a resolved literal HTTP(S) endpoint')
  }
}

/** Source literal escaping prevents Pi's $ENV / !command header interpolation. */
function toPiHeaders(headers?: Record<string, unknown>): Record<string, string> | undefined {
  if (!headers) return undefined
  const coerced: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value == null || typeof value === 'object') continue
    coerced[name] = String(value).replaceAll('$', '$$$$').replace(/^!/, '$!')
  }
  return coerced
}

export function buildPiProviderInjection(provider: PiProviderSnapshot, model: PiModelSnapshot, apiKey: string): PiProviderInjection {
  assertCompatible(provider, model)
  if (!apiKey.trim() && provider.authOptional !== true) throw new PiMissingApiKeyError(provider.id)
  const declared = model.reasoning?.selectableEfforts ?? []
  const thinkingLevelMap: PiChatModelConfig['thinkingLevelMap'] = {}
  if (declared.some(effort => effort !== 'none' && effort !== 'auto')) {
    for (const level of PI_THINKING_LEVELS) {
      const effort = level === 'off' ? 'none' : level
      thinkingLevelMap[level] = declared.includes(effort) ? effort : null
    }
  }
  const supportsImage = model.capabilities.includes('image-recognition') || model.inputModalities?.includes('image')
  const contextWindow = typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
    ? model.contextWindow : 256_000
  const modelConfig: PiChatModelConfig = {
    id: model.apiModelId,
    name: model.name,
    api: provider.api,
    reasoning: model.capabilities.includes('reasoning') || model.reasoning !== undefined,
    ...(Object.keys(thinkingLevelMap).length ? { thinkingLevelMap } : {}),
    input: supportsImage ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: model.maxOutputTokens ?? 8_192,
    ...(provider.api === 'openai-completions' || provider.api === 'openai-responses'
      ? { compat: { supportsDeveloperRole: provider.supportsDeveloperRole === true } } : {})
  }
  return {
    providerName: provider.id,
    api: provider.api,
    providerConfig: {
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: PI_PLACEHOLDER_API_KEY,
      api: provider.api,
      headers: toPiHeaders(provider.headers),
      models: [modelConfig]
    },
    apiKey: apiKey.trim() ? apiKey : PI_PLACEHOLDER_API_KEY,
    modelId: model.apiModelId,
    ...(provider.api === 'azure-openai-responses' && provider.apiVersion?.trim()
      ? { requestEnvironment: { AZURE_OPENAI_API_VERSION: provider.apiVersion.trim() } } : {})
  }
}

export async function resolvePiProviderInjection(uniqueModelId: string, host: PiInjectionHostPorts): Promise<PiProviderInjection> {
  // No guessing provider/model ownership or substituting a default model.
  const parts = uniqueModelId.split('::')
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error('Pi requires a composite provider::model ID')
  const { provider, model } = await host.getSnapshot(uniqueModelId)
  if (provider.id !== parts[0] || model.id !== uniqueModelId) throw new Error('Pi selected provider/model does not match the requested identity')
  assertCompatible(provider, model)
  return buildPiProviderInjection(provider, model, await host.resolveApiKey(provider.id))
}
