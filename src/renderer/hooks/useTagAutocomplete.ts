// 魔导书 Grimoire v7 — 标签自动补全 hook
// TagMaster-style two-stage search: an instant local pass over the loaded tag
// list plus a debounced full search through the main-process query service.
// Stale responses are dropped by a request counter, so fast typing never
// regresses the dropdown.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '@shared/types'
import type { TagSearchResult } from '@shared/tag-intelligence-types'

export interface TagAutocompleteItem {
  id: string
  en: string
  zh: string
  origin: 'local' | 'search'
  matchedBy?: string
  usageCount?: number
}

export interface UseTagAutocompleteOptions {
  allTags: Tag[]
  limit?: number
  debounceMs?: number
  enabled?: boolean
}

export interface UseTagAutocompleteResult {
  query: string
  setQuery: (value: string) => void
  items: TagAutocompleteItem[]
  quickCount: number
  loading: boolean
}

export function useTagAutocomplete({ allTags, limit = 20, debounceMs = 250, enabled = true }: UseTagAutocompleteOptions): UseTagAutocompleteResult {
  const [query, setQuery] = useState('')
  const [remoteResults, setRemoteResults] = useState<TagSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  const quickResults = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return []
    const needle = trimmed.toLowerCase()
    const out: Tag[] = []
    for (const tag of allTags) {
      if (tag.en.toLowerCase().includes(needle) || tag.zh.includes(trimmed)) {
        out.push(tag)
        if (out.length >= 8) break
      }
    }
    return out
  }, [allTags, query])

  useEffect(() => {
    const trimmed = query.trim()
    if (!enabled || !trimmed) {
      requestId.current += 1
      setRemoteResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const current = ++requestId.current
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results = (await window.api.tags.searchAdvanced({ query: trimmed, limit, sort: 'usage' })) as TagSearchResult[]
          if (current !== requestId.current) return
          setRemoteResults(Array.isArray(results) ? results : [])
          setLoading(false)
        } catch {
          if (current !== requestId.current) return
          setRemoteResults([])
          setLoading(false)
        }
      })()
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [query, limit, debounceMs, enabled])

  const items = useMemo<TagAutocompleteItem[]>(() => {
    const seen = new Set<string>()
    const out: TagAutocompleteItem[] = []
    for (const tag of quickResults) {
      if (seen.has(tag.id)) continue
      seen.add(tag.id)
      out.push({ id: tag.id, en: tag.en, zh: tag.zh, origin: 'local' })
    }
    for (const result of remoteResults) {
      const id = String(result?.tag?.id || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        en: String(result.tag.en || ''),
        zh: String(result.tag.zh || ''),
        origin: 'search',
        matchedBy: String(result.matchedBy || ''),
        usageCount: Number(result.usageCount || 0),
      })
    }
    return out
  }, [quickResults, remoteResults])

  return { query, setQuery, items, quickCount: quickResults.length, loading }
}