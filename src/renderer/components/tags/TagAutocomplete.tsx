// 魔导书 Grimoire v7 — 标签自动补全输入框
// TagMaster-style dropdown: instant local matches, debounced full search,
// alias and usage badges, keyboard listbox navigation and IME-safe Enter
// handling (Enter during composition never selects an item).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '@shared/types'
import { useTagAutocomplete, type TagAutocompleteItem } from '../../hooks/useTagAutocomplete'

export interface TagAutocompleteProps {
  allTags: Tag[]
  placeholder?: string
  autoFocus?: boolean
  excludeIds?: string[]
  onSelect: (item: TagAutocompleteItem) => void
  className?: string
}

export function TagAutocomplete({ allTags, placeholder, autoFocus, excludeIds, onSelect, className }: TagAutocompleteProps) {
  const { query, setQuery, items, loading } = useTagAutocomplete({ allTags })
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const composing = useRef(false)
  const excluded = useMemo(() => new Set(excludeIds || []), [excludeIds])
  const visible = useMemo(() => items.filter(item => !excluded.has(item.id)), [items, excluded])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  const choose = (item: TagAutocompleteItem) => {
    onSelect(item)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={`relative ${className || ''}`}>
      <input
        type="text"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder || '搜索标签…'}
        aria-label="标签自动补全"
        role="combobox"
        aria-expanded={open && visible.length > 0}
        aria-controls="tag-autocomplete-list"
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setHighlight(current => Math.min(Math.max(0, visible.length - 1), current + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlight(current => Math.max(0, current - 1))
          } else if (event.key === 'Enter') {
            const item = visible[highlight]
            if (open && item) {
              event.preventDefault()
              choose(item)
            }
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      {open && query.trim() ? (
        <div
          id="tag-autocomplete-list"
          role="listbox"
          aria-label="标签候选"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-lg">
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-secondary)]">{loading ? '搜索中…' : '无匹配标签'}</div>
          ) : (
            visible.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(item)}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs ${index === highlight ? 'bg-[var(--color-bg-primary)]' : ''}`}>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
                  {item.zh || item.en}
                  {item.zh && item.en ? <span className="ml-1.5 text-[var(--color-text-secondary)]">{item.en}</span> : null}
                </span>
                {item.matchedBy === 'alias' ? (
                  <span className="rounded border border-[var(--color-border)] px-1 text-[9px] text-[var(--color-text-secondary)]">别名</span>
                ) : null}
                {(item.usageCount || 0) > 0 ? <span className="text-[9px] text-[var(--color-text-secondary)]">{item.usageCount}</span> : null}
              </button>
            ))
          )}
          {loading && visible.length > 0 ? <div className="px-2 py-1 text-[9px] text-[var(--color-text-secondary)]">搜索中…</div> : null}
        </div>
      ) : null}
    </div>
  )
}