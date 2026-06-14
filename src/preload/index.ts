// 魔导书 Grimoire v7 — 预加载桥
import { contextBridge, ipcRenderer } from "electron"
import type { Category, Tag, Preset, HistoryItem, ImageRef, ChatMessage, AppSettings, ErrorLog } from "../shared/types"
import { IPC_CHANNELS } from "../shared/types"

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

  settings: {
    getAll: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  },

  images: {
    list: (): Promise<ImageRef[]> => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_LIST),
    add: () => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_ADD),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.IMAGES_DELETE, id),
  },

  ai: {
    chat: (messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT, messages),
    vision: (imageBase64: string, prompt?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_VISION, imageBase64, prompt),
    chatHistory: (): Promise<ChatMessage[]> => ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_HISTORY),
    onChunk: (callback: (text: string) => void) => {
      const handler = (_event: unknown, text: string) => callback(text)
      ipcRenderer.on("ai:chunk", handler)
      return () => ipcRenderer.removeListener("ai:chunk", handler)
    },
  },

  error: {
    getAll: (): Promise<ErrorLog[]> => ipcRenderer.invoke(IPC_CHANNELS.ERROR_GET_ALL),
    log: (message: string, stack?: string, context?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ERROR_LOG, message, stack || "", context || ""),
  },

  db: {
    export: () => ipcRenderer.invoke(IPC_CHANNELS.DB_EXPORT),
    import: () => ipcRenderer.invoke(IPC_CHANNELS.DB_IMPORT),
    onReload: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on("db:reloaded", handler)
      return () => ipcRenderer.removeListener("db:reloaded", handler)
    },
  },
}

contextBridge.exposeInMainWorld("api", api)
export type GrimoireAPI = typeof api
