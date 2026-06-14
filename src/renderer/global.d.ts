// Vite 环境变量类型
/// <reference types="vite/client" />

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
  settings: {
    getAll: () => Promise<{
      api_key: string; api_endpoint: string; api_model: string;
      theme: string; language: string; custom_accent: string; ui_scale: string; max_undo_steps: number
      random_min: string; random_max: string
    }>
    set: (key: string, value: string) => Promise<boolean>
  }
  images: {
    list: () => Promise<Array<{ id: number; file_path: string; created_at: string }>>
    add: () => Promise<{ id: number; file_path: string } | null>
    delete: (id: number) => Promise<boolean>
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
    getMessages: (convId: string) => Promise<Array<{ id: string; conv_id: string; role: string; content: string; model: string; token_count: number; created_at: string }>>
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
  error: {
    getAll: () => Promise<Array<{ id: number; message: string; stack: string; context: string; created_at: string }>>
    log: (message: string, stack?: string, context?: string) => Promise<boolean>
  }
  db: {
    export: () => Promise<boolean>
    import: () => Promise<boolean>
    onReload: (callback: () => void) => () => void
    onRefresh: (callback: () => void) => () => void
  }
}

declare global {
  interface Window {
    api: GrimoireAPI
  }
}

export {}
