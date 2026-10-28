// 魔导书 Grimoire v7 — 预加载桥
import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { Category, Tag, Preset, HistoryItem, ImageRef, ChatMessage, AppSettings, ErrorLog, Provider, ProviderSaveInput } from "../shared/types"
import type { TaskCreateInput, TaskEvent, TaskRecord, TaskStatus } from "../shared/task-types"
import type { CanvasDocument, CanvasProject } from "../shared/canvas-types"
import type { PromptAssetPage, PromptAssetQuery } from "../shared/prompt-asset-types"
import type { AgentSessionAttachment, AgentSessionEventRecord, AgentSessionRecord, AgentSessionSnapshot, AgentSessionWorkspace, McpServerRecord } from "../shared/agent-types"
import type { AiAssistantRecord, AiEventRecord, AiMessageRecord, AiResourceOrderAnchor, AiResourceRecord, AiSessionRecord, AiTopicRecord } from "../shared/ai-types"
import type { CherryCacheEntry, CherryCacheSyncMessage, CherryDataApiDataChangeEffect, CherryDataApiRequest, CherryDataApiResponse } from "../shared/cherry-preload-types"

// Keep the sandboxed preload self-contained at runtime. TypeScript type imports
// disappear from the bundle, but a runtime import would be unavailable to a
// sandboxed Electron preload in the packaged app.
const IPC_CHANNELS = {
  TAGS_GET_ALL: 'tags:getAll', TAGS_CREATE: 'tags:create', TAGS_UPDATE: 'tags:update', TAGS_DELETE: 'tags:delete', TAGS_IMPORT: 'tags:import', TAGS_RESET: 'tags:reset', TAGS_SEARCH: 'tags:search', TAGS_GET_INTELLIGENCE: 'tags:getIntelligence', TAG_ALIASES_LIST: 'tags:aliases:list', TAG_ALIASES_CREATE: 'tags:aliases:create', TAG_ALIASES_DELETE: 'tags:aliases:delete', TAG_RELATIONS_LIST: 'tags:relations:list', TAG_RELATIONS_CREATE: 'tags:relations:create', TAG_RELATIONS_UPDATE: 'tags:relations:update', TAG_RELATIONS_DELETE: 'tags:relations:delete', TAG_SUGGESTIONS_LIST: 'tags:suggestions:list', TAG_SUGGESTIONS_CREATE: 'tags:suggestions:create', TAG_SUGGESTIONS_ACCEPT: 'tags:suggestions:accept', TAG_SUGGESTIONS_REJECT: 'tags:suggestions:reject', TAG_SUGGESTIONS_MAP: 'tags:suggestions:map', TAG_ASSET_LINKS_LIST: 'tags:assetLinks:list', TAG_ASSET_LINKS_ASSIGN: 'tags:assetLinks:assign', TAG_ASSET_LINKS_REMOVE: 'tags:assetLinks:remove', TAG_ASSET_LINKS_BATCH_ASSIGN: 'tags:assetLinks:batchAssign', TAG_ASSET_LINKS_BATCH_REMOVE: 'tags:assetLinks:batchRemove', TAG_SUGGESTIONS_BATCH_RESOLVE: 'tags:suggestions:batchResolve', TAGS_SEARCH_ADVANCED: 'tags:searchAdvanced', TAGS_EXPAND_RELATIONS: 'tags:expandRelations', TAGS_QUERY_ASSETS: 'tags:assets:query', TAG_ASSET_LINKS_LIST_BATCH: 'tags:assetLinks:listBatch', TAGS_BATCH_PREVIEW: 'tags:assets:batchPreview', TAGS_BATCH_APPLY: 'tags:assets:batchApply', TAGS_SAVED_SEARCHES_LIST: 'tags:savedSearches:list', TAGS_SAVED_SEARCHES_SAVE: 'tags:savedSearches:save', TAGS_SAVED_SEARCHES_DELETE: 'tags:savedSearches:delete', SHELL_SHOW_ITEM: 'system:showItemInFolder',
  CATEGORY_CREATE: 'category:create', CATEGORY_UPDATE: 'category:update', CATEGORY_DELETE: 'category:delete', SUBCATEGORY_CREATE: 'subcategory:create', SUBCATEGORY_UPDATE: 'subcategory:update', SUBCATEGORY_DELETE: 'subcategory:delete',
  PRESETS_LIST: 'presets:list', PRESETS_SAVE: 'presets:save', PRESETS_DELETE: 'presets:delete',
  HISTORY_LIST: 'history:list', HISTORY_ADD: 'history:add', HISTORY_CLEAR: 'history:clear',
  PROMPT_ASSETS_LIST: 'promptAssets:list', PROMPT_ASSETS_CREATE: 'promptAssets:create', PROMPT_ASSETS_DELETE: 'promptAssets:delete', PROMPT_ASSET_CATEGORIES_LIST: 'promptAssetCategories:list', PROMPT_ASSET_CATEGORIES_CREATE: 'promptAssetCategories:create', PROMPT_ASSET_CATEGORIES_RENAME: 'promptAssetCategories:rename', PROMPT_ASSET_CATEGORIES_DELETE: 'promptAssetCategories:delete', PROMPT_ASSET_CATEGORIES_ASSIGN: 'promptAssetCategories:assign', PROMPT_ASSET_CATEGORIES_MOVE: 'promptAssetCategories:move', SETTINGS_GET_ALL: 'settings:getAll', SETTINGS_SET: 'settings:set', OPEN_EXTERNAL: 'system:openExternal',
  IMAGES_LIST: 'images:list', IMAGES_LIST_PAGED: 'images:listPaged', IMAGES_ADD: 'images:add', IMAGES_DELETE: 'images:delete', IMAGES_IMPORT_DATA: 'images:importData', IMAGES_READ_DATA: 'images:readData', MEDIA_LIST: 'media:list', MEDIA_GET: 'media:get', MEDIA_SEARCH: 'media:search', MEDIA_UPDATE: 'media:update', MEDIA_DELETE: 'media:delete', MEDIA_RELOCATE: 'media:relocate', MEDIA_BATCH_UPDATE: 'media:batchUpdate', MEDIA_BATCH_DELETE: 'media:batchDelete', MEDIA_RELATIONS_LIST: 'media:relations:list', MEDIA_RELATIONS_CREATE: 'media:relations:create', MEDIA_RELATIONS_DELETE: 'media:relations:delete', MEDIA_METADATA_GET: 'media:metadata:get', MEDIA_METADATA_SAVE: 'media:metadata:save', MEDIA_QUERY: 'media:query', MEDIA_THUMBS_LIST: 'media:thumbs:list', MEDIA_METADATA_PARSE: 'media:metadata:parse', MEDIA_METADATA_SCAN: 'media:metadata:scan', MEDIA_SCAN_PROGRESS: 'media:scan:progress', MEDIA_BATCH_PREVIEW: 'media:batchPreview', MEDIA_SIMILARITY: 'media:similarity', MEDIA_SIMILARITY_INDEX: 'media:similarity:index', MEDIA_SIMILARITY_PROGRESS: 'media:similarity:progress', MEDIA_DUPLICATES: 'media:duplicates', MEDIA_FOLDER_SCAN: 'media:folderScan', MEDIA_FOLDER_IMPORT: 'media:folderImport', MEDIA_CLIP_DIAGNOSTICS: 'media:clip:diagnostics', MEDIA_CLIP_SELECT_MODEL_DIRECTORY: 'media:clip:selectModelDirectory', MEDIA_CLIP_SELECT_PYTHON_PATH: 'media:clip:selectPythonPath', TAG_METADATA_GET: 'tags:metadata:get', TAG_METADATA_SAVE: 'tags:metadata:save', TAG_METADATA_LIST: 'tags:metadata:list',
  AI_CHAT: 'ai:chat', AI_VISION: 'ai:vision', AI_CHAT_HISTORY: 'ai:chatHistory', AI_ATTACHMENT_SELECT: 'ai:attachment:select', AI_ATTACHMENT_LIST: 'ai:attachment:list', AI_ATTACHMENT_IMPORT: 'ai:attachment:import', AI_ATTACHMENT_DELETE: 'ai:attachment:delete', AI_ATTACHMENT_READ: 'ai:attachment:read', AI_ASSISTANT_LIST: 'ai:assistant:list', AI_ASSISTANT_SAVE: 'ai:assistant:save', AI_ASSISTANT_DELETE: 'ai:assistant:delete', AI_ASSISTANT_ARCHIVE: 'ai:assistant:archive', AI_ASSISTANT_RESTORE: 'ai:assistant:restore', AI_ASSISTANT_PIN: 'ai:assistant:pin', AI_ASSISTANT_REORDER: 'ai:assistant:reorder', AI_TOPIC_LIST: 'ai:topic:list', AI_TOPIC_SAVE: 'ai:topic:save', AI_TOPIC_DELETE: 'ai:topic:delete', AI_TOPIC_ARCHIVE: 'ai:topic:archive', AI_TOPIC_RESTORE: 'ai:topic:restore', AI_TOPIC_PIN: 'ai:topic:pin', AI_TOPIC_REORDER: 'ai:topic:reorder', AI_TOPIC_LATEST: 'ai:topic:latest',
  ERROR_LOG: 'error:log', ERROR_GET_ALL: 'error:getAll', DB_EXPORT: 'db:export', DB_IMPORT: 'db:import',
  DIALOG_SAVE_TEXT: 'dialog:saveText', DIALOG_OPEN_TEXT: 'dialog:openText', DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
  PROVIDERS_LIST: 'providers:list', PROVIDERS_SAVE: 'providers:save', PROVIDERS_DELETE: 'providers:delete', PROVIDERS_SET_ACTIVE: 'providers:setActive', PROVIDERS_FETCH_MODELS: 'providers:fetchModels', PROVIDERS_TEST: 'providers:test', PROVIDERS_FETCH_MODELS_FOR: 'providers:fetchModelsFor', PROVIDERS_TEST_FOR: 'providers:testFor',
  TAG_GROUPS_LIST: 'tagGroups:list', TAG_GROUPS_CREATE: 'tagGroups:create', TAG_GROUPS_DELETE: 'tagGroups:delete', TAG_GROUPS_RENAME: 'tagGroups:rename', TAG_GROUPS_COPY: 'tagGroups:copy', TAG_GROUPS_IMPORT: 'tagGroups:import', TAG_GROUPS_EXPORT: 'tagGroups:export', TAG_GROUPS_SET_ACTIVE: 'tagGroups:setActive',
  FAV_TAG_LIST: 'fav:tagList', FAV_TAG_ADD: 'fav:tagAdd', FAV_TAG_REMOVE: 'fav:tagRemove', FAV_TAG_CHECK: 'fav:tagCheck', FAV_SUB_LIST: 'fav:subList', FAV_SUB_ADD: 'fav:subAdd', FAV_SUB_REMOVE: 'fav:subRemove', FAV_SUB_CHECK: 'fav:subCheck',
  MIGRATION_SELECT_FRIEND_PROMPTS: 'migration:selectFriendPrompts', MIGRATION_IMPORT_FRIEND_PROMPTS: 'migration:importFriendPrompts',
  TASKS_CREATE: 'tasks:create', TASKS_LIST: 'tasks:list', TASKS_GET: 'tasks:get', TASKS_CANCEL: 'tasks:cancel', TASKS_RETRY: 'tasks:retry', TASKS_SUBSCRIBE: 'tasks:subscribe',
  WD14_STATUS: 'wd14:status', WD14_MODELS: 'wd14:models', WD14_SWITCH_MODEL: 'wd14:switchModel', WD14_CREATE_TASK: 'wd14:createTask', WD14_DIAGNOSTICS: 'wd14:diagnostics', WD14_SELECT_MODEL_DIRECTORY: 'wd14:selectModelDirectory', WD14_SELECT_PYTHON_PATH: 'wd14:selectPythonPath', WD14_HISTORY_LIST: 'wd14:history:list', WD14_HISTORY_GET: 'wd14:history:get', WD14_HISTORY_DELETE: 'wd14:history:delete', WD14_HISTORY_CLEAR: 'wd14:history:clear', WD14_HISTORY_READ_IMAGE: 'wd14:history:readImage', AGENT_SESSION_LIST: 'agent:session:list', AGENT_SESSION_GET: 'agent:session:get', AGENT_SESSION_CREATE: 'agent:session:create', AGENT_SESSION_APPEND_EVENT: 'agent:session:appendEvent', AGENT_SESSION_SEND: 'agent:session:send', AGENT_SESSION_STREAM: 'agent:session:stream', CHERRY_AI_STREAM_EVENT: 'cherry:ai:stream:event', AGENT_SESSION_BRANCH: 'agent:session:branch', AGENT_SESSION_UPDATE: 'agent:session:update', AGENT_SESSION_ATTACH: 'agent:session:attach', AGENT_SESSION_SNAPSHOT: 'agent:session:snapshot', AGENT_SESSION_DELETE: 'agent:session:delete', AGENT_PERMISSION_REQUEST: 'agent:permissionRequest', AGENT_PERMISSION_DECISION: 'agent:permissionDecision', AI_SESSION_LIST: 'ai:session:list', AI_SESSION_ARCHIVE: 'ai:session:archive', AI_SESSION_RESTORE: 'ai:session:restore', AI_SESSION_PIN: 'ai:session:pin', AI_SESSION_REORDER: 'ai:session:reorder', AI_SESSION_LATEST: 'ai:session:latest', AI_SESSION_GET: 'ai:session:get', NOVELAI_WORK_LIST: 'novelai:work:list', NOVELAI_WORK_CREATE: 'novelai:work:create', NOVELAI_WORK_BUNDLE: 'novelai:work:bundle', NOVELAI_VERSION_LINE: 'novelai:version:line', NOVELAI_VERSION_CREATE: 'novelai:version:create', NOVELAI_VERSION_DELETE: 'novelai:version:delete', NOVELAI_VERSION_RESTORE: 'novelai:version:restore', NOVELAI_BRANCH_RENAME: 'novelai:branch:rename', NOVELAI_BRANCH_LIST: 'novelai:branch:list', NOVELAI_ASSET_LIST: 'novelai:asset:list', NOVELAI_ASSET_CREATE: 'novelai:asset:create', NOVELAI_ASSET_UPDATE: 'novelai:asset:update', NOVELAI_ASSET_DELETE: 'novelai:asset:delete', NOVELAI_ASSET_USE: 'novelai:asset:use', NOVELAI_ASSET_IMAGES: 'novelai:asset:images', NOVELAI_ASSET_BY_IMAGE: 'novelai:asset:byImage', NOVELAI_ASSET_BY_VERSION: 'novelai:asset:byVersion', NOVELAI_ASSET_VERSIONS: 'novelai:asset:versions', NOVELAI_VERSION_LINK_IMAGE: 'novelai:version:linkImage', NOVELAI_VERSION_DELETE_MANY: 'novelai:version:deleteMany', NOVELAI_VERSION_RESTORE_MANY: 'novelai:version:restoreMany', NOVELAI_METADATA_EXPORT: 'novelai:metadata:export', NOVELAI_METADATA_IMPORT: 'novelai:metadata:import', FILE_BRIDGE_SELECT: 'file:select', FILE_BRIDGE_READ_EXTERNAL: 'file:readExternal', FILE_BRIDGE_OPEN_PATH: 'file:openPath', FILE_BRIDGE_SAVE: 'file:save', FILE_BRIDGE_GET: 'file:get', FILE_BRIDGE_METADATA: 'file:getMetadata', FILE_BRIDGE_READ_TEXT: 'file:readText', FILE_BRIDGE_TEMP_CREATE: 'file:createTempFile', FILE_BRIDGE_TEMP_WRITE: 'file:writeTempFile', CHERRY_DATA_API_REQUEST: 'cherry:dataApi:request', CHERRY_IPC_API_REQUEST: 'cherry:ipcApi:request', CHERRY_APP_RELAUNCH: 'cherry:app:relaunch', CHERRY_MCP_TOOL_PROGRESS: 'cherry:mcp:toolProgress', CHERRY_NATIVE_THEME_UPDATED: 'cherry:system:nativeThemeUpdated', CHERRY_NAVIGATION_OPEN_ROUTE: 'cherry:navigation:openRouteRequested', CHERRY_FILE_TREE_MUTATION: 'cherry:file:treeMutation', AI_SESSION_CREATE: 'ai:session:create', AI_SESSION_IMPORT: 'ai:session:import', AI_SESSION_UPDATE: 'ai:session:update', AI_SESSION_DELETE: 'ai:session:delete', AI_SESSION_BRANCH: 'ai:session:branch', AI_SESSION_SEND: 'ai:session:send', AI_SESSION_INTERRUPT: 'ai:session:interrupt', AI_SESSION_RETRY: 'ai:session:retry', AI_SESSION_COMPACT: 'ai:session:compact', AI_SESSION_SEARCH: 'ai:session:search', AI_SESSION_APPEND_MESSAGE: 'ai:session:appendMessage', AI_MESSAGE_UPDATE: 'ai:message:update', AI_MESSAGE_DELETE: 'ai:message:delete', AI_SESSION_APPEND_EVENT: 'ai:session:appendEvent', AI_SESSION_EVENT: 'ai:session:event', AI_PERMISSION_REQUEST: 'ai:permission:request', AI_PERMISSION_DECISION: 'ai:permission:decision', AI_CATALOG_PROVIDERS: 'ai:catalog:providers', AI_CATALOG_MODELS: 'ai:catalog:models', AI_RUNTIME_STATUS: 'ai:runtime:status', AI_RUNTIME_CAPABILITIES: 'ai:runtime:capabilities', AI_RUNTIME_PREPARE: 'ai:runtime:prepare', MCP_SERVER_LIST: 'mcp:server:list', MCP_SERVER_SAVE: 'mcp:server:save', MCP_SERVER_DELETE: 'mcp:server:delete', MCP_SERVER_CONNECT: 'mcp:server:connect', MCP_SERVER_DISCONNECT: 'mcp:server:disconnect', MCP_SERVER_CALL_TOOL: 'mcp:server:callTool', CHERRY_AGENT_STREAM_OPEN: 'cherry:agent:stream:open', CHERRY_AGENT_STREAM_ATTACH: 'cherry:agent:stream:attach', CHERRY_AGENT_STREAM_ABORT: 'cherry:agent:stream:abort', CHERRY_AGENT_STREAM_CLOSE: 'cherry:agent:stream:close', CHERRY_AGENT_STREAM_EVENT: 'cherry:agent:stream:event',
  COMFY_STATUS: 'comfy:status', COMFY_MODELS: 'comfy:models', COMFY_WORKFLOWS_LIST: 'comfy:workflows:list', COMFY_WORKFLOW_IMPORT: 'comfy:workflows:import', COMFY_WORKFLOW_DELETE: 'comfy:workflows:delete', COMFY_CREATE_TASK: 'comfy:createTask', COMFY_QUICK_GENERATE: 'comfy:quickGenerate',
  CANVAS_LIST: 'canvas:list', CANVAS_GET: 'canvas:get', CANVAS_CREATE: 'canvas:create', CANVAS_SAVE: 'canvas:save', CANVAS_DELETE: 'canvas:delete', CANVAS_EXPORT_PACKAGE: 'canvas:exportPackage', CANVAS_IMPORT_PACKAGE: 'canvas:importPackage',
  CANVAS_VENDOR_LIST: 'canvasVendor:list', CANVAS_VENDOR_GET: 'canvasVendor:get', CANVAS_VENDOR_CREATE: 'canvasVendor:create', CANVAS_VENDOR_SAVE: 'canvasVendor:save', CANVAS_VENDOR_DELETE: 'canvasVendor:delete', WORKSPACE_OPEN_POPOUT: 'workspace:openPopout', WORKSPACE_CLOSE_POPOUT: 'workspace:closePopout', WORKSPACE_FOCUS_POPOUT: 'workspace:focusPopout', WORKSPACE_LOAD_DOCUMENT: 'workspace:loadDocument', WORKSPACE_SAVE_DOCUMENT: 'workspace:saveDocument', WORKSPACE_DOCUMENT_CHANGED: 'workspace:documentChanged', WORKSPACE_LOAD_EDITOR_STATE: 'workspace:loadEditorState', WORKSPACE_SAVE_EDITOR_STATE: 'workspace:saveEditorState', WORKSPACE_EDITOR_STATE_CHANGED: 'workspace:editorStateChanged', WORKSPACE_POPOUT_CLOSED: 'workspace:popoutClosed',
} as const

