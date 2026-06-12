import { create } from 'zustand'
import type { Category, Tag } from '@shared/types'

declare global {
  interface Window {
    electronAPI: {
      tags: {
        getAll: () => Promise<{ categories: Category[]; error?: string }>
        search: (q: string) => Promise<{ results: any[]; error?: string }>
        add: (data: any) => Promise<{ ok: boolean; id?: string; error?: string }>
        edit: (data: any) => Promise<{ ok: boolean; error?: string }>
        delete: (tagId: string) => Promise<{ ok: boolean; error?: string }>
        addFavorite: (tagId: string) => Promise<{ ok: boolean }>
        removeFavorite: (tagId: string) => Promise<{ ok: boolean }>
        getFavorites: () => Promise<{ favorites: any[] }>
        addUsage: (tagId: string) => Promise<{ ok: boolean }>
        getFrequent: (limit?: number) => Promise<{ frequent: any[] }>
      }
    }
  }
}

interface TagsState {
  categories: Category[]
  searchResults: any[]
  favorites: any[]
  frequent: any[]
  selectedCategory: string | null
  selectedSubcategory: string | null
  searchQuery: string
  loading: boolean

  loadTags: () => Promise<void>
  setSelectedCategory: (id: string | null) => void
  setSelectedSubcategory: (id: string | null) => void
  search: (q: string) => Promise<void>
  addTag: (data: any) => Promise<boolean>
  editTag: (data: any) => Promise<boolean>
  deleteTag: (tagId: string) => Promise<boolean>
  toggleFavorite: (tagId: string, isFav: boolean) => Promise<void>
  refreshFavorites: () => Promise<void>
  refreshFrequent: () => Promise<void>
}

export const useTagsStore = create<TagsState>((set, get) => ({
  categories: [],
  searchResults: [],
  favorites: [],
  frequent: [],
  selectedCategory: null,
  selectedSubcategory: null,
  searchQuery: '',
  loading: false,

  loadTags: async () => {
    set({ loading: true })
    try {
      const result = await window.electronAPI.tags.getAll()
      if (result.error) throw new Error(result.error)
      set({ categories: result.categories, loading: false })
    } catch (e) {
      set({ loading: false })
      throw e
    }
  },

  setSelectedCategory: (id) => set({ selectedCategory: id, selectedSubcategory: null }),
  setSelectedSubcategory: (id) => set({ selectedSubcategory: id }),

  search: async (q) => {
    set({ searchQuery: q })
    if (!q.trim()) {
      set({ searchResults: [] })
      return
    }
    const result = await window.electronAPI.tags.search(q)
    set({ searchResults: result.results || [] })
  },

  addTag: async (data) => {
    const result = await window.electronAPI.tags.add(data)
    if (result.ok) {
      await get().loadTags()
      return true
    }
    return false
  },

  editTag: async (data) => {
    const result = await window.electronAPI.tags.edit(data)
    if (result.ok) {
      await get().loadTags()
      return true
    }
    return false
  },

  deleteTag: async (tagId) => {
    const result = await window.electronAPI.tags.delete(tagId)
    if (result.ok) {
      await get().loadTags()
      return true
    }
    return false
  },

  toggleFavorite: async (tagId, isFav) => {
    if (isFav) {
      await window.electronAPI.tags.removeFavorite(tagId)
    } else {
      await window.electronAPI.tags.addFavorite(tagId)
    }
    await get().loadTags()
  },

  refreshFavorites: async () => {
    const result = await window.electronAPI.tags.getFavorites()
    set({ favorites: result.favorites })
  },

  refreshFrequent: async () => {
    const result = await window.electronAPI.tags.getFrequent(20)
    set({ frequent: result.frequent })
  }
}))
