// Vite 环境变量类型
/// <reference types="vite/client" />
import type { ComfyHistoryResult, ComfyQueue, Provider, ProviderSaveInput } from '../shared/types'
import type { TaskEvent, TaskRecord, TaskStatus } from '../shared/task-types'
import type { ImageDeleteBatchResult } from '../shared/image-deletion-types'
import type { CanvasDocument, CanvasProject } from '../shared/canvas-types'
import type { PromptAssetPage, PromptAssetQuery } from '../shared/prompt-asset-types'
import type { WD14HistoryRecord } from '../shared/wd14-types'
import type { CherryCacheEntry, CherryCacheSyncMessage, CherryDataApiDataChangeEffect, CherryDataApiRequest, CherryDataApiResponse } from '../shared/cherry-preload-types'
import type { AgentSessionAttachment, AgentSessionEventRecord, AgentSessionRecord, AgentSessionSnapshot, AgentSessionWorkspace, McpServerRecord } from '../shared/agent-types'
import type { AiAssistantRecord, AiEventRecord, AiMessageRecord, AiResourceOrderAnchor, AiSessionRecord, AiTopicRecord } from '../shared/ai-types'
import type { StorageInventory } from '../shared/storage-types'
import type { BootMetrics } from '../main/services/boot-metrics.service'
import type { BackupManifest, ImportApplyResult, ImportInspection, TransferProgress } from '../shared/storage-transfer-types'

/** NovelAI generation parameters embedded in the PNG Comment block (M6.6). */
export interface NovelaiMetadataParams {
  prompt: string
  negativePrompt?: string
  steps?: number
  cfg?: number
  seed?: number
  sampler?: string
  scheduler?: string
  width?: number
  height?: number
  model?: string
  checkpoint?: string
  loras?: string[]
}

/** `unknown` carries keys this UI version has no field for, preserved for the next write. */
export interface NovelaiMetadataDecoded {
  params: NovelaiMetadataParams
  unknown: Record<string, unknown>
  version: number | null
}

export interface NovelaiMetadataExportResult {
  canceled?: boolean
  writtenPath?: string
  bytes?: number
  error?: string
}

export interface NovelaiMetadataReadResult {
  canceled?: boolean
  decoded?: NovelaiMetadataDecoded | null
}

