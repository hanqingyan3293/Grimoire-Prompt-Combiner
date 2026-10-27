import providersData from "./provider-catalog.json"
import modelsData from "./model-catalog.json"

export type ProviderCatalogEntry = {
  id: string
  name: string
  description?: string
  defaultChatEndpoint?: string
  endpointConfigs?: Record<string, { adapterFamily?: string; baseUrl?: string; reasoningFormat?: unknown }>
  metadata?: Record<string, unknown>
  availableInEditions?: string[]
}

export type ModelCatalogEntry = {
  id: string
  name?: string
  ownedBy?: string
  capabilities?: string[]
  inputModalities?: string[]
  outputModalities?: string[]
  contextWindow?: number
  maxOutputTokens?: number
  family?: string
  metadata?: Record<string, unknown>
}

const providers = ((providersData as unknown as { providers?: ProviderCatalogEntry[] }).providers || []).map(item => ({
  id: String(item.id),
  name: String(item.name || item.id),
  description: item.description,
  defaultChatEndpoint: item.defaultChatEndpoint,
  endpointConfigs: item.endpointConfigs,
  metadata: item.metadata,
  availableInEditions: item.availableInEditions,
}))

const models = ((modelsData as unknown as { models?: ModelCatalogEntry[] }).models || []).map(item => ({
  id: String(item.id),
  name: item.name,
  ownedBy: item.ownedBy,
  capabilities: item.capabilities || [],
  inputModalities: item.inputModalities || [],
  outputModalities: item.outputModalities || [],
  contextWindow: item.contextWindow,
  maxOutputTokens: item.maxOutputTokens,
  family: item.family,
  metadata: item.metadata,
}))

export function listProviderCatalog(query = "") {
  const normalized = query.trim().toLowerCase()
  return normalized ? providers.filter(item => (item.id + " " + item.name + " " + (item.description || "")).toLowerCase().includes(normalized)) : providers
}

export function listModelCatalog(input: { query?: string; providerId?: string; capability?: string; limit?: number } = {}) {
  const query = input.query?.trim().toLowerCase() || ""
  const filtered = models.filter(item => {
    if (query && !(item.id + " " + (item.name || "") + " " + (item.ownedBy || "")).toLowerCase().includes(query)) return false
    if (input.capability && !item.capabilities?.includes(input.capability)) return false
    if (input.providerId) {
      const owner = providers.find(provider => provider.id === input.providerId)
      if (owner && item.ownedBy && item.ownedBy !== owner.id && item.ownedBy !== input.providerId) return false
    }
    return true
  })
  return filtered.slice(0, Math.max(1, Math.min(5000, input.limit || 500)))
}

