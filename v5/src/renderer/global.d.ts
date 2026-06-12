/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      tags: {
        getAll: () => Promise<{ categories: import('@shared/types').Category[]; error?: string }>
        search: (q: string) => Promise<{ results: any[]; error?: string }>
        add: (data: { category: string; subcategory: string; en: string; zh: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
        edit: (data: { tagId: string; en: string; zh: string }) => Promise<{ ok: boolean; error?: string }>
        delete: (tagId: string) => Promise<{ ok: boolean; error?: string }>
        addFavorite: (tagId: string) => Promise<{ ok: boolean }>
        removeFavorite: (tagId: string) => Promise<{ ok: boolean }>
        getFavorites: () => Promise<{ favorites: any[] }>
        addUsage: (tagId: string) => Promise<{ ok: boolean }>
        addCategory: (name: string) => Promise<{ ok: boolean; id?: string; error?: string }>
        addSubcategory: (catId: string, name: string) => Promise<{ ok: boolean; id?: string; error?: string }>
        deleteCategory: (catId: string) => Promise<{ ok: boolean; error?: string }>
        deleteSubcategory: (subId: string) => Promise<{ ok: boolean; error?: string }>
        getFrequent: (limit?: number) => Promise<{ frequent: any[] }>      }
      presets: {
        getAll: () => Promise<{ presets: any[] }>
        save: (data: any) => Promise<{ ok: boolean; id?: string }>
        delete: (id: string) => Promise<{ ok: boolean }>
        import: (data: any) => Promise<{ ok: boolean; id?: string }>
        export: (id: string) => Promise<any>
      }
      history: {
        getAll: (limit?: number) => Promise<{ items: any[] }>
        add: (data: any) => Promise<{ ok: boolean }>
        delete: (id: string) => Promise<{ ok: boolean }>
        clear: () => Promise<{ ok: boolean }>
      }
      snapshots: {
        getAll: () => Promise<{ snapshots: any[] }>
        save: (data: { name: string; data: any }) => Promise<{ ok: boolean }>
        delete: (id: string) => Promise<{ ok: boolean }>
      }
      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<{ ok: boolean }>
        getAll: () => Promise<Record<string, string>>
      }
      images: {
        parse: (filePath: string) => Promise<{ ok: boolean; metadata?: any; error?: string }>
        getRefs: () => Promise<{ refs: any[] }>
        deleteRef: (id: number) => Promise<{ ok: boolean }>
      }
    }
  }
}

export {}