const api = {
  meta: {
    apiVersion: '2026.10-agent-2',
    capabilities: {
      unifiedSessions: true,
      attachments: true,
      catalog: true,
      runtimes: true,
      mcp: true,
    },
  },
  tags: {
    getAll: (): Promise<{ categories: Category[]; subcategories: unknown[]; tags: Tag[] }> =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_ALL),
    create: (data: { subcategory_id: string; en: string; zh: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, data),
    update: (data: { id: string; en: string; zh: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_UPDATE, data),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, id),
    import: (jsonData: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAGS_IMPORT, jsonData),
    reset: () => ipcRenderer.invoke("tags:reset"),
    createCategory: (data: { zh: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORY_CREATE, data),
    updateCategory: (data: { id: string; zh: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORY_UPDATE, data),
    deleteCategory: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CATEGORY_DELETE, id),
    createSubcategory: (data: { category_id: string; zh: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBCATEGORY_CREATE, data),
    updateSubcategory: (data: { id: string; zh: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBCATEGORY_UPDATE, data),
    deleteSubcategory: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBCATEGORY_DELETE, id),
    search: (input: { query?: string; limit?: number; includeDisabled?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_SEARCH, input),
    getIntelligence: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_INTELLIGENCE, id),
    aliases: {
      list: (tagId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ALIASES_LIST, tagId),
      create: (input: { tagId: string; alias: string; language?: string; source?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ALIASES_CREATE, input),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ALIASES_DELETE, id),
    },
    relations: {
      list: (tagId?: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_RELATIONS_LIST, tagId),
      create: (input: { sourceTagId: string; targetTagId: string; relationType: string; confidence?: number; source?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_RELATIONS_CREATE, input),
      update: (input: { id: string; confidence?: number; enabled?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_RELATIONS_UPDATE, input),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_RELATIONS_DELETE, id),
    },
    suggestions: {
      list: (input?: { assetType?: string; assetKey?: string; status?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_SUGGESTIONS_LIST, input || {}),
      create: (input: { assetType: string; assetKey: string; values: Array<{ value: string; confidence?: number; namespace?: string }>; source: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_SUGGESTIONS_CREATE, input),
      accept: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_SUGGESTIONS_ACCEPT, id),
      reject: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_SUGGESTIONS_REJECT, id),
      map: (input: { id: string; tagId: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_SUGGESTIONS_MAP, input),
      batchResolve: (input: { ids: string[]; action: 'accept' | 'reject' | 'ignore'; tagId?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_SUGGESTIONS_BATCH_RESOLVE, input),
    },
    assetLinks: {
      list: (input: { assetType: string; assetKey: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ASSET_LINKS_LIST, input),
      assign: (input: { assetType: string; assetKey: string; tagId: string; polarity?: string; weight?: number; confidence?: number; source?: string; status?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ASSET_LINKS_ASSIGN, input),
      remove: (input: { assetType: string; assetKey: string; tagId: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ASSET_LINKS_REMOVE, input),
      batchAssign: (input: { assetType: string; assetKeys: string[]; tagIds: string[]; source?: string; confidence?: number; polarity?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ASSET_LINKS_BATCH_ASSIGN, input),
      batchRemove: (input: { assetType: string; assetKeys: string[]; tagIds: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ASSET_LINKS_BATCH_REMOVE, input),
      listBatch: (input: { assetType: string; assetKeys: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_ASSET_LINKS_LIST_BATCH, input),
    },
    searchAdvanced: (input: { query?: string; limit?: number; mode?: 'substring' | 'prefix'; namespace?: string; sort?: 'score' | 'usage' | 'alpha' }) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_SEARCH_ADVANCED, input || {}),
    expandRelations: (input: { tagIds: string[]; maxDepth?: number; direction?: 'forward' | 'descendants' }) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_EXPAND_RELATIONS, input),
    queryAssets: (input: { filter: { assetType: string; tagIds: string[]; logic?: 'any' | 'all' | 'none'; polarity?: string; includeImplied?: boolean }; page?: { limit?: number; offset?: number } }) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_QUERY_ASSETS, input),
    batchPreview: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_BATCH_PREVIEW, input),
    batchApply: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_BATCH_APPLY, input),
    savedSearches: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.TAGS_SAVED_SEARCHES_LIST),
      save: (input: { name: string; queryJson?: string; sortJson?: string; viewMode?: string; pinned?: boolean; id?: string }) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_SAVED_SEARCHES_SAVE, input),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_SAVED_SEARCHES_DELETE, id),
    },
    metadata: {
      get: (tagId: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_METADATA_GET, tagId),
      save: (input: { tagId: string; namespace?: string; description?: string; color?: string; isActive?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.TAG_METADATA_SAVE, input),
      list: (tagIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.TAG_METADATA_LIST, tagIds),
    },
  },

  presets: {
    list: (): Promise<Preset[]> => ipcRenderer.invoke(IPC_CHANNELS.PRESETS_LIST),
    save: (data: { id?: string; name: string; data: object }) => ipcRenderer.invoke(IPC_CHANNELS.PRESETS_SAVE, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PRESETS_DELETE, id),
  },

  history: {
    list: (): Promise<HistoryItem[]> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST),
    add: (data: { prompt: string; positive_count: number; negative_count: number }) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_ADD, data),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR),
  },

  promptAssets: {
    list: (query: PromptAssetQuery = {}): Promise<PromptAssetPage> => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSETS_LIST, query),
    create: (input: { name: string; prompt: string; detail?: string; sourceId?: string; nsfw?: boolean; variantCount?: number }) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSETS_CREATE, input),
    delete: (sourceId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSETS_DELETE, sourceId),
    categories: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_LIST),
      create: (input: { name: string; parentId?: string | null; sourceScope?: string }) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_CREATE, input),
      rename: (input: { id: string; name: string }) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_RENAME, input),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_DELETE, id),
      assign: (input: { assetId: string; categoryId: string }) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_ASSIGN, input),
      move: (input: { id: string; parentId: string | null }) => ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_MOVE, input),
    },
  },

  theme: {
    // The main renderer publishes its resolved palette; main broadcasts it to every window.
    publish: (palette: { mode: 'light' | 'dark'; vars: Record<string, string> }) => ipcRenderer.invoke('theme:publish', palette),
    get: (): Promise<{ mode: 'light' | 'dark'; vars: Record<string, string> } | null> => ipcRenderer.invoke('theme:get'),
    onChanged: (callback: (palette: { mode: 'light' | 'dark'; vars: Record<string, string> }) => void) => {
      const handler = (_event: unknown, palette: { mode: 'light' | 'dark'; vars: Record<string, string> }) => callback(palette)
      ipcRenderer.on('theme:changed', handler)
      return () => { ipcRenderer.removeListener('theme:changed', handler) }
    },
  },
  settings: {
    getAll: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  },
  system: {
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
    showItemInFolder: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SHOW_ITEM, filePath),
  },

  images: {
    list: (): Promise<ImageRef[]> => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_LIST),
    listPaged: (input?: { limit?: number; offset?: number }): Promise<{ items: ImageRef[]; total: number; limit: number; offset: number }> => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_LIST_PAGED, input || {}),
    add: (mode: 'managed' | 'external' = 'managed') => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_ADD, mode),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_DELETE, id),
    importData: (dataBase64: string, originalName: string) => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_IMPORT_DATA, dataBase64, originalName),
    readData: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_READ_DATA, id) as Promise<string>,
  },
  media: {
    list: (input?: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_LIST, input || {}),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_GET, id),
    search: (input?: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_SEARCH, input || {}),
    update: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_UPDATE, input),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_DELETE, id),
    relocate: (input: { id: string; filePath: string }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_RELOCATE, input),
    batchUpdate: (input: { ids: string[]; favorite?: boolean; rating?: number }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_BATCH_UPDATE, input),
    batchDelete: (input: { ids: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_BATCH_DELETE, input),
    metadata: {
      get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_METADATA_GET, id),
      save: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_METADATA_SAVE, input),
      parse: (input: { mediaId: string; persist?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_METADATA_PARSE, input),
      scan: (input?: { batchSize?: number }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_METADATA_SCAN, input || {}),
    },
    relations: {
      list: (input: { type: string; key: string }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_RELATIONS_LIST, input),
      create: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_RELATIONS_CREATE, input),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_RELATIONS_DELETE, id),
    },
    query: (input: { query?: Record<string, unknown>; page?: { limit?: number; offset?: number } }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_QUERY, input || {}),
    thumbs: (input: { ids: number[]; kind?: 'thumbnail' | 'preview' }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_THUMBS_LIST, input),
    batchPreview: (input: { ids?: string[]; query?: Record<string, unknown> }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_BATCH_PREVIEW, input || {}),
    onScanProgress: (callback: (value: { done: number; total: number }) => void) => {
      const listener = (_event: unknown, value: { done: number; total: number }) => callback(value)
      ipcRenderer.on(IPC_CHANNELS.MEDIA_SCAN_PROGRESS, listener as never)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.MEDIA_SCAN_PROGRESS, listener as never) }
    },
    similarity: (input: { imageRefId: number; limit?: number; method?: 'auto' | 'hash' | 'clip'; maxDistance?: number }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_SIMILARITY, input),
    indexSimilarity: (input?: { batchSize?: number }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_SIMILARITY_INDEX, input || {}),
    onSimilarityProgress: (callback: (value: { done: number; total: number }) => void) => {
      const listener = (_event: unknown, value: { done: number; total: number }) => callback(value)
      ipcRenderer.on(IPC_CHANNELS.MEDIA_SIMILARITY_PROGRESS, listener as never)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.MEDIA_SIMILARITY_PROGRESS, listener as never) }
    },
    duplicates: (input?: { maxDistance?: number; limit?: number; page?: number }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_DUPLICATES, input || {}),
    folderScan: (input: { directory: string; recursive?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_FOLDER_SCAN, input),
    folderImport: (input: { filePaths: string[]; mode?: 'managed' | 'external' }) => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_FOLDER_IMPORT, input),
    clip: {
      diagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_CLIP_DIAGNOSTICS),
      selectModelDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_CLIP_SELECT_MODEL_DIRECTORY),
      selectPythonPath: () => ipcRenderer.invoke(IPC_CHANNELS.MEDIA_CLIP_SELECT_PYTHON_PATH),
    },
  },

  ai: {
    sendMessage: (args: { providerId: string; model: string; messages: Array<{ role: string; content: any }> }) =>
      ipcRenderer.invoke('ai:sendMessage', args),
    vision: (args: { providerId: string; model: string; imageBase64: string; prompt?: string }) =>
      ipcRenderer.invoke('ai:vision', args),
    generateImage: (args: { providerId: string; model: string; prompt: string }) =>
      ipcRenderer.invoke('ai:generateImage', args),
    fetchModels: (args: { baseUrl: string; apiKey: string }) =>
      ipcRenderer.invoke('ai:fetchModels', args),
    onChunk: (callback: (data: any) => void) => {
      const handler = (_event: unknown, data: any) => callback(data)
      ipcRenderer.on('ai:chunk', handler)
      return () => ipcRenderer.removeListener('ai:chunk', handler)
    },
    sessions: {
      list: (input?: { query?: string; kind?: string; limit?: number; includeArchived?: boolean; manualOrder?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_LIST, input || {}),
      archive: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_ARCHIVE, id),
      restore: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_RESTORE, id),
      pin: (id: string, pinned: boolean) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_PIN, { id, pinned }),
      reorder: (input: { id: string; overId: string; position: 'before' | 'after' | 'last' }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_REORDER, input),
      latest: (input?: { kind?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_LATEST, input || {}),
      get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_GET, id),
      create: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_CREATE, input),
      import: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_IMPORT, input),
      update: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_UPDATE, input),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_DELETE, id),
      branch: (input: { sessionId: string; title?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_BRANCH, input),
      send: (input: { sessionId: string; content: string; modelId?: string; attachments?: unknown[]; context?: unknown[] }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_SEND, input),
      interrupt: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_INTERRUPT, sessionId),
      retry: (input: string | { sessionId: string; messageId?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_RETRY, input),
      compact: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_COMPACT, sessionId),
      search: (input?: { query?: string; kind?: string; limit?: number }) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_SEARCH, input || {}),
      catalog: {
        providers: (input?: { query?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_CATALOG_PROVIDERS, input || {}),
        models: (input?: { query?: string; providerId?: string; capability?: string; limit?: number }) => ipcRenderer.invoke(IPC_CHANNELS.AI_CATALOG_MODELS, input || {}),
      },
      runtimes: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.AI_RUNTIME_STATUS),
        capabilities: (kind: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_RUNTIME_CAPABILITIES, kind),
        prepare: (kind: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_RUNTIME_PREPARE, kind),
      },
      appendMessage: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_APPEND_MESSAGE, input),
      updateMessage: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.AI_MESSAGE_UPDATE, input),
      deleteMessage: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_MESSAGE_DELETE, id),
      appendEvent: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.AI_SESSION_APPEND_EVENT, input),
      onEvent: (callback: (value: { kind: 'message' | 'message-deleted' | 'event' | 'delta' | 'resource'; sessionId?: string; messageId?: string; text?: string; record?: AiMessageRecord | AiEventRecord | AiResourceRecord }) => void) => {
        const handler = (_event: unknown, value: { kind: 'message' | 'message-deleted' | 'event' | 'delta' | 'resource'; sessionId?: string; messageId?: string; text?: string; record?: AiMessageRecord | AiEventRecord | AiResourceRecord }) => callback(value)
        ipcRenderer.on(IPC_CHANNELS.AI_SESSION_EVENT, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_SESSION_EVENT, handler)
      },
      onPermissionRequest: (callback: (value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => void) => {
        const handler = (_event: unknown, value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => callback(value)
        ipcRenderer.on(IPC_CHANNELS.AI_PERMISSION_REQUEST, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.AI_PERMISSION_REQUEST, handler)
      },
      decidePermission: (value: { requestId: string; decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel' }) => ipcRenderer.invoke(IPC_CHANNELS.AI_PERMISSION_DECISION, value),
      attachments: {
        select: () => ipcRenderer.invoke(IPC_CHANNELS.AI_ATTACHMENT_SELECT) as Promise<string | null>,
        list: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_ATTACHMENT_LIST, sessionId),
        import: (input: { sessionId: string; filePath: string; sourceType?: string; messageId?: string | null }) => ipcRenderer.invoke(IPC_CHANNELS.AI_ATTACHMENT_IMPORT, input),
        delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_ATTACHMENT_DELETE, id),
        read: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_ATTACHMENT_READ, id),
      },
      assistants: {
        list: (input?: { includeArchived?: boolean; manualOrder?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_LIST, input || {}) as Promise<AiAssistantRecord[]>,
        save: (input: Partial<AiAssistantRecord> & { id?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_SAVE, input) as Promise<AiAssistantRecord>,
        delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_DELETE, id) as Promise<boolean>,
        archive: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_ARCHIVE, id) as Promise<AiAssistantRecord>,
        restore: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_RESTORE, id) as Promise<AiAssistantRecord>,
        pin: (id: string, pinned: boolean) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_PIN, { id, pinned }) as Promise<AiAssistantRecord>,
        reorder: (input: { id: string; anchor: AiResourceOrderAnchor }) => ipcRenderer.invoke(IPC_CHANNELS.AI_ASSISTANT_REORDER, input) as Promise<AiAssistantRecord>,
      },
      topics: {
        list: (input: { sessionId: string; includeArchived?: boolean; manualOrder?: boolean }) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_LIST, input) as Promise<AiTopicRecord[]>,
        save: (input: Partial<AiTopicRecord> & { session_id: string; id?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_SAVE, input) as Promise<AiTopicRecord>,
        delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_DELETE, id) as Promise<boolean>,
        archive: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_ARCHIVE, id) as Promise<AiTopicRecord>,
        restore: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_RESTORE, id) as Promise<AiTopicRecord>,
        pin: (id: string, pinned: boolean) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_PIN, { id, pinned }) as Promise<AiTopicRecord>,
        reorder: (input: { id: string; anchor: AiResourceOrderAnchor; ownerId?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_REORDER, input) as Promise<AiTopicRecord>,
        latest: (input?: { sessionId?: string | null }) => ipcRenderer.invoke(IPC_CHANNELS.AI_TOPIC_LATEST, input || {}) as Promise<AiTopicRecord | null>,
      },
    },
  },

  // File bridge for the Cherry compat composer (source `window.api.file` / `fs`).
  // `getPathForFile` is synchronous because Electron 42 `webUtils` must run in the
  // preload; every path-consuming call resolves inside the main process.
  file: {
    getPathForFile: (file: File): string => {
      try { return webUtils.getPathForFile(file) } catch { return '' }
    },
    // Source order/result: filename FIRST, selected path or null; failures reject.
    save: (fileName: string, content: string | Uint8Array, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_SAVE, fileName, content, options),
    openPath: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_OPEN_PATH, filePath),
    get: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_GET, filePath),
    getMetadata: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_METADATA, filePath),
    createTempFile: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_TEMP_CREATE, name) as Promise<string>,
    write: (filePath: string, data: string | Uint8Array) => ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_TEMP_WRITE, { path: filePath, data }),
    // Source `window.api.file.selectFolder`: a native directory picker returning the
    // chosen path or null (a bare value, NOT an IpcResult envelope — the source contract
    // at `FileStorage.selectFolder` resolves `string | null`).
    //
    // Routed through the Cherry IPC surface because that handler already owns the
    // validation and the dialog; a second dialog implementation here would drift from it.
    // A failed call resolves to `null` rather than throwing: the source call sites treat
    // null as "user cancelled" and a rejection would surface as an error toast.
    selectFolder: async (options?: { title?: string; properties?: string[] }): Promise<string | null> => {
      try {
        const result = await ipcRenderer.invoke(IPC_CHANNELS.CHERRY_IPC_API_REQUEST, {
          route: 'system.file.select_folder',
          input: options || {}
        }) as { ok?: boolean; data?: unknown } | null
        if (!result || result.ok !== true) return null
        return typeof result.data === 'string' ? result.data : null
      } catch {
        return null
      }
    },
  },
  fs: {
    readText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_READ_TEXT, filePath) as Promise<string>,
  },
  // Source Cherry preload path helpers: `window.api.resolvePath` / `isPathInside` /
  // `hasWritePermission` (channels `app:resolve-path`, `app:is-path-inside`,
  // `app:has-write-permission`). The data-settings backup panels call these directly —
  // `LocalBackupSettings` resolves a configured directory in a `useEffect`, so an absent
  // helper is a crash the moment a user has a backup dir, not merely a dead button.
  //
  // These return BARE values, not an `IpcResult` envelope: the source contract is
  // `Promise<string>` / `Promise<boolean>` and callers use the result directly
  // (`await window.api.isPathInside(...)` inside an `if`). A rejection would surface as an
  // unhandled rejection inside a `useEffect`, so a failed round trip is reported through
  // the diagnostic log and degrades to a value that cannot be mistaken for an answer:
  // `null` for `resolvePath` (callers already treat "no path" as a stop) and `false` for
  // the two predicates. `false` for `isPathInside` is the FAIL-CLOSED direction — the
  // caller uses it to reject directories inside app data / the install directory, so a
  // failed probe must not report "outside".
  resolvePath: async (filePath: string): Promise<string | null> => {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.CHERRY_IPC_API_REQUEST, {
      route: 'system.path.resolve',
      input: { path: filePath },
    }) as { ok?: boolean; data?: unknown } | null
    if (result?.ok === true && typeof result.data === 'string') return result.data
    console.warn('[cherry resolvePath] 解析路径失败，返回 null 而不是未解析的路径：' + filePath)
    return null
  },
  isPathInside: async (childPath: string, parentPath: string): Promise<boolean> => {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.CHERRY_IPC_API_REQUEST, {
      route: 'system.path.is_inside',
      input: { child: childPath, parent: parentPath },
    }) as { ok?: boolean; data?: unknown } | null
    if (result?.ok === true && typeof result.data === 'boolean') return result.data
    console.warn('[cherry isPathInside] 包含关系检查失败，按 fail-closed 返回 false')
    return false
  },
  hasWritePermission: async (dirPath: string): Promise<boolean> => {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.CHERRY_IPC_API_REQUEST, {
      route: 'system.path.has_write_permission',
      input: { path: dirPath },
    }) as { ok?: boolean; data?: unknown } | null
    if (result?.ok === true && typeof result.data === 'boolean') return result.data
    console.warn('[cherry hasWritePermission] 写权限检查失败，按 fail-closed 返回 false：' + dirPath)
    return false
  },
  // Source `window.api.dataApi.request` transport for the Cherry compat settings pages.
  // The main process maps the implemented routes onto Grimoire services and returns the
  // source `DataResponse` envelope; unimplemented routes answer with an error envelope.
  dataApi: {
    request: (request: CherryDataApiRequest): Promise<CherryDataApiResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHERRY_DATA_API_REQUEST, request),
    onDataChanged: (callback: (effects: CherryDataApiDataChangeEffect[]) => void) => {
      const listener = (_event: unknown, effects: CherryDataApiDataChangeEffect[]) => callback(effects)
      ipcRenderer.on('data-api:data-changed', listener as never)
      return () => ipcRenderer.removeListener('data-api:data-changed', listener as never)
    },
  },
  // Narrow route dispatcher for the source `ipcApi.request` facade. Only the routes
  // the compat window actually needs are served; others reject loudly so a missing
  // host implementation never silently returns undefined.
  ipcApi: {
    request: async (route: string, input?: unknown) => {
      if (route === 'file.get_metadata') {
        // The source facade passes a `{ kind: 'path', path }` handle.
        const path = input && typeof input === 'object' && typeof (input as Record<string, unknown>).path === 'string'
          ? String((input as Record<string, unknown>).path)
          : typeof input === 'string' ? input : ''
        // Source `ipcApi.request` unwraps an `IpcResult` envelope; the compat callers
        // (isSupportedFile) read `.ok` through the source facade, so mirror it here.
        try { return { ok: true, data: await ipcRenderer.invoke(IPC_CHANNELS.FILE_BRIDGE_METADATA, path) } }
        catch (error) { return { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } } }
      }
      // Everything else runs in main, where the MCP service lives; the main handler
      // answers in the same `IpcResult` envelope the source facade expects.
      return ipcRenderer.invoke(IPC_CHANNELS.CHERRY_IPC_API_REQUEST, { route, input })
    },
    /**
     * Push-event subscription for the source `ipcApi.on(event, cb)` surface.
     *
     * An UNBRIDGED event name returns a working no-op unsubscribe and reports the gap
     * through the diagnostic channel — it does NOT throw.
     *
     * This started as a throw, to avoid the earlier failure mode where
     * `on: () => () => undefined` made a missing capability look present. That was too
     * blunt: the source subscribes from inside `useEffect` (`useIpcOn`), so a throw
     * during render takes down the whole page. Mounting the dependencies settings page
     * turned `binary.availability_changed` into an error-boundary crash ("似乎出现了一些
     * 问题…") for a feature that is simply absent — a missing push event must degrade to
     * "this page never updates on its own", not to a broken page.
     *
     * The honesty is preserved in the two ways that matter and do not crash: the
     * subscription is genuinely inert (the callback can never fire, so no view can
     * believe it is receiving live updates), and the gap is written to the diagnostic log
     * so it is auditable rather than silently swallowed.
     */
    on: (event: string, callback: (payload: unknown) => void) => {
      // Declared INLINE, not imported: a sandboxed preload cannot `require` a sibling
      // module — extracting this map to its own file emitted a bare `require('./…')`
      // and the whole preload failed to load ("Unable to load preload script"), which
      // took out every `window.api.*` surface at once.
      // `select` turns the one shared stream channel into the three source event names; an
      // event of the wrong kind is dropped instead of being delivered to the wrong listener.
      const streamSelect = (kind: string) => (payload: any) => (payload && payload.event === kind ? payload.payload : undefined)
      const channels: Record<string, { channel: string; select?: (payload: any) => any }> = {
        'mcp.tool.call_progress': { channel: IPC_CHANNELS.CHERRY_MCP_TOOL_PROGRESS },
        'system.native_theme_updated': { channel: IPC_CHANNELS.CHERRY_NATIVE_THEME_UPDATED },
        'navigation.open_route_requested': { channel: IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE },
        'file.tree.mutation': { channel: IPC_CHANNELS.CHERRY_FILE_TREE_MUTATION },
        'ai.stream.chunk': { channel: IPC_CHANNELS.CHERRY_AI_STREAM_EVENT, select: streamSelect('chunk') },
        'ai.stream.done': { channel: IPC_CHANNELS.CHERRY_AI_STREAM_EVENT, select: streamSelect('done') },
        'ai.stream.error': { channel: IPC_CHANNELS.CHERRY_AI_STREAM_EVENT, select: streamSelect('error') },
      }
      const entry = channels[event]
      const channel = entry && entry.channel
      if (!entry || !channel) {
        // Reported, not thrown. `console.warn` reaches the main-process diagnostic log,
        // which pipes renderer console output.
        console.warn('[cherry ipcApi.on] 未桥接事件，订阅为空实现：' + event)
        return () => undefined
      }
      const listener = (_event: unknown, payload: unknown): void => {
        const selected = entry.select ? entry.select(payload) : payload
        if (selected !== undefined) callback(selected)
      }
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
  // `window.api.application.relaunch` — the source settings pages call it after a
  // change that needs a fresh process (menu style, system title bar). Grimoire reloads
  // the window rather than restarting the app, because a process restart would also
  // terminate the user's other windows and any in-flight work.
  application: {
    relaunch: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.CHERRY_APP_RELAUNCH),
  },
  // Source `window.api.shortcut`, used by the keyboard-shortcut and screenshot settings pages.
  //
  // Only ONE member is reachable from the sources in this closure: `onRegistrationConflict`,
  // a push subscription the source main process emits from `ShortcutService` when a global
  // accelerator is already taken by another application. Grimoire registers NO global
  // shortcuts, so there is nothing that could ever emit — the subscription is genuinely
  // inert, not "not wired yet".
  //
  // The event is reported through the diagnostic channel rather than throwing, matching the
  // policy already established for `ipcApi.on`: the source calls this from a `useEffect`
  // return, and a throw during render takes the whole page down. Verified that failure mode
  // here — without this member the page crashed with
  // "Cannot read properties of undefined (reading 'onRegistrationConflict')", which the route
  // audit caught only after its boundary detection was widened to the source's own
  // 「似乎出现了一些问题…」 fallback text.
  shortcut: {
    onRegistrationConflict: (_callback: (payload: { key: string; accelerator?: string; hasConflict: boolean }) => void) => {
      console.warn('[cherry shortcut.onRegistrationConflict] Grimoire 不注册全局快捷键，该事件不会触发')
      return () => undefined
    },
  },
  // Shared-cache surface the source renderer `CacheService` reads. Grimoire serves
  // only the MCP-scoped entries (`mcp.status.<id>` / `mcp.tools.<id>`) that the
  // mounted source MCP pages consume; channel names match the source contract.
  cache: {
    getAllShared: () => ipcRenderer.invoke('cache:get-all-shared') as Promise<Record<string, CherryCacheEntry>>,
    broadcastSync: (_message: CherryCacheSyncMessage) => undefined,
    onSync: (callback: (message: CherryCacheSyncMessage) => void) => {
      const listener = (_event: unknown, message: CherryCacheSyncMessage) => callback(message)
      ipcRenderer.on('cache:sync', listener as never)
      return () => ipcRenderer.removeListener('cache:sync', listener as never)
    },
  },

  error: {
    getAll: (): Promise<ErrorLog[]> => ipcRenderer.invoke(IPC_CHANNELS.ERROR_GET_ALL),
    log: (message: string, stack?: string, context?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ERROR_LOG, message, stack || "", context || ""),
  },

  window: {
    openSettings: () => ipcRenderer.invoke("window:openSettings"),
    openAI: () => ipcRenderer.invoke("window:openAI"),
    openCherry: () => ipcRenderer.invoke("window:openCherry"),
  },

  dialog: {
    save: (content: string, defaultName: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_TEXT, content, defaultName),
    open: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_TEXT),
    openDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY),
  },

  chat: {
    listGroups: () => ipcRenderer.invoke('chat:listGroups'),
    createGroup: (name: string) => ipcRenderer.invoke('chat:createGroup', name),
    deleteGroup: (id: string) => ipcRenderer.invoke('chat:deleteGroup', id),
    renameGroup: (id: string, name: string) => ipcRenderer.invoke('chat:renameGroup', id, name),
    listConversations: () => ipcRenderer.invoke('chat:listConversations'),
    createConversation: (data: any) => ipcRenderer.invoke('chat:createConversation', data),
    deleteConversation: (id: string) => ipcRenderer.invoke('chat:deleteConversation', id),
    updateConversation: (id: string, data: any) => ipcRenderer.invoke('chat:updateConversation', id, data),
    moveConversation: (convId: string, groupId: string) => ipcRenderer.invoke('chat:moveConversation', convId, groupId),
    getMessages: (convId: string) => ipcRenderer.invoke('chat:getMessages', convId),
    saveMessage: (msg: any) => ipcRenderer.invoke('chat:saveMessage', msg),
    deleteMessage: (id: string) => ipcRenderer.invoke('chat:deleteMessage', id),
    clearMessages: (convId: string) => ipcRenderer.invoke('chat:clearMessages', convId),
  },

  tagGroups: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_LIST),
    create: (name: string, copyFrom?: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_CREATE, name, copyFrom),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_DELETE, id),
    rename: (id: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_RENAME, id, name),
    copy: (id: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_COPY, id, name),
    import: (data: any, name: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_IMPORT, data, name),
    export: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_EXPORT, id),
    setActive: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_GROUPS_SET_ACTIVE, id),
  },

  novelai: {
    listWorks: () => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_WORK_LIST),
    createWork: (input: { name: string; snapshot: string }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_WORK_CREATE, input),
    bundle: (input: { workId: string; branchId?: string }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_WORK_BUNDLE, input),
    createVersion: (input: { workId: string; parentVersionId: string; snapshot: string; expectedRevision: number; source?: 'user' | 'agent'; operation?: string }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_VERSION_CREATE, input),
    deleteVersion: (input: { workId: string; versionId: string; mode: 'single' | 'branch'; expectedRevision: number }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_VERSION_DELETE, input),
    restoreVersion: (versionId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_VERSION_RESTORE, versionId),
    deleteVersions: (input: { workId: string; versionIds: string[]; expectedRevision: number }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_VERSION_DELETE_MANY, input),
    restoreVersions: (versionIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_VERSION_RESTORE_MANY, versionIds),
    linkImage: (input: { versionId: string; imageId: string; seed?: number | null; variant?: string }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_VERSION_LINK_IMAGE, input),
    renameBranch: (input: { workId: string; branchId: string; name: string }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_BRANCH_RENAME, input),
    listBranches: (workId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_BRANCH_LIST, workId),
    assets: {
      list: (kind?: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_LIST, kind),
      create: (input: { kind: string; name: string; payload?: string; examples?: string[] }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_CREATE, input),
      update: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_UPDATE, { id, patch }),
      remove: (id: string, force?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_DELETE, { id, force }),
      use: (input: { assetId: string; imageId: string; via?: string }) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_USE, input),
      images: (assetId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_IMAGES, assetId),
      byImage: (imageId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_BY_IMAGE, imageId),
      byVersion: (versionId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_BY_VERSION, versionId),
      versions: (assetId: string) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_ASSET_VERSIONS, assetId),
    },
    metadata: {
      exportTo: (params: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_METADATA_EXPORT, params),
      readFrom: () => ipcRenderer.invoke(IPC_CHANNELS.NOVELAI_METADATA_IMPORT),
    },
  },
  providers: {
    list: (): Promise<Provider[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_LIST),
    save: (data: ProviderSaveInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_SAVE, data),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_DELETE, id),
    setActive: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_SET_ACTIVE, id),
    fetchModels: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_FETCH_MODELS, baseUrl, apiKey),
    test: (baseUrl: string, apiKey: string, model: string, protocol?: 'chat_completions' | 'responses') =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST, baseUrl, apiKey, model, protocol || 'chat_completions'),
    fetchModelsForProvider: (input: { providerId: string; apiKey?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_FETCH_MODELS_FOR, input),
    testProvider: (input: { providerId: string; apiKey?: string; model?: string; protocol?: 'chat_completions' | 'responses' }) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST_FOR, input),
  },

  favorites: {
    tagList: (): Promise<import("../shared/types").FavoriteTag[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.FAV_TAG_LIST),
    tagAdd: (tagId: string) => ipcRenderer.invoke(IPC_CHANNELS.FAV_TAG_ADD, tagId),
    tagRemove: (tagId: string) => ipcRenderer.invoke(IPC_CHANNELS.FAV_TAG_REMOVE, tagId),
    tagCheck: (tagId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.FAV_TAG_CHECK, tagId),
    subList: (): Promise<import("../shared/types").FavoriteSub[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.FAV_SUB_LIST),
    subAdd: (subId: string) => ipcRenderer.invoke(IPC_CHANNELS.FAV_SUB_ADD, subId),
    subRemove: (subId: string) => ipcRenderer.invoke(IPC_CHANNELS.FAV_SUB_REMOVE, subId),
    subCheck: (subId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.FAV_SUB_CHECK, subId),
  },
  db: {
    export: () => ipcRenderer.invoke(IPC_CHANNELS.DB_EXPORT),
    import: () => ipcRenderer.invoke(IPC_CHANNELS.DB_IMPORT),
    onReload: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on("db:reloaded", handler)
      return () => ipcRenderer.removeListener("db:reloaded", handler)
    },
    onRefresh: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on("data:refresh", handler)
      return () => ipcRenderer.removeListener("data:refresh", handler)
    },
    onFocus: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on("window:focused", handler)
      return () => ipcRenderer.removeListener("window:focused", handler)
    },
  },
  migration: {
    selectFriendPrompts: () => ipcRenderer.invoke(IPC_CHANNELS.MIGRATION_SELECT_FRIEND_PROMPTS),
    importFriendPrompts: (token: string, fingerprint: string) => ipcRenderer.invoke(IPC_CHANNELS.MIGRATION_IMPORT_FRIEND_PROMPTS, token, fingerprint),
  },
  tasks: {
    create: (input: TaskCreateInput): Promise<TaskRecord> => ipcRenderer.invoke(IPC_CHANNELS.TASKS_CREATE, input),
    list: (status?: TaskStatus): Promise<TaskRecord[]> => ipcRenderer.invoke(IPC_CHANNELS.TASKS_LIST, status),
    get: (id: string): Promise<TaskRecord> => ipcRenderer.invoke(IPC_CHANNELS.TASKS_GET, id),
    cancel: (id: string): Promise<TaskRecord> => ipcRenderer.invoke(IPC_CHANNELS.TASKS_CANCEL, id),
    retry: (id: string): Promise<TaskRecord> => ipcRenderer.invoke(IPC_CHANNELS.TASKS_RETRY, id),
    onUpdated: (callback: (event: TaskEvent) => void) => {
      const handler = (_event: unknown, data: TaskEvent) => callback(data)
      ipcRenderer.on('task:updated', handler)
      return () => ipcRenderer.removeListener('task:updated', handler)
    },
    onSnapshot: (callback: (tasks: TaskRecord[]) => void) => {
      const handler = (_event: unknown, data: TaskRecord[]) => callback(data)
      ipcRenderer.on('task:snapshot', handler)
      return () => ipcRenderer.removeListener('task:snapshot', handler)
    },
    subscribe: () => ipcRenderer.send(IPC_CHANNELS.TASKS_SUBSCRIBE),
  },
  wd14: {
    diagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.WD14_DIAGNOSTICS),
    selectModelDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.WD14_SELECT_MODEL_DIRECTORY),
    selectPythonPath: () => ipcRenderer.invoke(IPC_CHANNELS.WD14_SELECT_PYTHON_PATH),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.WD14_STATUS),
    models: () => ipcRenderer.invoke(IPC_CHANNELS.WD14_MODELS),
    switchModel: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.WD14_SWITCH_MODEL, modelId),
    createTask: (input: { imageId: number; threshold?: number; modelId?: string; modelIds?: string[]; unionMode?: 'union' | 'intersection' }) => ipcRenderer.invoke(IPC_CHANNELS.WD14_CREATE_TASK, input),
    history: {
      list: (input?: { query?: string; status?: 'succeeded' | 'failed'; limit?: number; offset?: number }) => ipcRenderer.invoke(IPC_CHANNELS.WD14_HISTORY_LIST, input || {}),
      get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.WD14_HISTORY_GET, id),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.WD14_HISTORY_DELETE, id),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.WD14_HISTORY_CLEAR),
      readImage: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.WD14_HISTORY_READ_IMAGE, id) as Promise<string | null>,
    },
  },
  workspace: {
    openPopout: (input: { popoutId: string; panelType: string; title: string; bounds?: { x?: number; y?: number; width?: number; height?: number } }) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_POPOUT, input),
    closePopout: (popoutId: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CLOSE_POPOUT, popoutId),
    focusPopout: (popoutId: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_FOCUS_POPOUT, popoutId),
    loadDocument: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LOAD_DOCUMENT, workspaceId),
    saveDocument: (workspaceId: string, expectedRevision: number, document: unknown) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SAVE_DOCUMENT, { workspaceId, expectedRevision, document }),
    onDocumentChanged: (callback: (value: { workspaceId: string; revision: number; document: unknown }) => void) => {
      const handler = (_event: unknown, value: { workspaceId: string; revision: number; document: unknown }) => callback(value)
      ipcRenderer.on(IPC_CHANNELS.WORKSPACE_DOCUMENT_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WORKSPACE_DOCUMENT_CHANGED, handler)
    },
    loadEditorState: (editorKey: string) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LOAD_EDITOR_STATE, editorKey),
    saveEditorState: (editorKey: string, expectedRevision: number, state: unknown) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE, { editorKey, expectedRevision, state }),
    onEditorStateChanged: (callback: (value: { editorKey: string; revision: number; state: unknown }) => void) => {
      const handler = (_event: unknown, value: { editorKey: string; revision: number; state: unknown }) => callback(value)
      ipcRenderer.on(IPC_CHANNELS.WORKSPACE_EDITOR_STATE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WORKSPACE_EDITOR_STATE_CHANGED, handler)
    },
    onPopoutClosed: (callback: (value: { popoutId: string; bounds?: { x: number; y: number; width: number; height: number } }) => void) => {
      const handler = (_event: unknown, value: { popoutId: string; bounds?: { x: number; y: number; width: number; height: number } }) => callback(value)
      ipcRenderer.on(IPC_CHANNELS.WORKSPACE_POPOUT_CLOSED, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WORKSPACE_POPOUT_CLOSED, handler)
    },
  },
  agent: {
    sessions: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_LIST) as Promise<AgentSessionRecord[]>,
      get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_GET, id) as Promise<{ session: AgentSessionRecord; events: AgentSessionEventRecord[] } | null>,
      create: (input: { runtime: string; providerId?: string; model?: string; title?: string; parentId?: string; agentId?: string | null; workspace?: AgentSessionWorkspace; attachments?: AgentSessionAttachment[]; snapshot?: AgentSessionSnapshot }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_CREATE, input) as Promise<AgentSessionRecord>,
      appendEvent: (input: { sessionId: string; type: string; data: Record<string, unknown> }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_APPEND_EVENT, input) as Promise<AgentSessionEventRecord>,
      send: (input: { sessionId: string; content: string; providerId?: string; model?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_SEND, input) as Promise<{ text: string; session: AgentSessionRecord }>,
      // Live turn feed for the compat agent page. The persisted event log only carries the
      // final assistant message, so text must arrive here while the model is producing it.
      onStream: (callback: (value: { sessionId: string; phase: 'text' | 'reasoning' | 'done' | 'error'; text?: string; status?: string; message?: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, value: { sessionId: string; phase: 'text' | 'reasoning' | 'done' | 'error'; text?: string; status?: string; message?: string }) => callback(value)
        ipcRenderer.on(IPC_CHANNELS.AGENT_SESSION_STREAM, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_SESSION_STREAM, handler)
      },
      branch: (input: { sessionId: string; title?: string }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_BRANCH, input) as Promise<AgentSessionRecord>,
      update: (input: { id: string; status?: string; title?: string; data?: Record<string, unknown> }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_UPDATE, input) as Promise<AgentSessionRecord>,
      attach: (input: { id: string; agentId?: string | null; workspace?: AgentSessionWorkspace; attachments?: AgentSessionAttachment[] }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_ATTACH, input) as Promise<AgentSessionRecord>,
      snapshot: (input: { id: string; snapshot: AgentSessionSnapshot }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_SNAPSHOT, input) as Promise<AgentSessionRecord>,
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SESSION_DELETE, id) as Promise<boolean>,
      onPermissionRequest: (callback: (value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => callback(value)
        ipcRenderer.on(IPC_CHANNELS.AGENT_PERMISSION_REQUEST, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_PERMISSION_REQUEST, handler)
      },
      decidePermission: (value: { requestId: string; decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel' }) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_PERMISSION_DECISION, value),
    },
    stream: {
      open: (input: { sessionId: string; content: string }) => ipcRenderer.invoke(IPC_CHANNELS.CHERRY_AGENT_STREAM_OPEN, input) as Promise<{ status: 'unavailable'; code: 'AGENT_RUNTIME_UNAVAILABLE'; dependency: string }>,
      attach: (input: { leaseId: string; afterOrdinal?: number }) => ipcRenderer.invoke(IPC_CHANNELS.CHERRY_AGENT_STREAM_ATTACH, input),
      abort: (input: { leaseId: string }) => ipcRenderer.invoke(IPC_CHANNELS.CHERRY_AGENT_STREAM_ABORT, input),
      close: (input: { leaseId: string }) => ipcRenderer.invoke(IPC_CHANNELS.CHERRY_AGENT_STREAM_CLOSE, input),
      onEvent: (callback: (value: { leaseId: string; type: 'update' | 'terminal'; ordinal?: number; update?: unknown; status?: string; error?: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, value: { leaseId: string; type: 'update' | 'terminal'; ordinal?: number; update?: unknown; status?: string; error?: string }) => callback(value)
        ipcRenderer.on(IPC_CHANNELS.CHERRY_AGENT_STREAM_EVENT, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CHERRY_AGENT_STREAM_EVENT, handler)
      },
    },
    mcp: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_LIST) as Promise<McpServerRecord[]>,
      save: (input: Partial<McpServerRecord>) => ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_SAVE, input) as Promise<McpServerRecord>,
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_DELETE, id) as Promise<boolean>,
      connect: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_CONNECT, id) as Promise<McpServerRecord>,
      disconnect: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_DISCONNECT, id) as Promise<McpServerRecord>,
      callTool: (input: { serverId: string; name: string; arguments?: Record<string, unknown> }) => ipcRenderer.invoke(IPC_CHANNELS.MCP_SERVER_CALL_TOOL, input),
    },
  },
  comfy: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.COMFY_STATUS),
    models: () => ipcRenderer.invoke(IPC_CHANNELS.COMFY_MODELS),
    workflows: () => ipcRenderer.invoke(IPC_CHANNELS.COMFY_WORKFLOWS_LIST),
    importWorkflow: () => ipcRenderer.invoke(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT),
    deleteWorkflow: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.COMFY_WORKFLOW_DELETE, id),
    createTask: (workflowId: string, values: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.COMFY_CREATE_TASK, { workflowId, values }),
    quickGenerate: (input: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.COMFY_QUICK_GENERATE, input),
  },
  canvas: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_LIST),
    get: (id: string): Promise<CanvasProject> => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_GET, id),
    create: (name?: string): Promise<CanvasProject> => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_CREATE, name),
    save: (id: string, name: string, document: CanvasDocument): Promise<CanvasProject> => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_SAVE, id, name, document),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_DELETE, id),
    exportPackage: (id: string, format: 'json' | 'zip'): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_EXPORT_PACKAGE, id, format),
    importPackage: (): Promise<{ projectId: string; projectName: string; importedImages: number; skippedImages: number; warnings: string[]; importedPromptAssets: number; importedWorkflows: number } | null> => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_IMPORT_PACKAGE),
    vendor: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_VENDOR_LIST),
      get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_VENDOR_GET, id),
      create: (title?: string, id?: string) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_VENDOR_CREATE, title, id),
      save: (id: string, project: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_VENDOR_SAVE, id, project),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_VENDOR_DELETE, id),
    },
  },
}

// Type-only export: the sandboxed preload still has no runtime dependency on
// renderer declarations or sibling modules.
export type ActualPreloadApi = typeof api

contextBridge.exposeInMainWorld("api", api)
export type GrimoireAPI = typeof api
