// 魔导书 Grimoire v7 — 预加载桥
import { contextBridge, ipcRenderer } from "electron"
import type { Category, Tag, Preset, HistoryItem, ImageRef, ChatMessage, AppSettings, ErrorLog, Provider, ProviderSaveInput } from "../shared/types"
import type { TaskCreateInput, TaskEvent, TaskRecord, TaskStatus } from "../shared/task-types"
import type { CanvasDocument, CanvasProject } from "../shared/canvas-types"
import type { PromptAssetPage, PromptAssetQuery } from "../shared/prompt-asset-types"

// Keep the sandboxed preload self-contained at runtime. TypeScript type imports
// disappear from the bundle, but a runtime import would be unavailable to a
// sandboxed Electron preload in the packaged app.
const IPC_CHANNELS = {
  TAGS_GET_ALL: 'tags:getAll', TAGS_CREATE: 'tags:create', TAGS_UPDATE: 'tags:update', TAGS_DELETE: 'tags:delete', TAGS_IMPORT: 'tags:import', TAGS_RESET: 'tags:reset',
  CATEGORY_CREATE: 'category:create', CATEGORY_UPDATE: 'category:update', CATEGORY_DELETE: 'category:delete', SUBCATEGORY_CREATE: 'subcategory:create', SUBCATEGORY_UPDATE: 'subcategory:update', SUBCATEGORY_DELETE: 'subcategory:delete',
  PRESETS_LIST: 'presets:list', PRESETS_SAVE: 'presets:save', PRESETS_DELETE: 'presets:delete',
  HISTORY_LIST: 'history:list', HISTORY_ADD: 'history:add', HISTORY_CLEAR: 'history:clear',
  PROMPT_ASSETS_LIST: 'promptAssets:list', SETTINGS_GET_ALL: 'settings:getAll', SETTINGS_SET: 'settings:set',
  IMAGES_LIST: 'images:list', IMAGES_ADD: 'images:add', IMAGES_DELETE: 'images:delete',
  AI_CHAT: 'ai:chat', AI_VISION: 'ai:vision', AI_CHAT_HISTORY: 'ai:chatHistory',
  ERROR_LOG: 'error:log', ERROR_GET_ALL: 'error:getAll', DB_EXPORT: 'db:export', DB_IMPORT: 'db:import',
  DIALOG_SAVE_TEXT: 'dialog:saveText', DIALOG_OPEN_TEXT: 'dialog:openText',
  PROVIDERS_LIST: 'providers:list', PROVIDERS_SAVE: 'providers:save', PROVIDERS_DELETE: 'providers:delete', PROVIDERS_SET_ACTIVE: 'providers:setActive', PROVIDERS_FETCH_MODELS: 'providers:fetchModels', PROVIDERS_TEST: 'providers:test',
  TAG_GROUPS_LIST: 'tagGroups:list', TAG_GROUPS_CREATE: 'tagGroups:create', TAG_GROUPS_DELETE: 'tagGroups:delete', TAG_GROUPS_RENAME: 'tagGroups:rename', TAG_GROUPS_COPY: 'tagGroups:copy', TAG_GROUPS_IMPORT: 'tagGroups:import', TAG_GROUPS_EXPORT: 'tagGroups:export', TAG_GROUPS_SET_ACTIVE: 'tagGroups:setActive',
  FAV_TAG_LIST: 'fav:tagList', FAV_TAG_ADD: 'fav:tagAdd', FAV_TAG_REMOVE: 'fav:tagRemove', FAV_TAG_CHECK: 'fav:tagCheck', FAV_SUB_LIST: 'fav:subList', FAV_SUB_ADD: 'fav:subAdd', FAV_SUB_REMOVE: 'fav:subRemove', FAV_SUB_CHECK: 'fav:subCheck',
  MIGRATION_SELECT_FRIEND_PROMPTS: 'migration:selectFriendPrompts', MIGRATION_IMPORT_FRIEND_PROMPTS: 'migration:importFriendPrompts',
  TASKS_CREATE: 'tasks:create', TASKS_LIST: 'tasks:list', TASKS_GET: 'tasks:get', TASKS_CANCEL: 'tasks:cancel', TASKS_RETRY: 'tasks:retry', TASKS_SUBSCRIBE: 'tasks:subscribe',
  WD14_STATUS: 'wd14:status', WD14_MODELS: 'wd14:models', WD14_SWITCH_MODEL: 'wd14:switchModel', WD14_CREATE_TASK: 'wd14:createTask', WD14_DIAGNOSTICS: 'wd14:diagnostics', WD14_SELECT_MODEL_DIRECTORY: 'wd14:selectModelDirectory', WD14_SELECT_PYTHON_PATH: 'wd14:selectPythonPath',
  COMFY_STATUS: 'comfy:status', COMFY_MODELS: 'comfy:models', COMFY_WORKFLOWS_LIST: 'comfy:workflows:list', COMFY_WORKFLOW_IMPORT: 'comfy:workflows:import', COMFY_WORKFLOW_DELETE: 'comfy:workflows:delete', COMFY_CREATE_TASK: 'comfy:createTask', COMFY_QUICK_GENERATE: 'comfy:quickGenerate',
  CANVAS_LIST: 'canvas:list', CANVAS_GET: 'canvas:get', CANVAS_CREATE: 'canvas:create', CANVAS_SAVE: 'canvas:save', CANVAS_DELETE: 'canvas:delete', CANVAS_EXPORT_PACKAGE: 'canvas:exportPackage', CANVAS_IMPORT_PACKAGE: 'canvas:importPackage',
} as const

const api = {
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
  },

  settings: {
    getAll: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  },

  images: {
    list: (): Promise<ImageRef[]> => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_LIST),
    add: (mode: 'managed' | 'external' = 'managed') => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_ADD, mode),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_DELETE, id),
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
  },

  error: {
    getAll: (): Promise<ErrorLog[]> => ipcRenderer.invoke(IPC_CHANNELS.ERROR_GET_ALL),
    log: (message: string, stack?: string, context?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ERROR_LOG, message, stack || "", context || ""),
  },

  window: {
    openSettings: () => ipcRenderer.invoke("window:openSettings"),
    openAI: () => ipcRenderer.invoke("window:openAI"),
  },

  dialog: {
    save: (content: string, defaultName: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_TEXT, content, defaultName),
    open: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_TEXT),
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
    test: (baseUrl: string, apiKey: string, model: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST, baseUrl, apiKey, model),
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
    createTask: (input: { imageId: number; threshold?: number; modelId?: string }) => ipcRenderer.invoke(IPC_CHANNELS.WD14_CREATE_TASK, input),
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
  },
}

contextBridge.exposeInMainWorld("api", api)
export type GrimoireAPI = typeof api
