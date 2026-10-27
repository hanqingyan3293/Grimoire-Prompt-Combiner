import { useCallback, useEffect, useMemo, useState } from 'react'
import { MODEL_SELECTOR_TAGS, useModelTagFilter } from '@renderer/components/ModelSelector/filters'
import { modelMatchesDisplayTag } from '@renderer/components/tags/Model'

type AnyRecord = Record<string, any>

function api(): AnyRecord {
  return (window as AnyRecord).api as AnyRecord
}

function providerView(raw: AnyRecord, configured?: AnyRecord): AnyRecord {
  return {
    id: String(raw.id || configured?.id || 'provider'),
    name: String(raw.name || configured?.name || raw.id || 'Provider'),
    description: raw.description || configured?.description || '',
    reportsActualCost: false,
    apiKeys: [],
    authType: configured?.authType || 'api-key',
    settings: configured?.settings || {},
    isEnabled: configured ? configured.is_active !== false : true,
    presetProviderId: raw.id,
    serverTools: raw.serverTools || []
  }
}

function modelView(raw: AnyRecord, provider: AnyRecord, modelId?: string): AnyRecord {
  const apiModelId = String(modelId || raw.apiModelId || raw.id || '')
  const id = apiModelId.includes('::') ? apiModelId : provider.id + '::' + apiModelId
  return {
    id,
    providerId: provider.id,
    apiModelId: apiModelId.includes('::') ? apiModelId.slice(apiModelId.indexOf('::') + 2) : apiModelId,
    name: String(raw.name || apiModelId),
    description: raw.description || '',
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
    contextWindow: raw.contextWindow,
    maxOutputTokens: raw.maxOutputTokens,
    supportsStreaming: true,
    isEnabled: provider.isEnabled !== false,
    isHidden: false,
    isDeprecated: false
  }
}

export function useModelSelectorData(options: AnyRecord = {}) {
  const [configuredProviders, setConfiguredProviders] = useState<AnyRecord[]>([])
  const [catalogProviders, setCatalogProviders] = useState<AnyRecord[]>([])
  const [catalogModels, setCatalogModels] = useState<AnyRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const { tagSelection, selectedTags, tagFilter, toggleTag, resetTags } = useModelTagFilter()

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [configured, providers, models] = await Promise.all([
        api().providers.list(),
        api().ai.sessions.catalog.providers({}),
        api().ai.sessions.catalog.models({ limit: 5000 })
      ])
      setConfiguredProviders(Array.isArray(configured) ? configured : [])
      setCatalogProviders(Array.isArray(providers) ? providers : [])
      setCatalogModels(Array.isArray(models) ? models : [])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (options.enabled === false) return
    void load()
  }, [load, options.enabled])

  const providerMap = useMemo(() => {
    const map = new Map<string, AnyRecord>()
    for (const raw of catalogProviders) map.set(String(raw.id), providerView(raw))
    for (const raw of configuredProviders) map.set(String(raw.id), providerView(raw, raw))
    for (const raw of catalogModels) {
      const id = String(raw.providerId || raw.ownedBy || '').trim()
      if (id && !map.has(id)) map.set(id, providerView({ id, name: id }))
    }
    return map
  }, [catalogModels, catalogProviders, configuredProviders])

  const allModels = useMemo(() => {
    const rows: AnyRecord[] = []
    // Catalog metadata is authoritative for capabilities. A configured ID placeholder
    // must not win deduplication and erase a known image/reasoning capability.
    for (const raw of catalogModels) {
      const providerId = String(raw.providerId || raw.ownedBy || '').trim()
      const provider = providerMap.get(providerId)
      if (provider) rows.push(modelView(raw, provider))
    }
    for (const configured of configuredProviders) {
      const provider = providerMap.get(String(configured.id))
      if (!provider) continue
      for (const id of Array.isArray(configured.models) ? configured.models : []) rows.push(modelView({ id }, provider, id))
    }
    const seen = new Set<string>()
    return rows.filter(row => !seen.has(row.id) && (seen.add(row.id), true))
  }, [catalogModels, configuredProviders, providerMap])

  const filteredModels = useMemo(() => {
    const search = String(options.searchText || '').trim().toLowerCase()
    return allModels.filter(model => {
      const provider = providerMap.get(model.providerId)
      if (!provider || provider.isEnabled === false || model.isEnabled === false) return false
      if (search && !(String(model.name) + ' ' + String(model.apiModelId) + ' ' + String(provider?.name || '')).toLowerCase().includes(search)) return false
      if (typeof options.filter === 'function' && !options.filter(model, provider)) return false
      if (options.showTagFilter !== false && !tagFilter(model as any, provider as any)) return false
      return true
    })
  }, [allModels, options.filter, options.searchText, options.showTagFilter, providerMap, tagFilter])

  const availableTags = useMemo(() => MODEL_SELECTOR_TAGS.filter(tag => allModels.some(model =>
    modelMatchesDisplayTag(model as any, tag, providerMap.get(model.providerId) as any)
  )), [allModels, providerMap])

  const sortedProviders = useMemo(() => {
    const providers = Array.from(providerMap.values()).filter(provider => provider.isEnabled !== false)
    const prioritized = new Map<string, number>((options.prioritizedProviderIds || []).map((id: string, index: number): [string, number] => [id, index]))
    return providers.sort((a, b) => (prioritized.get(a.id) ?? 9999) - (prioritized.get(b.id) ?? 9999) || a.name.localeCompare(b.name))
  }, [options.prioritizedProviderIds, providerMap])

  const modelItems = useMemo(() => filteredModels.map(model => {
    const provider = providerMap.get(model.providerId) || providerView({ id: model.providerId })
    return {
      key: model.id,
      type: 'model',
      groupKind: 'provider',
      model,
      provider,
      modelId: model.id,
      modelIdentifier: model.apiModelId || model.id,
      isPinned: pinnedIds.includes(model.id),
      showIdentifier: true
    }
  }), [filteredModels, pinnedIds, providerMap])

  const listItems = useMemo(() => {
    const groups: AnyRecord[] = []
    for (const provider of sortedProviders) {
      const rows = modelItems.filter(item => item.provider.id === provider.id)
      if (!rows.length) continue
      groups.push({ key: provider.id, type: 'group', title: provider.name, groupKind: 'provider', provider, canNavigateToSettings: true })
      groups.push(...rows)
    }
    return groups
  }, [modelItems, sortedProviders])

  const selectableModelsById = useMemo(() => new Map(filteredModels.map(model => [model.id, model])), [filteredModels])
  const togglePin = useCallback(async (id: string) => setPinnedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]), [])
  // The real source picker includes this in effect dependencies; keep it stable
  // so opening a picker does not start a perpetual reload loop.
  const refetchPinnedModels = useCallback(async () => undefined, [])

  return {
    availableTags,
    isLoading,
    isPinActionDisabled: false,
    listItems,
    modelItems,
    pinnedIds,
    refetchModels: load,
    refetchPinnedModels,
    refetchProviders: load,
    resetTags,
    resolvedSelectedModelIds: Array.isArray(options.selectedModelIds) ? options.selectedModelIds : [],
    selectableModelsById,
    selectedTags,
    sortedProviders,
    tagSelection,
    togglePin,
    toggleTag,
    visibleSelectedModelIdSet: new Set(Array.isArray(options.selectedModelIds) ? options.selectedModelIds : [])
  }
}
