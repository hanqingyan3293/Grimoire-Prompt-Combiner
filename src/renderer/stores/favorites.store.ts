// 魔导书 Grimoire v7 — 收藏 Store
import { create } from "zustand"
import type { FavoriteTag, FavoriteSub } from "@shared/types"

interface FavoritesState {
  tagFavs: FavoriteTag[]
  subFavs: FavoriteSub[]
  tagFavIds: Set<string>
  subFavIds: Set<string>
  loading: boolean
  _loadingPromise: Promise<void> | null

  loadFavorites: () => Promise<void>
  toggleTagFav: (tagId: string) => Promise<void>
  toggleSubFav: (subId: string) => Promise<void>
  isTagFav: (tagId: string) => boolean
  isSubFav: (subId: string) => boolean
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  tagFavs: [],
  subFavs: [],
  tagFavIds: new Set(),
  subFavIds: new Set(),
  loading: false,

  _loadingPromise: null as Promise<void> | null,
  loadFavorites: async () => {
    // Prevent concurrent calls
    const existing = get()._loadingPromise
    if (existing) return existing
    const promise = (async () => {
      try {
        const [tagFavs, subFavs] = await Promise.all([
          window.api.favorites.tagList(),
          window.api.favorites.subList(),
        ])
        set({
          tagFavs, subFavs,
          tagFavIds: new Set(tagFavs.map(f => f.id)),
          subFavIds: new Set(subFavs.map(f => f.id)),
          loading: false,
        })
      } catch (e) {
        console.error("loadFavorites failed:", e)
        set({ loading: false })
      } finally {
        set({ _loadingPromise: null })
      }
    })()
    set({ loading: true, _loadingPromise: promise })
    return promise
  },

  toggleTagFav: async (tagId) => {
    try {
      if (get().tagFavIds.has(tagId)) {
        await window.api.favorites.tagRemove(tagId)
      } else {
        await window.api.favorites.tagAdd(tagId)
      }
      // Always reload after toggle
      const { _loadingPromise } = get()
      if (_loadingPromise) await _loadingPromise
      await get().loadFavorites()
    } catch (e) { console.error("toggleTagFav failed:", e) }
  },

  toggleSubFav: async (subId) => {
    try {
      if (get().subFavIds.has(subId)) {
        await window.api.favorites.subRemove(subId)
      } else {
        await window.api.favorites.subAdd(subId)
      }
      const { _loadingPromise } = get()
      if (_loadingPromise) await _loadingPromise
      await get().loadFavorites()
    } catch (e) { console.error("toggleSubFav failed:", e) }
  },

  isTagFav: (tagId) => get().tagFavIds.has(tagId),
  isSubFav: (subId) => get().subFavIds.has(subId),
}))
