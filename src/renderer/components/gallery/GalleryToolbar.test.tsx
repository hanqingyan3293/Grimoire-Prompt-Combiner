// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GALLERY_QUERY, useGalleryStore, type SavedSearch } from '../../stores/gallery.store'
import { FilterRail } from './FilterRail'
import { GalleryToolbar } from './GalleryToolbar'
import { SavedSearches } from './SavedSearches'

const savedSearch: SavedSearch = {
  id: 'ss_1',
  name: '星标收藏',
  queryJson: JSON.stringify({ ...DEFAULT_GALLERY_QUERY, search: '猫' }),
  sortJson: JSON.stringify({ sort: 'updated', order: 'desc' }),
  viewMode: 'grid',
  pinned: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
}

interface ApiMock {
  tags: {
    savedSearches: {
      list: ReturnType<typeof vi.fn>
      save: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }
  }
  media: { query: ReturnType<typeof vi.fn>; batchPreview: ReturnType<typeof vi.fn> }
  dialog: {
    save: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
  }
}

let api: ApiMock

// fake timers 下 act 不保证等到 resolved-promise 链尾，主动排空微任务队列
async function flushMicrotasks(rounds = 16): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  api = {
    tags: {
      savedSearches: {
        list: vi.fn().mockResolvedValue([savedSearch]),
        save: vi.fn().mockResolvedValue(savedSearch),
        delete: vi.fn().mockResolvedValue(true),
      },
    },
    media: {
      query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      batchPreview: vi.fn().mockResolvedValue({ assets: 42 }),
    },
    dialog: {
      save: vi.fn().mockResolvedValue(true),
      open: vi.fn().mockResolvedValue(null),
    },
  }
  ;(window as unknown as { api: ApiMock }).api = api
  useGalleryStore.setState({
    query: { ...DEFAULT_GALLERY_QUERY },
    items: [],
    total: 0,
    page: 0,
    selection: new Set<number>(),
    selectionMode: 'explicit',
    selectionLastIndex: null,
    savedSearches: [],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('GalleryToolbar', () => {
  it('debounces the search input into store.query.search', () => {
    render(<GalleryToolbar />)
    const input = screen.getByLabelText('搜索图库')
    fireEvent.change(input, { target: { value: '夜景' } })
    act(() => { vi.advanceTimersByTime(200) })
    expect(useGalleryStore.getState().query.search).toBe('')
    act(() => { vi.advanceTimersByTime(100) })
    expect(useGalleryStore.getState().query.search).toBe('夜景')
  })

  it('changes sort and toggles order', () => {
    render(<GalleryToolbar />)
    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'rating' } })
    expect(useGalleryStore.getState().query.sort).toBe('rating')
    expect(useGalleryStore.getState().query.order).toBe('desc')
    fireEvent.click(screen.getByRole('button', { name: '切换排序方向' }))
    expect(useGalleryStore.getState().query.order).toBe('asc')
  })

  it('select-all-filtered sets the SDIS token and resolves to the query', () => {
    render(<GalleryToolbar />)
    fireEvent.click(screen.getByRole('button', { name: '选择全部筛选' }))
    const state = useGalleryStore.getState()
    expect(state.selectionMode).toBe('allFiltered')
    expect(state.selection.size).toBe(0)
    const resolved = state.resolveSelection()
    expect(resolved.ids).toEqual([])
    expect(resolved.query).toMatchObject({ sort: 'updated', order: 'desc' })
    expect(screen.getByText('全部筛选结果')).toBeTruthy()
  })

  it('asks the backend for the all-filtered count and shows it once resolved', async () => {
    render(<GalleryToolbar />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '选择全部筛选' })) })
    await flushMicrotasks()
    expect(api.media.batchPreview).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ sort: 'updated' }) }))
    expect(screen.getByText('全部筛选结果（42 个资产）')).toBeTruthy()
  })

  it('clear selection restores explicit mode (and is disabled without a selection)', () => {
    render(<GalleryToolbar />)
    const clearButton = () => screen.getByRole('button', { name: '清除选择' }) as HTMLButtonElement
    expect(clearButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '选择全部筛选' }))
    expect(clearButton().disabled).toBe(false)
    fireEvent.click(clearButton())
    const state = useGalleryStore.getState()
    expect(state.selectionMode).toBe('explicit')
    expect(state.selection.size).toBe(0)
  })

  it('saves the current search through the API and refreshes the list', async () => {
    useGalleryStore.setState(state => ({ query: { ...state.query, search: '猫' } }))
    render(<GalleryToolbar />)
    const nameInput = screen.getByLabelText('保存搜索名称') as HTMLInputElement
    const saveButton = () => screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(nameInput, { target: { value: '星标收藏' } })
    expect(saveButton().disabled).toBe(false)
    await act(async () => {
      fireEvent.click(saveButton())
      await flushMicrotasks()
    })
    expect(api.tags.savedSearches.save).toHaveBeenCalledTimes(1)
    const payload = api.tags.savedSearches.save.mock.calls[0][0] as { name: string; queryJson: string; sortJson: string }
    expect(payload.name).toBe('星标收藏')
    expect(JSON.parse(payload.queryJson)).toMatchObject({ search: '猫' })
    expect(payload.sortJson).toContain('updated')
    expect(api.tags.savedSearches.list).toHaveBeenCalled()
    expect(useGalleryStore.getState().savedSearches).toHaveLength(1)
    expect(nameInput.value).toBe('')
    expect(screen.getByText('已保存')).toBeTruthy()
  })
})

