// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GALLERY_QUERY, toBackendQuery, useGalleryStore, type GalleryItem } from './gallery.store'

const query = vi.fn()
const savedList = vi.fn()
const savedSave = vi.fn()
const savedDelete = vi.fn()

function item(imageRefId: number): GalleryItem {
  return {
    mediaId: 'media_image_' + imageRefId,
    imageRefId,
    title: 't' + imageRefId,
    originalName: 'file' + imageRefId + '.png',
    sourceKind: 'imported-reference',
    favorite: false,
    rating: 0,
    available: true,
    width: null,
    height: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  query.mockReset().mockResolvedValue({ items: [item(1), item(2), item(3)], total: 3 })
  savedList.mockReset().mockResolvedValue([])
  savedSave.mockReset().mockResolvedValue({ id: 'search_1', name: 'x', queryJson: '{}', sortJson: '{}', viewMode: 'grid', pinned: false, createdAt: '', updatedAt: '' })
  savedDelete.mockReset().mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = {
    media: { query },
    tags: { savedSearches: { list: savedList, save: savedSave, delete: savedDelete } },
  }
  useGalleryStore.setState({
    query: { ...DEFAULT_GALLERY_QUERY },
    items: [],
    total: 0,
    page: 0,
    loading: false,
    error: '',
    selection: new Set<number>(),
    selectionMode: 'explicit',
    selectionLastIndex: null,
    savedSearches: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gallery store', () => {
  it('loads through media.query with the compiled backend query', async () => {
    useGalleryStore.getState().setQuery({ search: ' sky ', favorite: true, minRating: 3, tagIds: ['t1'], tagLogic: 'all' })
    await useGalleryStore.getState().load()

    expect(query).toHaveBeenCalledWith({ query: expect.objectContaining({ search: 'sky', favorite: true, minRating: 3, tagFilter: { tagIds: ['t1'], logic: 'all', includeImplied: true } }), page: { limit: 200, offset: 0 } })
    expect(useGalleryStore.getState().items.map(entry => entry.imageRefId)).toEqual([1, 2, 3])
    expect(useGalleryStore.getState().total).toBe(3)
    expect(useGalleryStore.getState().error).toBe('')
  })

  it('resets the page on query change and records load errors', async () => {
    useGalleryStore.getState().setPage(4)
    useGalleryStore.getState().setQuery({ search: 'x' })
    expect(useGalleryStore.getState().page).toBe(0)

    query.mockRejectedValueOnce(new Error('boom'))
    await useGalleryStore.getState().load()
    expect(useGalleryStore.getState().error).toBe('boom')
    expect(useGalleryStore.getState().loading).toBe(false)
  })

  it('tracks explicit, range and all-filtered selections', () => {
    const store = useGalleryStore.getState()
    const visible = [1, 2, 3]
    store.toggleSelect(1, 0, visible)
    expect([...useGalleryStore.getState().selection]).toEqual([1])
    store.toggleSelect(3, 2, visible, true)
    expect([...useGalleryStore.getState().selection].sort()).toEqual([1, 2, 3])

    store.clearSelection()
    store.toggleSelect(2, 1, visible)
    store.toggleSelect(2, 1, visible)
    expect(useGalleryStore.getState().selection.size).toBe(0)

    store.selectAllFiltered()
    expect(useGalleryStore.getState().selectionMode).toBe('allFiltered')
    const resolved = useGalleryStore.getState().resolveSelection()
    expect(resolved.ids).toEqual([])
    expect(resolved.query).toEqual(toBackendQuery(useGalleryStore.getState().query))

    const explicit = useGalleryStore.getState()
    explicit.clearSelection()
    explicit.toggleSelect(2, 1, visible)
    expect(useGalleryStore.getState().resolveSelection()).toEqual({ ids: [2] })
  })

  it('saves and applies saved searches through the tags API', async () => {
    useGalleryStore.getState().setQuery({ search: 'beach', sort: 'rating', order: 'asc' })
    await useGalleryStore.getState().saveCurrentSearch('海边')
    expect(savedSave).toHaveBeenCalledWith(expect.objectContaining({ name: '海边' }))
    const payload = JSON.parse(savedSave.mock.calls[0][0].queryJson)
    expect(payload.search).toBe('beach')

    savedList.mockResolvedValueOnce([{ id: 'search_9', name: '海边', queryJson: JSON.stringify({ search: 'beach' }), sortJson: '{}', viewMode: 'grid', pinned: false, createdAt: '', updatedAt: '' }])
    await useGalleryStore.getState().loadSavedSearches()
    expect(useGalleryStore.getState().savedSearches).toHaveLength(1)
    await useGalleryStore.getState().applySavedSearch('search_9')
    expect(useGalleryStore.getState().query.search).toBe('beach')
    expect(query).toHaveBeenCalledTimes(1)
  })
})