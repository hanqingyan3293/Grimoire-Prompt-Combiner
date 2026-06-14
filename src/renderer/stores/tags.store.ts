// 魔导书 Grimoire v7 — 标签数据 Store
import { create } from "zustand"
import type { Tag, Category, Subcategory } from "@shared/types"

interface TagsState {
  categories: Category[]
  subcategories: Subcategory[]
  tags: Tag[]
  loading: boolean
  searchQuery: string
  selectedSubIds: Set<string>
  
  loadTags: () => Promise<void>
  setSearchQuery: (query: string) => void
  toggleSubSelect: (subId: string) => void
  addTag: (data: { subcategory_id: string; en: string; zh: string }) => Promise<void>
  updateTag: (id: string, en: string, zh: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  
  createCategory: (zh: string) => Promise<boolean>
  updateCategory: (id: string, zh: string) => Promise<boolean>
  deleteCategory: (id: string) => Promise<boolean>
  createSubcategory: (categoryId: string, zh: string) => Promise<boolean>
  updateSubcategory: (id: string, zh: string) => Promise<boolean>
  deleteSubcategory: (id: string) => Promise<boolean>
  
  getFilteredCategories: () => Category[]
  findTagById: (id: string) => Tag | undefined
}

export const useTagsStore = create<TagsState>((set, get) => ({
  categories: [],
  subcategories: [],
  tags: [],
  loading: false,
  searchQuery: "",
  selectedSubIds: new Set<string>(),
  
  loadTags: async () => {
    set({ loading: true })
    try {
      const data = await window.api.tags.getAll()
      
      const subMap = new Map<string, Subcategory[]>()
      for (const sub of data.subcategories) {
        const list = subMap.get(sub.category_id) || []
        list.push({
          id: sub.id, category_id: sub.category_id,
          en: sub.en, zh: sub.zh, sort_order: sub.sort_order, tags: [],
        })
        subMap.set(sub.category_id, list)
      }
      
      const tagMap = new Map<string, Tag[]>()
      for (const tag of data.tags) {
        const list = tagMap.get(tag.subcategory_id) || []
        list.push(tag as Tag)
        tagMap.set(tag.subcategory_id, list)
      }
      
      const categories: Category[] = []
      const subcategories: Subcategory[] = []
      const allTags: Tag[] = data.tags as Tag[]
      
      for (const cat of data.categories) {
        const subs = (subMap.get(cat.id) || []).sort((a, b) => a.sort_order - b.sort_order)
        for (const sub of subs) {
          sub.tags = (tagMap.get(sub.id) || []).sort((a, b) => a.sort_order - b.sort_order)
        }
        categories.push({
          id: cat.id, en: cat.en, zh: cat.zh,
          sort_order: cat.sort_order, subcategories: subs,
        })
        subcategories.push(...subs)
      }
      
      categories.sort((a, b) => a.sort_order - b.sort_order)
      
      set({
        categories, subcategories, tags: allTags,
        loading: false,
      })
    } catch (err) {
      console.error("Failed to load tags:", err)
      set({ loading: false })
    }
  },
  
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  toggleSubSelect: (subId) => {
    const selected = new Set(get().selectedSubIds)
    if (selected.has(subId)) selected.delete(subId)
    else selected.add(subId)
    set({ selectedSubIds: selected })
  },
  
  addTag: async (data) => {
    try {
      await window.api.tags.create(data)
      await get().loadTags()
      return true
    } catch (e) { console.error("addTag failed:", e); return false }
  },
  
  updateTag: async (id, en, zh) => {
    try {
      await window.api.tags.update({ id, en, zh })
      await get().loadTags()
      return true
    } catch (e) { console.error("updateTag failed:", e); return false }
  },
  
  deleteTag: async (id) => {
    try {
      await window.api.tags.delete(id)
      await get().loadTags()
      return true
    } catch (e) { console.error("deleteTag failed:", e); return false }
  },
  
  createCategory: async (zh) => {
    try {
      console.log("Creating category:", zh)
      await window.api.tags.createCategory({ zh })
      await get().loadTags()
      return true
    } catch (e) { console.error("createCategory failed:", e); return false }
  },
  updateCategory: async (id, zh) => {
    try {
      console.log("Updating category:", id, zh)
      await window.api.tags.updateCategory({ id, zh })
      await get().loadTags()
      return true
    } catch (e) { console.error("updateCategory failed:", e); return false }
  },
  deleteCategory: async (id) => {
    try {
      await window.api.tags.deleteCategory(id)
      await get().loadTags()
      return true
    } catch (e) { console.error("deleteCategory failed:", e); return false }
  },
  createSubcategory: async (categoryId, zh) => {
    try {
      console.log("Creating subcategory:", categoryId, zh)
      await window.api.tags.createSubcategory({ category_id: categoryId, zh })
      await get().loadTags()
      return true
    } catch (e) { console.error("createSubcategory failed:", e); return false }
  },
  updateSubcategory: async (id, zh) => {
    try {
      console.log("Updating subcategory:", id, zh)
      await window.api.tags.updateSubcategory({ id, zh })
      await get().loadTags()
      return true
    } catch (e) { console.error("updateSubcategory failed:", e); return false }
  },
  deleteSubcategory: async (id) => {
    try {
      await window.api.tags.deleteSubcategory(id)
      await get().loadTags()
      return true
    } catch (e) { console.error("deleteSubcategory failed:", e); return false }
  },
  
  getFilteredCategories: () => {
    const { categories, searchQuery } = get()
    if (!searchQuery.trim()) return categories
    const q = searchQuery.toLowerCase()
    return categories
      .map(cat => ({
        ...cat,
        subcategories: cat.subcategories
          .map(sub => ({
            ...sub,
            tags: sub.tags.filter(
              t => t.en.toLowerCase().includes(q) || t.zh.includes(q)
            ),
          }))
          .filter(sub => sub.tags.length > 0 || sub.zh.includes(q) || cat.zh.includes(q)),
      }))
      .filter(cat => cat.subcategories.length > 0 || cat.zh.includes(q))
  },
  
  findTagById: (id) => get().tags.find(t => t.id === id),
}))
