// 魔导书 Grimoire v7 — 隐含/关联标签条
// TagMaster behavior: selecting tags expands their implication closure into a
// live strip. Clicking a chip promotes it to an explicit selection; the ✕
// gesture excludes it from implication expansion until promoted again.
import { useEffect, useMemo, useState } from 'react'
import { Link2, X } from 'lucide-react'
import type { Tag } from '@shared/types'
import { usePromptsStore } from '../../stores/prompts.store'

type ImpliedEntry = { tag: Tag; depth: number }

export function ImpliedTagStrip({ className }: { className?: string }) {
  const positive = usePromptsStore(state => state.positive)
  const negative = usePromptsStore(state => state.negative)
  const impliedExcluded = usePromptsStore(state => state.impliedExcluded)
  const addPositive = usePromptsStore(state => state.addPositive)
  const excludeImplied = usePromptsStore(state => state.excludeImplied)
  const includeImplied = usePromptsStore(state => state.includeImplied)
  const [implied, setImplied] = useState<ImpliedEntry[]>([])

  const positiveKey = positive.map(item => item.tag.id).join(',')

  useEffect(() => {
    const selectedIds = positiveKey ? positiveKey.split(',') : []
    if (selectedIds.length === 0) {
      setImplied([])
      return
    }
    let disposed = false
    const timer = window.setTimeout(() => {
      void window.api.tags.expandRelations({ tagIds: selectedIds }).then(value => {
        if (disposed) return
        const entries = value as ImpliedEntry[]
        setImplied(
          (entries || [])
            .filter(entry => entry?.tag && !selectedIds.includes(String(entry.tag.id)) && Number(entry.depth) > 0)
            .map(entry => ({ tag: entry.tag, depth: Number(entry.depth) || 0 })),
        )
      }).catch(() => { if (!disposed) setImplied([]) })
    }, 120)
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [positiveKey])

  const negativeIds = useMemo(() => new Set(negative.map(item => item.tag.id)), [negative])
  const visible = implied.filter(entry => !impliedExcluded.includes(String(entry.tag.id)) && !negativeIds.has(String(entry.tag.id)))

  if (visible.length === 0) return null

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className || ''}`}>
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]">
        <Link2 size={11} aria-hidden="true" />
        隐含/关联
      </span>
      {visible.map(entry => (
        <span key={entry.tag.id} className="ui-prompt-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]">
          <button
            type="button"
            title={`转为显式选择（深度 ${entry.depth}）`}
            onClick={() => {
              includeImplied(String(entry.tag.id))
              addPositive(entry.tag, '', '')
            }}
            className="text-[var(--color-text-primary)] hover:text-[var(--color-accent-text)]">
            {entry.tag.zh || entry.tag.en}
          </button>
          <button
            type="button"
            aria-label={`排除隐含标签${entry.tag.zh || entry.tag.en}`}
            title="不再提示此隐含标签"
            onClick={() => excludeImplied(String(entry.tag.id))}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]">
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}