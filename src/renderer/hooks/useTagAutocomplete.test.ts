// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tag } from '@shared/types'
import type { TagSearchResult } from '@shared/tag-intelligence-types'
import { useTagAutocomplete } from './useTagAutocomplete'

const tags: Tag[] = [
  { id: 'tag_1', subcategory_id: 'sub', en: '1girl', zh: '单个女孩', sort_order: 0, source: 'builtin', created_at: '' },
  { id: 'tag_2', subcategory_id: 'sub', en: 'solo', zh: '单人', sort_order: 1, source: 'builtin', created_at: '' },
]

const searchAdvanced = vi.fn()

function remoteResult(id: string, en: string, zh: string, matchedBy = 'fuzzy'): TagSearchResult {
  return {
    tag: { id, subcategory_id: 'sub', en, zh, sort_order: 0, source: 'builtin', created_at: '' },
    matchedBy: matchedBy as TagSearchResult['matchedBy'],
    score: 0.65,
    usageCount: 3,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  searchAdvanced.mockReset()
  ;(window as unknown as { api: unknown }).api = { tags: { searchAdvanced } }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTagAutocomplete', () => {
  it('returns instant local matches and debounced remote results', async () => {
    searchAdvanced.mockResolvedValue([remoteResult('tag_1', '1girl', '单个女孩'), remoteResult('tag_9', 'smile', '微笑', 'alias')])
    const { result } = renderHook(() => useTagAutocomplete({ allTags: tags }))

    act(() => result.current.setQuery('gir'))
    expect(result.current.items.some(item => item.id === 'tag_1' && item.origin === 'local')).toBe(true)
    expect(searchAdvanced).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(260)
      await Promise.resolve()
    })

    expect(searchAdvanced).toHaveBeenCalledWith({ query: 'gir', limit: 20, sort: 'usage' })
    expect(result.current.items.map(item => item.id)).toEqual(['tag_1', 'tag_9'])
    expect(result.current.items.find(item => item.id === 'tag_9')?.matchedBy).toBe('alias')
    expect(result.current.loading).toBe(false)
  })

  it('drops stale responses when typing continues', async () => {
    let resolveFirst: (value: TagSearchResult[]) => void = () => {}
    const first = new Promise<TagSearchResult[]>(resolve => { resolveFirst = resolve })
    searchAdvanced.mockReturnValueOnce(first)
    searchAdvanced.mockResolvedValueOnce([remoteResult('tag_2', 'solo', '单人')])

    const { result } = renderHook(() => useTagAutocomplete({ allTags: [] }))
    act(() => result.current.setQuery('a'))
    await act(async () => { vi.advanceTimersByTime(260) })
    act(() => result.current.setQuery('ab'))
    await act(async () => {
      vi.advanceTimersByTime(260)
      await Promise.resolve()
    })

    await act(async () => {
      resolveFirst([remoteResult('tag_1', '1girl', '单个女孩')])
      await first
    })

    expect(result.current.items.map(item => item.id)).toEqual(['tag_2'])
  })

  it('clears results on failure without throwing', async () => {
    searchAdvanced.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTagAutocomplete({ allTags: [] }))

    act(() => result.current.setQuery('x'))
    await act(async () => {
      vi.advanceTimersByTime(260)
      await Promise.resolve()
    })

    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})