// 预加载 API 类型
export interface GrimoireAPI {
  // Existing MCP shared-cache preload surface; renderer-to-main broadcast is inert.
  cache: {
    getAllShared: () => Promise<Record<string, CherryCacheEntry>>
    broadcastSync: (message: CherryCacheSyncMessage) => void
    onSync: (callback: (message: CherryCacheSyncMessage) => void) => () => void
  }
  application: {
    relaunch: () => Promise<boolean>
  }
  shortcut: {
    onRegistrationConflict: (callback: (payload: { key: string; accelerator?: string; hasConflict: boolean }) => void) => () => void
  }
  meta: {
    apiVersion: string
    capabilities: {
      unifiedSessions: boolean
      attachments: boolean
      catalog: boolean
      runtimes: boolean
      mcp: boolean
    }
  }
  tags: {
    getAll: () => Promise<{
      categories: Array<{ id: string; en: string; zh: string; sort_order: number; created_at: string }>
      subcategories: Array<{ id: string; category_id: string; en: string; zh: string; sort_order: number; created_at: string }>
      tags: Array<{ id: string; subcategory_id: string; en: string; zh: string; sort_order: number; source: string; created_at: string }>
    }>
    create: (data: { subcategory_id: string; en: string; zh: string }) => Promise<{ id: string }>
    update: (data: { id: string; en: string; zh: string }) => Promise<boolean>
    delete: (id: string) => Promise<boolean>
    exportPackage: (id: string, format: 'json' | 'zip') => Promise<boolean>
    importPackage: () => Promise<{ projectId: string; projectName: string; importedImages: number; skippedImages: number; warnings: string[]; importedPromptAssets: number; importedWorkflows: number } | null>
    import: (jsonData: string) => Promise<boolean>
    reset: () => Promise<boolean>
    createCategory: (data: { zh: string }) => Promise<{ id: string }>
    updateCategory: (data: { id: string; zh: string }) => Promise<boolean>
    deleteCategory: (id: string) => Promise<boolean>
    createSubcategory: (data: { category_id: string; zh: string }) => Promise<{ id: string }>
    updateSubcategory: (data: { id: string; zh: string }) => Promise<boolean>
    deleteSubcategory: (id: string) => Promise<boolean>
    search: (input: { query?: string; limit?: number; includeDisabled?: boolean }) => Promise<unknown[]>
    getIntelligence: (id: string) => Promise<unknown>
    aliases: {
      list: (tagId: string) => Promise<unknown[]>
      create: (input: { tagId: string; alias: string; language?: string; source?: string }) => Promise<unknown>
      delete: (id: string) => Promise<boolean>
    }
    relations: {
      list: (tagId?: string) => Promise<unknown[]>
      create: (input: { sourceTagId: string; targetTagId: string; relationType: string; confidence?: number; source?: string }) => Promise<unknown>
      update: (input: { id: string; confidence?: number; enabled?: boolean }) => Promise<boolean>
      delete: (id: string) => Promise<boolean>
    }
    suggestions: {
      list: (input?: { assetType?: string; assetKey?: string; status?: string }) => Promise<unknown[]>
      create: (input: { assetType: string; assetKey: string; values: Array<{ value: string; confidence?: number; namespace?: string }>; source: string }) => Promise<unknown[]>
      accept: (id: string) => Promise<unknown>
      reject: (id: string) => Promise<unknown>
      map: (input: { id: string; tagId: string }) => Promise<unknown>
      batchResolve: (input: { ids: string[]; action: 'accept' | 'reject' | 'ignore'; tagId?: string }) => Promise<number>
    }
    assetLinks: {
      list: (input: { assetType: string; assetKey: string }) => Promise<unknown[]>
      assign: (input: Record<string, unknown>) => Promise<unknown>
      remove: (input: { assetType: string; assetKey: string; tagId: string }) => Promise<boolean>
      batchAssign: (input: { assetType: string; assetKeys: string[]; tagIds: string[]; source?: string; confidence?: number; polarity?: string }) => Promise<number>
      batchRemove: (input: { assetType: string; assetKeys: string[]; tagIds: string[] }) => Promise<number>
      listBatch: (input: { assetType: string; assetKeys: string[] }) => Promise<Array<{ assetKey: string; tagIds: string[]; links: Array<{ tagId: string; polarity: string; weight: number; confidence: number; source: string; status: string }> }>>
    }
    searchAdvanced: (input: { query?: string; limit?: number; mode?: 'substring' | 'prefix'; namespace?: string; sort?: 'score' | 'usage' | 'alpha' }) => Promise<unknown[]>
    expandRelations: (input: { tagIds: string[]; maxDepth?: number; direction?: 'forward' | 'descendants' }) => Promise<unknown[]>
    queryAssets: (input: { filter: { assetType: string; tagIds: string[]; logic?: 'any' | 'all' | 'none'; polarity?: string; includeImplied?: boolean }; page?: { limit?: number; offset?: number } }) => Promise<{ keys: Array<{ assetKey: string; matchedCount: number }>; total: number }>
    batchPreview: (input: { filter: { assetType: string; tagIds: string[]; logic?: 'any' | 'all' | 'none'; polarity?: string; includeImplied?: boolean }; operation: { type: 'add' | 'remove' | 'replace'; tagIds?: string[]; fromTagId?: string; toTagId?: string }; onlyEmpty?: boolean; sampleLimit?: number }) => Promise<{ total: number; sample: string[]; operationCount: number }>
    batchApply: (input: { filter: { assetType: string; tagIds: string[]; logic?: 'any' | 'all' | 'none'; polarity?: string; includeImplied?: boolean }; operation: { type: 'add' | 'remove' | 'replace'; tagIds?: string[]; fromTagId?: string; toTagId?: string }; onlyEmpty?: boolean; chunkSize?: number }) => Promise<{ total: number; applied: number; tagsTouched: string[] }>
    savedSearches: {
      list: () => Promise<Array<{ id: string; name: string; queryJson: string; sortJson: string; viewMode: string; pinned: boolean; createdAt: string; updatedAt: string }>>
      save: (input: { name: string; queryJson?: string; sortJson?: string; viewMode?: string; pinned?: boolean; id?: string }) => Promise<{ id: string; name: string; queryJson: string; sortJson: string; viewMode: string; pinned: boolean; createdAt: string; updatedAt: string }>
      delete: (id: string) => Promise<boolean>
    }
    metadata: {
      get: (tagId: string) => Promise<{ tagId: string; namespace: string; description: string; color: string; isActive: boolean; source: string } | null>
      save: (input: { tagId: string; namespace?: string; description?: string; color?: string; isActive?: boolean }) => Promise<{ tagId: string; namespace: string; description: string; color: string; isActive: boolean; source: string }>
      list: (tagIds: string[]) => Promise<Array<{ tagId: string; namespace: string; description: string; color: string; isActive: boolean; source: string } | null>>
    }
  }
  presets: {
    list: () => Promise<Array<{ id: string; name: string; data: { positive: Array<{ tag_id: string; weight: number }>; negative: Array<{ tag_id: string; weight: number }> }; created_at: string; updated_at: string }>>
    save: (data: { id?: string; name: string; data: object }) => Promise<{ id: string; name: string }>
    delete: (id: string) => Promise<boolean>
  }
  history: {
    list: () => Promise<Array<{ id: string; prompt: string; positive_count: number; negative_count: number; created_at: string }>>
    add: (data: { prompt: string; positive_count: number; negative_count: number }) => Promise<boolean>
    clear: () => Promise<boolean>
  }
  promptAssets: {
    list: (query?: PromptAssetQuery) => Promise<PromptAssetPage>
    create: (input: { name: string; prompt: string; detail?: string; sourceId?: string; nsfw?: boolean; variantCount?: number }) => Promise<unknown>
    delete: (sourceId: string) => Promise<boolean>
    categories: {
      list: () => Promise<Array<{ id: string; parentId: string | null; name: string; sourceScope: string; sortOrder: number; isBuiltin: boolean }>>
      create: (input: { name: string; parentId?: string | null; sourceScope?: string }) => Promise<unknown>
      rename: (input: { id: string; name: string }) => Promise<boolean>
      delete: (id: string) => Promise<boolean>
      assign: (input: { assetId: string; categoryId: string }) => Promise<boolean>
      move: (input: { id: string; parentId: string | null }) => Promise<boolean>
    }
  }
  theme: {
    publish: (palette: { mode: 'light' | 'dark'; vars: Record<string, string> }) => Promise<boolean>
    get: () => Promise<{ mode: 'light' | 'dark'; vars: Record<string, string> } | null>
    onChanged: (callback: (palette: { mode: 'light' | 'dark'; vars: Record<string, string> }) => void) => () => void
  }
  selection: {
    open: (text?: string) => Promise<boolean>
    current: () => Promise<{ text: string; actions: string[] }>
    apply: (action: string) => Promise<{ ok: boolean; error?: string; outcome?: { kind: string; text?: string; assetId?: string } }>
    close: () => Promise<boolean>
  }
  settings: {
    getAll: () => Promise<{
      api_endpoint: string; api_model: string;
      theme: string; appearance_mode: "system" | "light" | "dark"; language: string; custom_accent: string;
      custom_bg_primary: string; custom_bg_secondary: string; custom_bg_tertiary: string; custom_border: string
      ui_scale: string; ui_density: string; max_undo_steps: number
      random_min: string; random_max: string
      [key: string]: string | number
    }>
    set: (key: string, value: string) => Promise<boolean>
  }
  system: {
    listFonts: () => Promise<string[]>
    openExternal: (url: string) => Promise<boolean>
    showItemInFolder: (filePath: string) => Promise<boolean>
  }
  images: {
    list: () => Promise<Array<{ id: number; file_path: string; storage_mode: 'managed' | 'external'; asset_hash: string | null; mime_type: string | null; file_size: number | null; original_name: string | null; available: boolean; created_at: string }>>
    listPaged: (input?: { limit?: number; offset?: number }) => Promise<{ items: Array<{ id: number; file_path: string; storage_mode: 'managed' | 'external'; asset_hash: string | null; mime_type: string | null; file_size: number | null; original_name: string | null; available: boolean; created_at: string }>; total: number; limit: number; offset: number }>
    add: (mode?: 'managed' | 'external') => Promise<{ id: number; file_path: string; storage_mode: 'managed' | 'external' } | null>
    delete: (id: number) => Promise<boolean>
    deleteBatch: (input: { ids: number[] }) => Promise<ImageDeleteBatchResult>
    existingIds: (input: { ids: number[] }) => Promise<number[]>
    importData: (dataBase64: string, originalName: string) => Promise<unknown>
    readData: (id: number) => Promise<string>
  }
  media: {
    list: (input?: Record<string, unknown>) => Promise<unknown[]>
    get: (id: string) => Promise<unknown>
    search: (input?: Record<string, unknown>) => Promise<unknown[]>
    update: (input: Record<string, unknown>) => Promise<unknown>
    delete: (id: string) => Promise<boolean>
    relocate: (input: { id: string; filePath: string }) => Promise<unknown>
    batchUpdate: (input: { ids: string[]; favorite?: boolean; rating?: number }) => Promise<number>
    batchDelete: (input: { ids: string[] }) => Promise<number>
    metadata: {
      get: (id: string) => Promise<unknown>
      save: (input: Record<string, unknown>) => Promise<unknown>
      parse: (input: { mediaId: string; persist?: boolean }) => Promise<unknown>
      scan: (input?: { batchSize?: number }) => Promise<{ scanned: number; parsed: number; skipped: number }>
    }
    relations: { list: (input: { type: string; key: string }) => Promise<unknown[]>; create: (input: Record<string, unknown>) => Promise<unknown>; delete: (id: string) => Promise<boolean> }
    query: (input: { query?: Record<string, unknown>; page?: { limit?: number; offset?: number } }) => Promise<{ items: Array<{ mediaId: string; imageRefId: number; title: string; originalName: string; sourceKind: string; favorite: boolean; rating: number; available: boolean; width: number | null; height: number | null; createdAt: string; updatedAt: string }>; total: number }>
    thumbs: (input: { ids: number[]; kind?: 'thumbnail' | 'preview' }) => Promise<Record<number, string | null>>
    batchPreview: (input: { ids?: string[]; query?: Record<string, unknown> }) => Promise<{ assets: number }>
    onScanProgress: (callback: (value: { done: number; total: number }) => void) => () => void
    similarity: (input: { imageRefId: number; limit?: number; method?: 'auto' | 'hash' | 'clip'; maxDistance?: number }) => Promise<{ method: 'hash' | 'clip'; items: Array<{ imageRefId: number; distance: number; score: number }> }>
    indexSimilarity: (input?: { batchSize?: number }) => Promise<{ indexed: number; skipped: number; failed: number; clip: { indexed: number; skipped: number; failed: number } | null }>
    onSimilarityProgress: (callback: (value: { done: number; total: number }) => void) => () => void
    duplicates: (input?: { maxDistance?: number; limit?: number; page?: number }) => Promise<{ groups: Array<{ hash: string; imageRefIds: number[] }>; total: number }>
    folderScan: (input: { directory: string; recursive?: boolean }) => Promise<{ directory: string; entries: Array<{ filePath: string; fileName: string; size: number; alreadyImported: boolean }>; total: number }>
    folderImport: (input: { filePaths: string[]; mode?: 'managed' | 'external' }) => Promise<{ imported: number; skipped: number; failed: number; imageIds: number[] }>
    clip: {
      diagnostics: () => Promise<{ pythonPath: string; modelDirectory: string; pythonAvailable: boolean; runtimeAvailable: boolean; runtimeVersion: string | null; modelCount: number }>
      selectModelDirectory: () => Promise<string | null>
      selectPythonPath: () => Promise<string | null>
    }
  }
  chat: {
    listGroups: () => Promise<Array<{ id: string; name: string; sort_order: number; created_at: string }>>
    createGroup: (name: string) => Promise<{ id: string; name: string }>
    deleteGroup: (id: string) => Promise<boolean>
    renameGroup: (id: string, name: string) => Promise<boolean>
    listConversations: () => Promise<Array<{ id: string; group_id: string; provider_id: string; title: string; model: string; system_prompt: string; pinned: number; created_at: string; updated_at: string }>>
    createConversation: (data: { provider_id: string; model: string; title?: string; group_id?: string }) => Promise<{ id: string; title: string }>
    deleteConversation: (id: string) => Promise<boolean>
    updateConversation: (id: string, data: any) => Promise<boolean>
    moveConversation: (convId: string, groupId: string) => Promise<boolean>
    getMessages: (convId: string) => Promise<Array<{ id: string; conv_id: string; role: 'user' | 'assistant' | 'system'; content: string; model: string; token_count: number; created_at: string }>>
    saveMessage: (msg: { id?: string; conv_id: string; role: string; content: string; model?: string; token_count?: number }) => Promise<{ id: string }>
    deleteMessage: (id: string) => Promise<boolean>
    clearMessages: (convId: string) => Promise<boolean>
  }
  tagGroups: {
    list: () => Promise<Array<{ id: string; name: string; is_active: number; created_at: string }>>
    create: (name: string, copyFrom?: string) => Promise<{ id: string }>
    delete: (id: string) => Promise<boolean>
    rename: (id: string, name: string) => Promise<boolean>
    copy: (id: string, name: string) => Promise<{ id: string }>
    import: (data: any, name: string) => Promise<{ id: string }>
    export: (id: string) => Promise<any>
    setActive: (id: string) => Promise<boolean>
  }
  providers: {
    list: () => Promise<Provider[]>
    save: (data: ProviderSaveInput) => Promise<{ id: string }>
    delete: (id: string) => Promise<boolean>
    setActive: (id: string) => Promise<boolean>
    fetchModels: (baseUrl: string, apiKey: string) => Promise<{ success?: boolean; models?: string[]; error?: string }>
    test: (baseUrl: string, apiKey: string, model: string, protocol?: 'chat_completions' | 'responses') => Promise<{ success: boolean; message?: string; error?: string }>
    fetchModelsForProvider: (input: { providerId: string; apiKey?: string }) => Promise<{ success?: boolean; models?: string[]; error?: string }>
    testProvider: (input: { providerId: string; apiKey?: string; model?: string; protocol?: 'chat_completions' | 'responses' }) => Promise<{ success: boolean; message?: string; error?: string }>
  }
  favorites: {
    tagList: () => Promise<Array<any>>
    subList: () => Promise<Array<any>>
    tagAdd: (tagId: string) => Promise<boolean>
    tagRemove: (tagId: string) => Promise<boolean>
    subAdd: (subId: string) => Promise<boolean>
    subRemove: (subId: string) => Promise<boolean>
  }
  dialog: {
    save: (content: string, defaultName: string) => Promise<boolean>
    open: () => Promise<string | null>
      openImage: () => Promise<string | null>
    openDirectory: () => Promise<string | null>
  }
  ai: {
    sendMessage: (args: { providerId: string; model: string; messages: Array<{ role: string; content: any }> }) => Promise<{ success?: boolean; text?: string; error?: string }>
    vision: (args: { providerId: string; model: string; imageBase64: string; prompt?: string }) => Promise<{ success?: boolean; text?: string; error?: string }>
    generateImage: (args: { providerId: string; model: string; prompt: string }) => Promise<{ success?: boolean; url?: string; error?: string }>
    fetchModels: (args: { baseUrl: string; apiKey: string }) => Promise<{ success?: boolean; models?: string[]; error?: string }>
    onChunk: (callback: (data: any) => void) => () => void
    sessions: {
      list: (input?: { query?: string; kind?: string; limit?: number; includeArchived?: boolean; manualOrder?: boolean }) => Promise<AiSessionRecord[]>
      archive: (id: string) => Promise<AiSessionRecord>
      restore: (id: string) => Promise<AiSessionRecord>
      pin: (id: string, pinned: boolean) => Promise<AiSessionRecord>
      reorder: (input: { id: string; overId: string; position: 'before' | 'after' | 'last' }) => Promise<AiSessionRecord>
      latest: (input?: { kind?: string }) => Promise<AiSessionRecord | null>
      get: (id: string) => Promise<{ session: AiSessionRecord; messages: AiMessageRecord[]; events: AiEventRecord[] } | null>
      create: (input: Record<string, unknown>) => Promise<AiSessionRecord>
      import: (input: unknown) => Promise<AiSessionRecord>
      update: (input: Record<string, unknown>) => Promise<AiSessionRecord>
      delete: (id: string) => Promise<boolean>
      branch: (input: { sessionId: string; title?: string }) => Promise<AiSessionRecord>
      send: (input: { sessionId: string; content: string; modelId?: string; attachments?: unknown[]; context?: unknown[] }) => Promise<{ text: string; session: AiSessionRecord }>
      interrupt: (sessionId: string) => Promise<boolean>
      retry: (input: string | { sessionId: string; messageId?: string }) => Promise<{ session: AiSessionRecord; content: string; attachments?: unknown[] } | null>
      compact: (sessionId: string) => Promise<AiSessionRecord>
      search: (input?: { query?: string; kind?: string; limit?: number }) => Promise<AiSessionRecord[]>
      catalog: {
        providers: (input?: { query?: string }) => Promise<unknown[]>
        models: (input?: { query?: string; providerId?: string; capability?: string; limit?: number }) => Promise<unknown[]>
      }
      runtimes: {
        list: () => Promise<Array<{ kind: string; available: boolean; source: string; executable: string | null; version: string | null; message: string; checkedAt: string; contract: { provider: 'grimoire' | 'runtime'; model: 'catalog' | 'freeform' } }>>
        capabilities: (kind: string) => Promise<Record<string, { state: 'supported' | 'unavailable' | 'blocked' | 'not-implemented'; reason: string; unblock?: string }>>
        prepare: (kind: string) => Promise<{ kind: string; available: boolean; source: string; executable: string | null; version: string | null; message: string; checkedAt: string; contract: { provider: 'grimoire' | 'runtime'; model: 'catalog' | 'freeform' } }>
      }
      appendMessage: (input: Record<string, unknown>) => Promise<AiMessageRecord>
      updateMessage: (input: Record<string, unknown>) => Promise<AiMessageRecord>
      deleteMessage: (id: string) => Promise<boolean>
      appendEvent: (input: Record<string, unknown>) => Promise<AiEventRecord>
      onEvent: (callback: (value: { kind: 'message' | 'message-deleted' | 'event' | 'delta' | 'resource'; sessionId?: string; messageId?: string; text?: string; record?: AiMessageRecord | AiEventRecord | import('@shared/ai-types').AiResourceRecord }) => void) => () => void
      onPermissionRequest: (callback: (value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => void) => () => void
      decidePermission: (value: { requestId: string; decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel' }) => Promise<boolean>
      attachments: {
        select: () => Promise<string | null>
        list: (sessionId: string) => Promise<import('@shared/ai-types').AiAttachmentRecord[]>
        import: (input: { sessionId: string; filePath: string; sourceType?: string; messageId?: string | null }) => Promise<import('@shared/ai-types').AiAttachmentRecord>
        delete: (id: string) => Promise<boolean>
        read: (id: string) => Promise<{ id: string; mimeType: string; originalName: string; status: 'available' | 'missing' | 'deleted'; dataUrl?: string; text?: string }>
      }
      assistants: {
        list: (input?: { includeArchived?: boolean; manualOrder?: boolean }) => Promise<AiAssistantRecord[]>
        save: (input: Partial<AiAssistantRecord> & { id?: string }) => Promise<AiAssistantRecord>
        delete: (id: string) => Promise<boolean>
        archive: (id: string) => Promise<AiAssistantRecord>
        restore: (id: string) => Promise<AiAssistantRecord>
        pin: (id: string, pinned: boolean) => Promise<AiAssistantRecord>
        reorder: (input: { id: string; anchor: AiResourceOrderAnchor }) => Promise<AiAssistantRecord>
      }
      topics: {
        list: (input: { sessionId: string; includeArchived?: boolean; manualOrder?: boolean }) => Promise<AiTopicRecord[]>
        save: (input: Partial<AiTopicRecord> & { session_id: string; id?: string }) => Promise<AiTopicRecord>
        delete: (id: string) => Promise<boolean>
        archive: (id: string) => Promise<AiTopicRecord>
        restore: (id: string) => Promise<AiTopicRecord>
        pin: (id: string, pinned: boolean) => Promise<AiTopicRecord>
        reorder: (input: { id: string; anchor: AiResourceOrderAnchor; ownerId?: string }) => Promise<AiTopicRecord>
        latest: (input?: { sessionId?: string | null }) => Promise<AiTopicRecord | null>
      }
    }
  }
  window: {
    openSettings: () => Promise<void>
    openAI: () => Promise<void>
    openCherry: () => Promise<void>
  }
  resolvePath: (filePath: string) => Promise<string | null>
  isPathInside: (childPath: string, parentPath: string) => Promise<boolean>
  hasWritePermission: (dirPath: string) => Promise<boolean>
  /** File bridge consumed by the Cherry compat composer drop/paste path. */
  file: {
    selectFolder: (options?: { title?: string; properties?: string[] }) => Promise<string | null>
    openPath: (filePath: string) => Promise<void>
    save: (fileName: string, content: string | Uint8Array, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
    getPathForFile: (file: File) => string
    get: (filePath: string) => Promise<{ id: string; name: string; origin_name: string; path: string; size: number; ext: string; type: string; mime: string } | null>
    getMetadata: (filePath: string) => Promise<{ kind: 'file' | 'directory'; size: number; createdAt: number; modifiedAt: number; mime?: string; type?: string } | null>
    createTempFile: (name: string) => Promise<string>
    write: (filePath: string, data: string | Uint8Array) => Promise<boolean>
  }
  fs: {
    readText: (filePath: string) => Promise<string>
  }
  ipcApi: {
    request: (route: string, input?: unknown) => Promise<unknown>
    on: (event: string, callback: (payload: unknown) => void) => () => void
  }
  /** Source DataApi transport consumed by the Cherry compat settings pages. */
  dataApi: {
    request: (request: CherryDataApiRequest) => Promise<CherryDataApiResponse>
    onDataChanged: (callback: (effects: CherryDataApiDataChangeEffect[]) => void) => () => void
  }
  workspace: {
    openPopout: (input: { popoutId: string; panelType: string; title: string; bounds?: { x?: number; y?: number; width?: number; height?: number } }) => Promise<boolean>
    closePopout: (popoutId: string) => Promise<boolean>
    focusPopout: (popoutId: string) => Promise<boolean>
    isPopoutOpen: (popoutId: string) => Promise<boolean>
    loadDocument: (workspaceId: string) => Promise<{ workspaceId: string; revision: number; document: unknown } | null>
    saveDocument: (workspaceId: string, expectedRevision: number, document: unknown) => Promise<{ saved: boolean; conflict?: boolean; value?: { workspaceId: string; revision: number; document: unknown }; current?: { workspaceId: string; revision: number; document: unknown } | null }>
    onDocumentChanged: (callback: (value: { workspaceId: string; revision: number; document: unknown }) => void) => () => void
    loadEditorState: (editorKey: string) => Promise<{ editorKey: string; revision: number; state: unknown } | null>
    prepareTransfer: (input: import('../shared/editor-transfer').EditorTransferInput) => Promise<import('../shared/editor-transfer').EditorTransferResult>
    getTransfer: (id: string) => Promise<import('../shared/editor-transfer').EditorTransferRecord | null>
    pendingTransfers: () => Promise<import('../shared/editor-transfer').EditorTransferRecord[]>
    readyTransfer: (id: string, revision: number) => Promise<import('../shared/editor-transfer').EditorTransferResult>
    commitTransfer: (id: string) => Promise<import('../shared/editor-transfer').EditorTransferResult>
    finishTransfer: (id: string) => Promise<import('../shared/editor-transfer').EditorTransferResult>
    getEditorAccess: (key: string) => Promise<import('../shared/editor-transfer').WorkspaceEditorAccess>
    onEditorAccessChanged: (callback: (value: { editorKey: string }) => void) => () => void
    abortTransfer: (id: string) => Promise<import('../shared/editor-transfer').EditorTransferResult>
    closeTransferredSource: () => Promise<boolean>
    onTransferChanged: (callback: (event: import('../shared/editor-transfer').EditorTransferEvent) => void) => () => void
    onTransferReturnRequested: (callback: () => void) => () => void
    acquireEditLease: (resource: import('../shared/novelai-edit-types').NovelaiEditResource, editorKey: string) => Promise<import('../shared/novelai-edit-types').NovelaiEditLeaseResult>
    heartbeatEditLease: (resource: import('../shared/novelai-edit-types').NovelaiEditResource, editorKey: string, leaseId: string) => Promise<import('../shared/novelai-edit-types').NovelaiEditLeaseResult>
    releaseEditLease: (resource: import('../shared/novelai-edit-types').NovelaiEditResource, editorKey: string, leaseId: string) => Promise<import('../shared/novelai-edit-types').NovelaiEditReleaseResult>
    saveEditorState: (editorKey: string, expectedRevision: number, state: unknown) => Promise<import('../shared/workspace-editor-state').SaveWorkspaceEditorStateResult>
    onEditorStateChanged: (callback: (value: { editorKey: string; revision: number; state: unknown }) => void) => () => void
    onPopoutClosed: (callback: (value: { popoutId: string; bounds?: { x: number; y: number; width: number; height: number } }) => void) => () => void
  }
  agent: {
    sessions: {
      list: () => Promise<AgentSessionRecord[]>
      get: (id: string) => Promise<{ session: AgentSessionRecord; events: AgentSessionEventRecord[] } | null>
      create: (input: { runtime: string; providerId?: string; model?: string; title?: string; parentId?: string; agentId?: string | null; workspace?: AgentSessionWorkspace; attachments?: AgentSessionAttachment[]; snapshot?: AgentSessionSnapshot }) => Promise<AgentSessionRecord>
      appendEvent: (input: { sessionId: string; type: string; data: Record<string, unknown> }) => Promise<AgentSessionEventRecord>
      send: (input: { sessionId: string; content: string; providerId?: string; model?: string }) => Promise<{ text: string; session: AgentSessionRecord }>
      onStream: (callback: (value: { sessionId: string; phase: 'text' | 'reasoning' | 'done' | 'error'; text?: string; status?: string; message?: string }) => void) => () => void
      branch: (input: { sessionId: string; title?: string }) => Promise<AgentSessionRecord>
      update: (input: { id: string; status?: string; title?: string; data?: Record<string, unknown> }) => Promise<AgentSessionRecord>
      attach: (input: { id: string; agentId?: string | null; workspace?: AgentSessionWorkspace; attachments?: AgentSessionAttachment[] }) => Promise<AgentSessionRecord>
      snapshot: (input: { id: string; snapshot: AgentSessionSnapshot }) => Promise<AgentSessionRecord>
      delete: (id: string) => Promise<boolean>
      onPermissionRequest: (callback: (value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => void) => () => void
      decidePermission: (value: { requestId: string; decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel' }) => Promise<boolean>
    }
    stream: {
      open: (input: { sessionId: string; content: string }) => Promise<{ status: 'unavailable'; code: 'AGENT_RUNTIME_UNAVAILABLE'; dependency: string }>
      attach: (input: { leaseId: string; afterOrdinal?: number }) => Promise<unknown>
      abort: (input: { leaseId: string }) => Promise<unknown>
      close: (input: { leaseId: string }) => Promise<unknown>
      onEvent: (callback: (value: { leaseId: string; type: 'update' | 'terminal'; ordinal?: number; update?: unknown; status?: string; error?: string }) => void) => () => void
    }
    mcp: {
      list: () => Promise<McpServerRecord[]>
      save: (input: Partial<McpServerRecord>) => Promise<McpServerRecord>
      delete: (id: string) => Promise<boolean>
      connect: (id: string) => Promise<McpServerRecord>
      disconnect: (id: string) => Promise<McpServerRecord>
      callTool: (input: { serverId: string; name: string; arguments?: Record<string, unknown> }) => Promise<unknown>
    }
  }
  error: {
    getAll: () => Promise<Array<{ id: number; message: string; stack: string; context: string; created_at: string }>>
    log: (message: string, stack?: string, context?: string) => Promise<boolean>
  }
  boot: {
    painted: (payload: { timeOrigin: number; paintMs: number }) => Promise<BootMetrics>
    metrics: () => Promise<BootMetrics>
  }
  storage: {
    cleanupPlan: () => Promise<Array<{ id: string; label: string; paths: string[]; bytes: number; files: number; reason: string; kind: "file" | "directory"; requiresRestart?: boolean }>>
    cleanupApply: (ids: string[]) => Promise<{ moved: number }>
    trashList: () => Promise<Array<{ id: string; label: string; originalPath: string; bytes: number; reason: string; createdAt: string; kind: "file" | "directory" }>>
    trashRestore: (id: string) => Promise<boolean>
    trashPurge: (id?: string) => Promise<{ removed: number; bytes: number }>
    backupsList: () => Promise<Array<{ path: string; bytes: number; createdAt: string }>>
    backupsCreate: () => Promise<{ path: string; bytes: number; createdAt: string }>
    backupsRestore: (filePath: string) => Promise<{ restartRequired: boolean }>
    backupsPrune: () => Promise<number>
    exportBackup: (options?: { includeMedia?: boolean }) => Promise<{ path: string; manifest: BackupManifest } | null>
    exportSelection: (entryIds: string[]) => Promise<{ path: string; manifest: BackupManifest } | null>
    exportDiagnostics: () => Promise<{ path: string; manifest: BackupManifest } | null>
    inspectImport: () => Promise<ImportInspection | null>
    inspectImportPath: (filePath: string) => Promise<ImportInspection>
    applyImport: (payload: { filePath: string; tables?: string[]; conflict?: "skip" | "keep-both" | "overwrite" }) => Promise<ImportApplyResult>
    onTransferProgress: (callback: (progress: TransferProgress) => void) => () => void
    inventory: (options?: { force?: boolean }) => Promise<StorageInventory>
    scanSizes: () => Promise<StorageInventory>
  }
  db: {
    export: () => Promise<boolean>
    import: () => Promise<boolean>
    onReload: (callback: () => void) => () => void
    onRefresh: (callback: () => void) => () => void
    onFocus: (callback: () => void) => () => void
  }
  migration: {
    selectFriendPrompts: () => Promise<{ token: string; fingerprint: string; total: number; additions: number; duplicates: number; skipped: number; warnings: string[]; sample: Array<{ name: string; chapter: string }> } | null>
    importFriendPrompts: (token: string, fingerprint: string) => Promise<{ addedCount: number; total: number; duplicates: Array<unknown>; skipped: number; warnings: string[] }>
  }
  novelai: {
    assets: {
      remove: (id: string, force?: boolean, expectedImageIds?: string[], options?: { edit?: import('../shared/novelai-edit-types').NovelaiEditProof; expectedRevision?: number }) => Promise<boolean>
    }
    metadata: {
      /** Known keys are NovelaiMetadataParams; the record also carries preserved unknown keys. */
      exportTo: (params: Record<string, unknown>) => Promise<NovelaiMetadataExportResult>
      readFrom: () => Promise<NovelaiMetadataReadResult>
    }
  }
  tasks: {
    create: (input: { id?: string; kind: 'wd14' | 'comfyui' | 'ai-vision'; input: unknown; maxRetries?: number }) => Promise<TaskRecord>
    list: (status?: TaskStatus) => Promise<TaskRecord[]>
    get: (id: string) => Promise<TaskRecord>
    cancel: (id: string) => Promise<TaskRecord>
    retry: (id: string) => Promise<TaskRecord>
    onUpdated: (callback: (event: TaskEvent) => void) => () => void
    onSnapshot: (callback: (tasks: TaskRecord[]) => void) => () => void
    subscribe: () => void
  }
  wd14: {
    diagnostics: () => Promise<{ pythonPath: string; pythonAvailable: boolean; runtimeAvailable: boolean; runtimeVersion: string | null; modelDirectory: string; modelDirectoryExists: boolean; modelCount: number; pairedModelCount: number; blockingReason: string | null }>,
    selectModelDirectory: () => Promise<string | null>,
    selectPythonPath: () => Promise<string | null>,
    status: () => Promise<Record<string, unknown>>
    models: () => Promise<{ models: Array<Record<string, unknown>> }>
    switchModel: (modelId: string) => Promise<Record<string, unknown>>
    createTask: (input: { imageId: number; threshold?: number; modelId?: string; modelIds?: string[]; unionMode?: 'union' | 'intersection' }) => Promise<Record<string, unknown>>
    history: {
      list: (input?: { query?: string; status?: 'succeeded' | 'failed'; limit?: number; offset?: number }) => Promise<WD14HistoryRecord[]>
      get: (id: string) => Promise<WD14HistoryRecord | null>
      delete: (id: string) => Promise<boolean>
      clear: () => Promise<boolean>
      readImage: (id: string) => Promise<string | null>
    }
  }
  comfy: {
    objectInfo: () => Promise<Record<string, unknown>>
    remoteWorkflows: () => Promise<string[]>
    importRemoteWorkflow: (handle: string) => Promise<import('../shared/comfy-workflow-types').ComfyPublicWorkflow>
    status: () => Promise<{ online: boolean; comfyui_version: string | null; error?: string }>
    models: () => Promise<{ checkpoints: string[]; unets: string[]; loras: string[] }>
    queue: (promptId?: string) => Promise<ComfyQueue>
    history: (promptId: string) => Promise<ComfyHistoryResult>
    workflows: () => Promise<Array<{ id: string; name: string; analysis: { nodeCount?: number; warnings?: string[] }; bindings: Array<{ key: string; label: string; nodeId: string; field: string; valueType: 'string' | 'number' | 'integer' | 'json' }>; defaults: Record<string, unknown>; source: string; created_at: string; updated_at: string }>>
    importWorkflow: () => Promise<Record<string, unknown> | null>
    deleteWorkflow: (id: string) => Promise<boolean>
    createTask: (workflowId: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>
    quickGenerate: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
  canvas: {
    list: () => Promise<Array<{ id: string; name: string; created_at: string; updated_at: string }>>
    get: (id: string) => Promise<CanvasProject>
    create: (name?: string) => Promise<CanvasProject>
    save: (id: string, name: string, document: CanvasDocument) => Promise<CanvasProject>
    delete: (id: string) => Promise<boolean>
    exportPackage: (id: string, format: 'json' | 'zip') => Promise<boolean>
    importPackage: () => Promise<{ projectId: string; projectName: string; importedImages: number; skippedImages: number; warnings: string[]; importedPromptAssets: number; importedWorkflows: number } | null>
    vendor: {
      list: () => Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string }>>
      get: (id: string) => Promise<unknown>
      create: (title?: string, id?: string) => Promise<unknown>
      save: (id: string, project: unknown) => Promise<unknown>
      delete: (id: string) => Promise<boolean>
    }
  }
}

declare global {
  interface Window {
    api: GrimoireAPI
  }
}

export {}
