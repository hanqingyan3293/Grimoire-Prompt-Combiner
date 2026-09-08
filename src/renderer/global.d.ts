// Vite 环境变量类型
/// <reference types="vite/client" />
import type { TaskEvent, TaskRecord, TaskStatus } from '../shared/task-types'
import type { CanvasDocument, CanvasProject } from '../shared/canvas-types'
import type { PromptAssetPage, PromptAssetQuery } from '../shared/prompt-asset-types'

// 预加载 API 类型
interface GrimoireAPI {
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
  images: {
    list: () => Promise<Array<{ id: number; file_path: string; storage_mode: 'managed' | 'external'; asset_hash: string | null; mime_type: string | null; file_size: number | null; original_name: string | null; available: boolean; created_at: string }>>
    add: (mode?: 'managed' | 'external') => Promise<{ id: number; file_path: string; storage_mode: 'managed' | 'external' } | null>
    delete: (id: number) => Promise<boolean>
    importData: (dataBase64: string, originalName: string) => Promise<unknown>
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
    list: () => Promise<Array<{
      id: string; name: string; access_mode: "login" | "api"
      protocol: "chat_completions" | "responses"; base_url: string
      has_api_key: boolean; has_auth_config: boolean; default_model: string
      test_model: string; context_size: number | null; models: string[]
      is_active: boolean; created_at: string; updated_at: string
    }>>
    save: (data: {
      id?: string; name?: string; access_mode?: "login" | "api"
      protocol?: "chat_completions" | "responses"; base_url?: string
      api_key?: string; default_model?: string; test_model?: string
      context_size?: number | null; models?: string[]; config_toml?: string; auth_json?: string
    }) => Promise<{ id: string }>
    delete: (id: string) => Promise<boolean>
    setActive: (id: string) => Promise<boolean>
    fetchModels: (baseUrl: string, apiKey: string) => Promise<{ success?: boolean; models?: string[]; error?: string }>
    test: (baseUrl: string, apiKey: string, model: string) => Promise<{ success: boolean; message?: string; error?: string }>
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
  }
  ai: {
    sendMessage: (args: { providerId: string; model: string; messages: Array<{ role: string; content: any }> }) => Promise<{ success?: boolean; text?: string; error?: string }>
    vision: (args: { providerId: string; model: string; imageBase64: string; prompt?: string }) => Promise<{ success?: boolean; text?: string; error?: string }>
    generateImage: (args: { providerId: string; model: string; prompt: string }) => Promise<{ success?: boolean; url?: string; error?: string }>
    fetchModels: (args: { baseUrl: string; apiKey: string }) => Promise<{ success?: boolean; models?: string[]; error?: string }>
    onChunk: (callback: (data: any) => void) => () => void
  }
  window: {
    openSettings: () => Promise<void>
    openAI: () => Promise<void>
  }
  error: {
    getAll: () => Promise<Array<{ id: number; message: string; stack: string; context: string; created_at: string }>>
    log: (message: string, stack?: string, context?: string) => Promise<boolean>
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
    createTask: (input: { imageId: number; threshold?: number; modelId?: string }) => Promise<Record<string, unknown>>
  }
  comfy: {
    status: () => Promise<{ online: boolean; comfyui_version: string | null; error?: string }>
    models: () => Promise<{ checkpoints: string[]; unets: string[]; loras: string[] }>
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
