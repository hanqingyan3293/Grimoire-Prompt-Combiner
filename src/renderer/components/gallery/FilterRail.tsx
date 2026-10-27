// 魔导书 Grimoire v7 — 图库筛选轨（wave D）
// 来源多选 / 收藏三态 / 最低评分 / 标签筛选（任一·全部·排除 + 隐含子标签）。
// 本组件只写入 gallery store 的 query，数据加载由面板 host 的 effect 统一触发。
import React, { useState } from 'react'
import { ListFilter, RotateCcw } from 'lucide-react'
import type { MediaSourceKind } from '@shared/media-types'
import { Button } from '../ui/Button'
import { TagAutocomplete } from '../tags/TagAutocomplete'
import { useGalleryStore, type GalleryQueryState } from '../../stores/gallery.store'
import { useTagsStore } from '../../stores/tags.store'

const SOURCE_KINDS: ReadonlyArray<{ id: MediaSourceKind; label: string }> = [
  { id: 'imported-reference', label: '导入参考' },
  { id: 'generated-comfy', label: 'ComfyUI 生成' },
  { id: 'generated-api', label: 'API 生成' },
  { id: 'project-package', label: '项目包' },
  { id: 'canvas-upload', label: '画布上传' },
]

const FAVORITE_OPTIONS: ReadonlyArray<{ value: boolean | null; label: string }> = [
  { value: null, label: '任意' },
  { value: true, label: '已收藏' },
  { value: false, label: '未收藏' },
]

const RATING_OPTIONS = [1, 2, 3, 4, 5] as const

export function FilterRail({ className }: { className?: string }): React.ReactElement {
  const sourceKinds = useGalleryStore(state => state.query.sourceKinds)
  const favorite = useGalleryStore(state => state.query.favorite)
  const minRating = useGalleryStore(state => state.query.minRating)
  const tagIds = useGalleryStore(state => state.query.tagIds)
  const tagLogic = useGalleryStore(state => state.query.tagLogic)
  const includeImplied = useGalleryStore(state => state.query.includeImplied)
  const setQuery = useGalleryStore(state => state.setQuery)
  const resetQuery = useGalleryStore(state => state.resetQuery)
  const allTags = useTagsStore(state => state.tags)
  // 远端搜索结果可能不在已加载的标签表中，捕获展示名作为兜底
  const [pickedNames, setPickedNames] = useState<Record<string, string>>({})

  const tagName = (id: string): string => {
    const tag = allTags.find(item => item.id === id)
    if (tag) return tag.zh || tag.en
    return pickedNames[id] || id
  }

  const toggleSourceKind = (id: MediaSourceKind, checked: boolean) => {
    setQuery({ sourceKinds: checked ? [...sourceKinds, id] : sourceKinds.filter(value => value !== id) })
  }

  return (
    <div className={`space-y-3 text-xs ${className || ''}`}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 font-medium text-[var(--color-text-primary)]">
          <ListFilter size={13} aria-hidden="true" />筛选
        </span>
        <Button size="sm" icon={RotateCcw} onClick={() => resetQuery()}>重置筛选</Button>
      </div>

      <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2.5">
        <h3 className="text-[10px] font-medium text-[var(--color-text-secondary)]">来源</h3>
        {SOURCE_KINDS.map(kind => (
          <label key={kind.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={sourceKinds.includes(kind.id)}
              onChange={event => toggleSourceKind(kind.id, event.target.checked)}
            />
            {kind.label}
          </label>
        ))}
      </section>

      <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2.5">
        <h3 className="text-[10px] font-medium text-[var(--color-text-secondary)]">收藏</h3>
        {FAVORITE_OPTIONS.map(option => (
          <label key={String(option.value)} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="gallery-favorite"
              checked={favorite === option.value}
              onChange={() => setQuery({ favorite: option.value })}
            />
            {option.label}
          </label>
        ))}
      </section>

      <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2.5">
        <h3 className="text-[10px] font-medium text-[var(--color-text-secondary)]">最低评分</h3>
        <select
          aria-label="最低评分"
          value={minRating}
          onChange={event => setQuery({ minRating: Number(event.target.value) })}
          className="ui-field w-full"
        >
          <option value={0}>不限</option>
          {RATING_OPTIONS.map(score => (
            <option key={score} value={score}>{score} 星及以上</option>
          ))}
        </select>
      </section>

      <section className="space-y-1.5 rounded border border-[var(--color-border)] p-2.5">
        <h3 className="text-[10px] font-medium text-[var(--color-text-secondary)]">标签筛选</h3>
        <TagAutocomplete
          allTags={allTags}
          excludeIds={tagIds}
          placeholder="添加过滤标签…"
          onSelect={item => {
            setPickedNames(previous => ({ ...previous, [item.id]: item.zh || item.en }))
            setQuery({ tagIds: [...tagIds, item.id] })
          }}
        />
        {tagIds.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tagIds.map(id => (
              <span key={id} className="ui-prompt-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]">
                <span>{tagName(id)}</span>
                <button
                  type="button"
                  aria-label={`移除${tagName(id)}`}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]"
                  onClick={() => setQuery({ tagIds: tagIds.filter(value => value !== id) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <div className="w-24 shrink-0">
            <select
              aria-label="标签匹配逻辑"
              value={tagLogic}
              onChange={event => setQuery({ tagLogic: event.target.value as GalleryQueryState['tagLogic'] })}
              className="ui-field w-full"
            >
              <option value="any">任一</option>
              <option value="all">全部</option>
              <option value="none">排除</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeImplied}
              onChange={event => setQuery({ includeImplied: event.target.checked })}
            />
            包含隐含子标签
          </label>
        </div>
      </section>
    </div>
  )
}