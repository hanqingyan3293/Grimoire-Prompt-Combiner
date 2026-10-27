// 魔导书 Grimoire v7 — 图库查询与选择状态（SDIS 选择语义：explicit / all-filtered）
// The store owns the query state, pagination, selection tokens and saved-search
// bridge for the gallery panel. Backend calls go through media.query (wave C)
// and the savedSearches IPC (schema v23).
import { create } from 'zustand'

export interface GalleryQueryState {
  search: string
  sourceKinds: string[]
  /** null = any */
  favorite: boolean | null
  /** 0 = any */
  minRating: number
  tagIds: string[]
  /** Tag ids excluded from the result set (gallery-query excludeTagIds). */
  excludeTagIds: string[]
  tagLogic: 'any' | 'all' | 'none'
  includeImplied: boolean
  sort: 'updated' | 'created' | 'rating' | 'name'
  order: 'asc' | 'desc'
}

export interface GalleryItem {
  mediaId: string
  imageRefId: number
  title: string
  originalName: string
  sourceKind: string
  favorite: boolean
  rating: number
  available: boolean
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
}

export interface SavedSearch {
  id: string
  name: string
  queryJson: string
  sortJson: string
  viewMode: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export const DEFAULT_GALLERY_QUERY: GalleryQueryState = {
  search: '',
  sourceKinds: [],
  favorite: null,
  minRating: 0,
  tagIds: [],
  excludeTagIds: [],
  tagLogic: 'any',
  includeImplied: true,
  sort: 'updated',
  order: 'desc',
}

export function toBackendQuery(query: GalleryQueryState): Record<string, unknown> {
  const hasTagFilter = query.tagIds.length > 0 || query.excludeTagIds.length > 0
  return {
    search: query.search.trim() || undefined,
    sourceKinds: query.sourceKinds.length ? query.sourceKinds : undefined,
    favorite: query.favorite === null ? undefined : query.favorite,
    minRating: query.minRating > 0 ? query.minRating : undefined,
    tagFilter: hasTagFilter
      ? {
          tagIds: query.tagIds,
          logic: query.tagLogic,
          includeImplied: query.includeImplied,
          excludeTagIds: query.excludeTagIds.length ? query.excludeTagIds : undefined,
        }
      : undefined,
    sort: query.sort,
    order: query.order,
  }
}

export type SelectionMode = 'explicit' | 'allFiltered'

export interface GalleryState {
  query: GalleryQueryState
  items: GalleryItem[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: string
  selection: Set<number>
  selectionMode: SelectionMode
  /** Anchor index (within the last visible window) for shift-range selection. */
  selectionLastIndex: number | null
  savedSearches: SavedSearch[]

  setQuery: (patch: Partial<GalleryQueryState>) => void
  resetQuery: () => void
  setPage: (page: number) => void
  load: () => Promise<void>
  loadSavedSearches: () => Promise<void>
  saveCurrentSearch: (name: string) => Promise<SavedSearch | null>
  deleteSavedSearch: (id: string) => Promise<void>
  applySavedSearch: (id: string) => Promise<void>

  toggleSelect: (imageRefId: number, index: number, visibleIds: number[], range?: boolean) => void
  selectAllVisible: (visibleIds: number[]) => void
  selectAllFiltered: () => void
  clearSelection: () => void
  /** Resolves the SDIS selection token: explicit ids vs the whole filtered query. */
  resolveSelection: () => { ids: number[]; query?: Record<string, unknown> }
}

let loadRequestId = 0

export const useGalleryStore = create<GalleryState>((set, get) => ({
  query: { ...DEFAULT_GALLERY_QUERY },
  items: [],
  total: 0,
  page: 0,
  pageSize: 200,
  loading: false,
  error: '',
  selection: new Set<number>(),
  selectionMode: 'explicit',
  selectionLastIndex: null,
  savedSearches: [],

  setQuery: (patch) => {
    set({ query: { ...get().query, ...patch }, page: 0 })
  },
  resetQuery: () => set({ query: { ...DEFAULT_GALLERY_QUERY }, page: 0 }),

  setPage: (page) => {
    if (page < 0) return
    set({ page })
  },

  load: async () => {
    const current = ++loadRequestId
    const { query, page, pageSize } = get()
    set({ loading: true })
    try {
      const result = await window.api.media.query({ query: toBackendQuery(query), page: { limit: pageSize, offset: page * pageSize } }) as { items: GalleryItem[]; total: number }
      if (current !== loadRequestId) return
      set({ items: Array.isArray(result?.items) ? result.items : [], total: Number(result?.total || 0), loading: false, error: '' })
    } catch (cause) {
      if (current !== loadRequestId) return
      set({ loading: false, error: cause instanceof Error ? cause.message : '图库查询失败' })
    }
  },

  loadSavedSearches: async () => {
    try {
      const list = await window.api.tags.savedSearches.list() as SavedSearch[]
      set({ savedSearches: Array.isArray(list) ? list : [] })
    } catch {
      set({ savedSearches: [] })
    }
  },

  saveCurrentSearch: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const { query } = get()
    try {
      const saved = await window.api.tags.savedSearches.save({
        name: trimmed,
        queryJson: JSON.stringify(query),
        sortJson: JSON.stringify({ sort: query.sort, order: query.order }),
      }) as SavedSearch
      await get().loadSavedSearches()
      return saved
    } catch {
      return null
    }
  },

  deleteSavedSearch: async (id) => {
    try { await window.api.tags.savedSearches.delete(id) } catch { /* saved search removal is best-effort */ }
    await get().loadSavedSearches()
  },

  applySavedSearch: async (id) => {
    const saved = get().savedSearches.find(item => item.id === id)
    if (!saved) return
    try {
      const parsed = saved.queryJson ? JSON.parse(saved.queryJson) as Partial<GalleryQueryState> : {}
      set({ query: { ...DEFAULT_GALLERY_QUERY, ...parsed }, page: 0, selection: new Set<number>(), selectionMode: 'explicit', selectionLastIndex: null })
    } catch {
      /* malformed saved query keeps the current query */
    }
    await get().load()
  },

  toggleSelect: (imageRefId, index, visibleIds, range = false) => {
    const state = get()
    if (state.selectionMode === 'allFiltered') {
      // Dropping out of "all filtered" keeps the visible set as the explicit baseline.
      set({ selectionMode: 'explicit', selection: new Set(visibleIds), selectionLastIndex: index })
      return
    }
    const next = new Set(state.selection)
    const anchor = state.selectionLastIndex
    if (range && anchor !== null && anchor !== index && anchor < visibleIds.length && index < visibleIds.length) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
      const shouldSelect = !next.has(imageRefId)
      for (const id of visibleIds.slice(from, to + 1)) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
    } else if (next.has(imageRefId)) {
      next.delete(imageRefId)
    } else {
      next.add(imageRefId)
    }
    set({ selection: next, selectionLastIndex: index })
  },

  selectAllVisible: (visibleIds) => set({ selection: new Set(visibleIds), selectionMode: 'explicit', selectionLastIndex: null }),
  selectAllFiltered: () => set({ selection: new Set<number>(), selectionMode: 'allFiltered', selectionLastIndex: null }),
  clearSelection: () => set({ selection: new Set<number>(), selectionMode: 'explicit', selectionLastIndex: null }),

  resolveSelection: () => {
    const { selection, selectionMode, query } = get()
    if (selectionMode === 'allFiltered') return { ids: [], query: toBackendQuery(query) }
    return { ids: [...selection] }
  },
}))