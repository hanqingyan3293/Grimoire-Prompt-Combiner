// 魔导书 Grimoire v7 — 收藏 Store
import { create } from "zustand"
import type { FavoriteTag, FavoriteSub } from "@shared/types"

interface FavoritesState {
  tagFavs: FavoriteTag[]
  subFavs: FavoriteSub[]
  tagFavIds: Set<string>
  subFavIds: Set<string>
  loading: boolean

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

  loadFavorites: async () => {
    set({ loading: true })
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
    }
  },

  toggleTagFav: async (tagId) => {
    const { tagFavIds } = get()
    try {
      if (tagFavIds.has(tagId)) {
        await window.api.favorites.tagRemove(tagId)
      } else {
        await window.api.favorites.tagAdd(tagId)
      }
      await get().loadFavorites()
    } catch (e) { console.error("toggleTagFav failed:", e) }
  },

  toggleSubFav: async (subId) => {
    const { subFavIds } = get()
    try {
      if (subFavIds.has(subId)) {
        await window.api.favorites.subRemove(subId)
      } else {
        await window.api.favorites.subAdd(subId)
      }
      await get().loadFavorites()
    } catch (e) { console.error("toggleSubFav failed:", e) }
  },

  isTagFav: (tagId) => get().tagFavIds.has(tagId),
  isSubFav: (subId) => get().subFavIds.has(subId),
}))