// @vitest-environment jsdom
// Composed smoke test: mount the whole gallery-search panel against a mocked
// window.api and verify the rail/toolbar/syntax bar/grid/inspector compose.
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GALLERY_QUERY, useGalleryStore } from '../../stores/gallery.store'
import { GallerySearchPanel } from './GallerySearchPanel'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const item = (id: number) => ({
  mediaId: 'media_image_' + id,
  imageRefId: id,
  title: 'title' + id,
  originalName: 'file' + id + '.png',
  sourceKind: 'imported-reference',
  favorite: false,
  rating: 0,
  available: true,
  width: 512,
  height: 512,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

beforeEach(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
  ;(window as unknown as { api: unknown }).api = {
    media: {
      query: vi.fn().mockResolvedValue({ items: [item(1), item(2)], total: 2 }),
      thumbs: vi.fn().mockResolvedValue({ 1: 'data:image/png;base64,AAA', 2: 'data:image/png;base64,BBB' }),
      update: vi.fn().mockResolvedValue({}),
      metadata: { get: vi.fn().mockResolvedValue(null), parse: vi.fn().mockResolvedValue(null) },
    },
    tags: {
      searchAdvanced: vi.fn().mockResolvedValue([]),
      expandRelations: vi.fn().mockResolvedValue([]),
      assetLinks: { list: vi.fn().mockResolvedValue([]), assign: vi.fn(), remove: vi.fn(), batchAssign: vi.fn().mockResolvedValue(1) },
      savedSearches: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() },
    },
    images: { list: vi.fn().mockResolvedValue([]) },
    system: { showItemInFolder: vi.fn().mockResolvedValue(true) },
    wd14: { createTask: vi.fn().mockResolvedValue({}) },
  }
  useGalleryStore.setState({
    query: { ...DEFAULT_GALLERY_QUERY },
    items: [],
    total: 0,
    page: 0,
    selection: new Set<number>(),
    selectionMode: 'explicit',
    selectionLastIndex: null,
    savedSearches: [],
    loading: false,
    error: '',
  })
})

afterEach(() => {
  cleanup()
})

describe('GallerySearchPanel (composed smoke)', () => {
  it('mounts rail, toolbar, syntax bar, grid and inspector together', async () => {
    render(<GallerySearchPanel />)

    expect(screen.getByLabelText('图库语法查询')).toBeTruthy()

    expect(await screen.findByText('file1.png')).toBeTruthy()
    expect(await screen.findByText('file2.png')).toBeTruthy()
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getByText('共 2 个 · 第 1/1 页')).toBeTruthy()

    // Inspector starts empty until a card requests opening.
    expect(screen.getAllByText('未选择资产').length).toBeGreaterThan(0)

    const { api } = window as unknown as { api: { media: { thumbs: ReturnType<typeof vi.fn> } } }
    expect(api.media.thumbs).toHaveBeenCalled()
  })

  it('shows the empty fallback when nothing matches', async () => {
    const { api } = window as unknown as { api: { media: { query: ReturnType<typeof vi.fn> } } }
    api.media.query.mockResolvedValue({ items: [], total: 0 })

    render(<GallerySearchPanel />)
    expect(await screen.findByText('没有匹配的资产')).toBeTruthy()
  })
})