// ============================================================
// 魔导书 v5 — Preload 安全桥接
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 标签
  tags: {
    getAll: () => ipcRenderer.invoke('tags:getAll'),
    search: (q: string) => ipcRenderer.invoke('tags:search', q),
    add: (data: any) => ipcRenderer.invoke('tags:add', data),
    edit: (data: any) => ipcRenderer.invoke('tags:edit', data),
    delete: (tagId: string) => ipcRenderer.invoke('tags:delete', tagId),
    addCategory: (name: string) => ipcRenderer.invoke('tags:addCategory', name),
    addSubcategory: (catId: string, name: string) => ipcRenderer.invoke('tags:addSubcategory', catId, name),
    deleteCategory: (catId: string) => ipcRenderer.invoke('tags:deleteCategory', catId),
    deleteSubcategory: (subId: string) => ipcRenderer.invoke('tags:deleteSubcategory', subId),
    addFavorite: (tagId: string) => ipcRenderer.invoke('tags:addFavorite', tagId),
    removeFavorite: (tagId: string) => ipcRenderer.invoke('tags:removeFavorite', tagId),
    getFavorites: () => ipcRenderer.invoke('tags:getFavorites'),
    addUsage: (tagId: string) => ipcRenderer.invoke('tags:addUsage', tagId),
    getFrequent: (limit?: number) => ipcRenderer.invoke('tags:getFrequent', limit)
  },
  // 预设
  presets: {
    getAll: () => ipcRenderer.invoke('presets:getAll'),
    save: (data: any) => ipcRenderer.invoke('presets:save', data),
    delete: (id: string) => ipcRenderer.invoke('presets:delete', id),
    import: (data: any) => ipcRenderer.invoke('presets:import', data),
    export: (id: string) => ipcRenderer.invoke('presets:export', id)
  },
  // 历史
  history: {
    getAll: (limit?: number) => ipcRenderer.invoke('history:getAll', limit),
    add: (data: any) => ipcRenderer.invoke('history:add', data),
    delete: (id: string) => ipcRenderer.invoke('history:delete', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },
  // 快照
  snapshots: {
    getAll: () => ipcRenderer.invoke('snapshots:getAll'),
    save: (data: any) => ipcRenderer.invoke('snapshots:save', data),
    delete: (id: string) => ipcRenderer.invoke('snapshots:delete', id)
  },
  // 设置
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },
  // 图片
  images: {
    parse: (filePath: string) => ipcRenderer.invoke('images:parse', filePath),
    getRefs: () => ipcRenderer.invoke('images:getRefs'),
    deleteRef: (id: number) => ipcRenderer.invoke('images:deleteRef', id)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
