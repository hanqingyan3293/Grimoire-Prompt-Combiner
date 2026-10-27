import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getDatabase } from '../database'
import { assignAssetTag, batchAssignAssetTags, batchRemoveAssetTags, batchResolveTagSuggestions, createTagAlias, createTagRelation, createTagSuggestions, deleteTagAlias, deleteTagRelation, getTagIntelligence, listAssetTagLinks, listTagAliases, listTagRelations, listTagSuggestions, removeAssetTag, resolveTagSuggestion, searchTags, updateTagRelation } from '../services/tag-intelligence.service'
import { expandTagDescendants, expandTagRelations, searchTagsAdvanced } from '../services/tag-query.service'
import { listAssetLinksBatch, queryAssetKeysByTags } from '../services/tag-asset-query.service'
import { applyTagBatch, previewTagBatch } from '../services/tag-batch.service'
import { deleteSavedSearch, listSavedSearches, saveSavedSearch } from '../services/saved-search.service'
import { getTagMetadata, listTagMetadata, saveTagMetadata } from '../services/tag-metadata.service'

export function registerTagIntelligenceIPC(): void {
  ipcMain.handle(IPC_CHANNELS.TAGS_SEARCH, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    return searchTags(getDatabase(), value.query || '', Number(value.limit || 50), value.includeDisabled === true)
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_GET_INTELLIGENCE, async (_event, id: unknown) => getTagIntelligence(getDatabase(), id))
  ipcMain.handle(IPC_CHANNELS.TAG_ALIASES_LIST, async (_event, id: unknown) => listTagAliases(getDatabase(), id))
  ipcMain.handle(IPC_CHANNELS.TAG_ALIASES_CREATE, async (_event, input: unknown) => createTagAlias(getDatabase(), input as Record<string, unknown>))
  ipcMain.handle(IPC_CHANNELS.TAG_ALIASES_DELETE, async (_event, id: unknown) => deleteTagAlias(getDatabase(), id))
  ipcMain.handle(IPC_CHANNELS.TAG_RELATIONS_LIST, async (_event, id: unknown) => listTagRelations(getDatabase(), id || undefined))
  ipcMain.handle(IPC_CHANNELS.TAG_RELATIONS_CREATE, async (_event, input: unknown) => createTagRelation(getDatabase(), input as Record<string, unknown>))
  ipcMain.handle(IPC_CHANNELS.TAG_RELATIONS_UPDATE, async (_event, input: unknown) => updateTagRelation(getDatabase(), input as Record<string, unknown>))
  ipcMain.handle(IPC_CHANNELS.TAG_RELATIONS_DELETE, async (_event, id: unknown) => deleteTagRelation(getDatabase(), id))
  ipcMain.handle(IPC_CHANNELS.TAG_SUGGESTIONS_LIST, async (_event, input: unknown) => listTagSuggestions(getDatabase(), input && typeof input === 'object' ? input as Record<string, unknown> : {}))
  ipcMain.handle(IPC_CHANNELS.TAG_SUGGESTIONS_CREATE, async (_event, input: unknown) => createTagSuggestions(getDatabase(), input as { assetType: string; assetKey: string; values: Array<{ value: string; confidence?: number; namespace?: string; metadata?: Record<string, unknown> }>; source: 'wd14' | 'ai-vision' | 'parsed' | 'manual' | 'imported' | 'inferred' }))
  ipcMain.handle(IPC_CHANNELS.TAG_SUGGESTIONS_ACCEPT, async (_event, id: unknown) => resolveTagSuggestion(getDatabase(), { id, action: 'accept' }))
  ipcMain.handle(IPC_CHANNELS.TAG_SUGGESTIONS_REJECT, async (_event, id: unknown) => resolveTagSuggestion(getDatabase(), { id, action: 'reject' }))
  ipcMain.handle(IPC_CHANNELS.TAG_SUGGESTIONS_MAP, async (_event, input: unknown) => resolveTagSuggestion(getDatabase(), { ...(input as Record<string, unknown>), action: 'map' }))
  ipcMain.handle(IPC_CHANNELS.TAG_ASSET_LINKS_LIST, async (_event, input: unknown) => {
    const value = input as Record<string, unknown>
    return listAssetTagLinks(getDatabase(), value.assetType, value.assetKey)
  })
  ipcMain.handle(IPC_CHANNELS.TAG_ASSET_LINKS_ASSIGN, async (_event, input: unknown) => assignAssetTag(getDatabase(), input as Record<string, unknown>))
  ipcMain.handle(IPC_CHANNELS.TAG_ASSET_LINKS_REMOVE, async (_event, input: unknown) => removeAssetTag(getDatabase(), input as Record<string, unknown>))
  ipcMain.handle(IPC_CHANNELS.TAG_ASSET_LINKS_BATCH_ASSIGN, async (_event, input: unknown) => batchAssignAssetTags(getDatabase(), input as { assetType: string; assetKeys: string[]; tagIds: string[]; source?: string; confidence?: number; polarity?: string }))
  ipcMain.handle(IPC_CHANNELS.TAG_ASSET_LINKS_BATCH_REMOVE, async (_event, input: unknown) => batchRemoveAssetTags(getDatabase(), input as { assetType: string; assetKeys: string[]; tagIds: string[] }))
  ipcMain.handle(IPC_CHANNELS.TAG_SUGGESTIONS_BATCH_RESOLVE, async (_event, input: unknown) => batchResolveTagSuggestions(getDatabase(), input as { ids: string[]; action: 'accept' | 'reject' | 'ignore'; tagId?: string }))
  ipcMain.handle(IPC_CHANNELS.TAGS_SEARCH_ADVANCED, async (_event, input: unknown) => searchTagsAdvanced(getDatabase(), (input || {}) as Parameters<typeof searchTagsAdvanced>[1]))
  ipcMain.handle(IPC_CHANNELS.TAGS_EXPAND_RELATIONS, async (_event, input: unknown) => {
    const value = (input || {}) as Record<string, unknown>
    const tagIds = Array.isArray(value.tagIds) ? value.tagIds : []
    const maxDepth = Number(value.maxDepth) || undefined
    // `descendants` walks the reverse relation direction (general → specific)
    // and powers parent-substitution queries; default stays the implication
    // closure used by the implied/related strips.
    return value.direction === 'descendants'
      ? expandTagDescendants(getDatabase(), tagIds, { maxDepth })
      : expandTagRelations(getDatabase(), tagIds, { maxDepth })
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_QUERY_ASSETS, async (_event, input: unknown) => {
    const value = (input || {}) as Record<string, unknown>
    return queryAssetKeysByTags(getDatabase(), (value.filter || {}) as Parameters<typeof queryAssetKeysByTags>[1], (value.page || {}) as Parameters<typeof queryAssetKeysByTags>[2])
  })
  ipcMain.handle(IPC_CHANNELS.TAG_ASSET_LINKS_LIST_BATCH, async (_event, input: unknown) => {
    const value = (input || {}) as Record<string, unknown>
    return listAssetLinksBatch(getDatabase(), value.assetType, Array.isArray(value.assetKeys) ? value.assetKeys : [])
  })
  ipcMain.handle(IPC_CHANNELS.TAGS_BATCH_PREVIEW, async (_event, input: unknown) => previewTagBatch(getDatabase(), input as Parameters<typeof previewTagBatch>[1]))
  ipcMain.handle(IPC_CHANNELS.TAGS_BATCH_APPLY, async (_event, input: unknown) => applyTagBatch(getDatabase(), input as Parameters<typeof applyTagBatch>[1]))
  ipcMain.handle(IPC_CHANNELS.TAGS_SAVED_SEARCHES_LIST, async () => listSavedSearches(getDatabase()))
  ipcMain.handle(IPC_CHANNELS.TAGS_SAVED_SEARCHES_SAVE, async (_event, input: unknown) => saveSavedSearch(getDatabase(), input as Parameters<typeof saveSavedSearch>[1]))
  ipcMain.handle(IPC_CHANNELS.TAGS_SAVED_SEARCHES_DELETE, async (_event, id: unknown) => deleteSavedSearch(getDatabase(), id))
  // Tag metadata field editor (TagStudio semantics).
  ipcMain.handle(IPC_CHANNELS.TAG_METADATA_GET, async (_event, tagId: unknown) => getTagMetadata(getDatabase(), String(tagId || '')))
  ipcMain.handle(IPC_CHANNELS.TAG_METADATA_SAVE, async (_event, input: unknown) => saveTagMetadata(getDatabase(), input as Parameters<typeof saveTagMetadata>[1]))
  ipcMain.handle(IPC_CHANNELS.TAG_METADATA_LIST, async (_event, tagIds: unknown) => listTagMetadata(getDatabase(), Array.isArray(tagIds) ? tagIds.map(String) : []))
}
