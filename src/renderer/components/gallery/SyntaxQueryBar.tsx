// 魔导书 Grimoire v7 — 图库语法查询栏
// Advanced query bar: parses the shared search syntax on a 300ms debounce,
// previews predicate chips and diagnostics, and applies the compiled patch to
// the gallery store. Tag resolution goes through the existing tags IPC.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ListFilter, Play, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useGalleryStore } from '../../stores/gallery.store'
import { compileGallerySyntax, type CompiledGallerySyntax, type GallerySyntaxResolvers, type PredicateChip } from '../../lib/gallery-query-builder'

const PLACEHOLDER = 'tag:1girl -tag:lowres parent:expression rating:4..5 "文件名" sort:rating limit:120'

const CHIP_TONES: Record<PredicateChip['kind'], 'neutral' | 'accent' | 'success' | 'danger' | 'warning'> = {
  text: 'neutral',
  tag: 'accent',
  exclude: 'danger',
  parent: 'warning',
  namespace: 'accent',
  attr: 'neutral',
  error: 'danger',
}

export function SyntaxQueryBar({ className }: { className?: string }) {
  const [text, setText] = useState('')
  const [compiled, setCompiled] = useState<CompiledGallerySyntax | null>(null)
  const [busy, setBusy] = useState(false)
  const debounce = useRef(0)
  const requestRef = useRef(0)

  const resolvers = useMemo<GallerySyntaxResolvers>(() => ({
    searchTags: async input => (await window.api.tags.searchAdvanced(input)) as Array<{ tag: { id: string; en?: string; zh?: string }; matchedBy?: string }>,
    expandDescendants: async tagIds => (await window.api.tags.expandRelations({ tagIds, direction: 'descendants' })) as Array<{ tag: { id: string } }>,
  }), [])

  useEffect(() => {
    window.clearTimeout(debounce.current)
    const trimmed = text.trim()
    if (!trimmed) {
      setCompiled(null)
      return
    }
    const current = ++requestRef.current
    debounce.current = window.setTimeout(() => {
      void (async () => {
        const result = await compileGallerySyntax(trimmed, resolvers)
        if (current === requestRef.current) setCompiled(result)
      })()
    }, 300)
    return () => window.clearTimeout(debounce.current)
  }, [text, resolvers])

  const apply = async () => {
    if (!compiled) return
    setBusy(true)
    try {
      const { pageSize, ...queryPatch } = compiled.patch
      useGalleryStore.getState().setQuery(queryPatch)
      if (pageSize) useGalleryStore.setState({ pageSize, page: 0 })
      await useGalleryStore.getState().load()
    } finally {
      setBusy(false)
    }
  }

  const applicable = Boolean(compiled && (compiled.resolvedTagIds.length || compiled.excludedTagIds.length || Object.keys(compiled.patch).length))

  return (
    <div className={`space-y-1.5 p-2 ${className || ''}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]"><ListFilter size={12} aria-hidden="true" />语法查询</span>
        <input
          className="ui-field min-w-0 flex-1"
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="图库语法查询"
        />
        <Button size="sm" variant="primary" icon={Play} onClick={() => void apply()} disabled={busy || !applicable}>应用</Button>
        <Button size="sm" variant="ghost" icon={X} onClick={() => { setText(''); setCompiled(null) }} disabled={busy || !text.trim()}>清空</Button>
      </div>
      {compiled && compiled.chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {compiled.chips.filter(chip => chip.kind !== 'error').map(chip => (
            <Badge key={chip.id} tone={CHIP_TONES[chip.kind]}>{chip.label}</Badge>
          ))}
        </div>
      ) : null}
      {compiled && compiled.errors.length > 0 ? (
        <div role="alert" className="text-[10px] text-[var(--color-danger)]">
          {compiled.errors.map((message, index) => <div key={index}>{message}</div>)}
        </div>
      ) : null}
    </div>
  )
}