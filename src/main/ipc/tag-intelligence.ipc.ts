import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getDatabase } from '../database'
import { assignAssetTag, batchAssignAssetTags, batchRemoveAssetTags, batchResolveTagSuggestions, createTagAlias, createTagRelation, deleteTagAlias, deleteTagRelation, getTagIntelligence, listAssetTagLinks, listTagAliases, listTagRelations, listTagSuggestions, removeAssetTag, resolveTagSuggestion, searchTags, updateTagRelation } from '../services/tag-intelligence.service'

export function registerTagIntelligenceIPC(): void {
  ipcMain.handle(IPC_CHANNELS.TAGS_SEARCH, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    return searchTags(getDatabase(), value.query || '', Number(value.limit || 50))
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
}