describe('SavedSearches', () => {
  it('renders the empty state without auto-loading', () => {
    render(<SavedSearches />)
    expect(screen.getByText('暂无保存的搜索')).toBeTruthy()
    expect(api.tags.savedSearches.list).not.toHaveBeenCalled()
  })

  it('deletes an entry through the API and refreshes the list', async () => {
    useGalleryStore.setState({ savedSearches: [savedSearch] })
    render(<SavedSearches />)
    expect(screen.getByText('星标收藏')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除星标收藏' }))
      await flushMicrotasks()
    })
    expect(api.tags.savedSearches.delete).toHaveBeenCalledWith('ss_1')
    expect(api.tags.savedSearches.list).toHaveBeenCalledTimes(1)
  })

  it('shows the live count for a pinned smart folder and toggles the pin', async () => {
    useGalleryStore.setState({ savedSearches: [{ ...savedSearch, pinned: true }] })
    render(<SavedSearches />)
    await act(async () => { await flushMicrotasks() })
    // 置顶项（智能文件夹）显示后端返回的真实计数（mock 42）。
    expect(screen.getByText('42')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消固定星标收藏' }))
      await flushMicrotasks()
    })
    expect(api.tags.savedSearches.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'ss_1', pinned: false }))
  })
})

describe('FilterRail', () => {
  it('writes source / favorite / tag logic into the store', () => {
    render(<FilterRail />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'ComfyUI 生成' }))
    expect(useGalleryStore.getState().query.sourceKinds).toEqual(['generated-comfy'])
    fireEvent.click(screen.getByRole('radio', { name: '已收藏' }))
    expect(useGalleryStore.getState().query.favorite).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '未收藏' }))
    expect(useGalleryStore.getState().query.favorite).toBe(false)
    fireEvent.change(screen.getByLabelText('标签匹配逻辑'), { target: { value: 'all' } })
    expect(useGalleryStore.getState().query.tagLogic).toBe('all')
  })

  it('resets the query from the header button', () => {
    useGalleryStore.setState({ query: { ...DEFAULT_GALLERY_QUERY, search: 'x', favorite: false, minRating: 3 } })
    render(<FilterRail />)
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    expect(useGalleryStore.getState().query).toEqual(DEFAULT_GALLERY_QUERY)
  })
})

describe('SavedSearches import/export', () => {
  it('exports saved searches to a versioned JSON payload through dialog.save', async () => {
    useGalleryStore.setState({ savedSearches: [savedSearch] })
    render(<SavedSearches />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '导出保存的搜索' }))
      await flushMicrotasks()
    })
    expect(api.dialog.save).toHaveBeenCalledTimes(1)
    const [content, defaultName] = api.dialog.save.mock.calls[0] as [string, string]
    expect(defaultName).toBe('grimoire-saved-searches.json')
    const payload = JSON.parse(content) as { version: number; searches: Array<{ name: string }> }
    expect(payload.version).toBe(1)
    expect(Array.isArray(payload.searches)).toBe(true)
    expect(payload.searches).toHaveLength(1)
    expect(payload.searches[0].name).toBe('星标收藏')
    expect(screen.getByText('已导出 1 条')).toBeTruthy()
  })

  it('imports a valid envelope through savedSearches.save and refreshes the store', async () => {
    const imported: SavedSearch = { ...savedSearch, id: 'ss_2', name: '导入收藏' }
    api.tags.savedSearches.save.mockResolvedValue(imported)
    api.tags.savedSearches.list.mockResolvedValue([savedSearch, imported])
    api.dialog.open.mockResolvedValue(JSON.stringify({
      version: 1,
      searches: [{ name: '导入收藏', queryJson: '{"search":"猫"}', sortJson: '{"sort":"updated","order":"desc"}', viewMode: 'grid', pinned: true }],
    }))
    render(<SavedSearches />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '导入保存的搜索' }))
      await flushMicrotasks()
    })
    expect(api.dialog.open).toHaveBeenCalledTimes(1)
    expect(api.tags.savedSearches.save).toHaveBeenCalledTimes(1)
    const payload = api.tags.savedSearches.save.mock.calls[0][0] as { name: string; queryJson: string; sortJson: string; viewMode: string; pinned: boolean }
    expect(payload.name).toBe('导入收藏')
    expect(payload.queryJson).toBe('{"search":"猫"}')
    expect(payload.pinned).toBe(true)
    expect(api.tags.savedSearches.list).toHaveBeenCalledTimes(1)
    expect(useGalleryStore.getState().savedSearches.map(item => item.name)).toEqual(['星标收藏', '导入收藏'])
    expect(screen.getByText('已导入 1 条（跳过 0 条）')).toBeTruthy()
  })

  it('tolerates a bare array and counts skipped nameless entries', async () => {
    api.dialog.open.mockResolvedValue(JSON.stringify([{ name: '   ' }, { name: '有效项' }, 'junk']))
    render(<SavedSearches />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '导入保存的搜索' }))
      await flushMicrotasks()
    })
    expect(api.tags.savedSearches.save).toHaveBeenCalledTimes(1)
    expect((api.tags.savedSearches.save.mock.calls[0][0] as { name: string }).name).toBe('有效项')
    expect(screen.getByText('已导入 1 条（跳过 2 条）')).toBeTruthy()
  })

  it('reports invalid JSON without calling save', async () => {
    api.dialog.open.mockResolvedValue('not-json{')
    render(<SavedSearches />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '导入保存的搜索' }))
      await flushMicrotasks()
    })
    expect(screen.getByText('导入内容不是有效的保存搜索 JSON')).toBeTruthy()
    expect(api.tags.savedSearches.save).not.toHaveBeenCalled()
  })
})