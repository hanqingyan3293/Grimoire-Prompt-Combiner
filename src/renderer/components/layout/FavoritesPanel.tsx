// 魔导书 Grimoire v7 - 收藏面板
import React, { useState, useEffect } from "react"
import { useTagsStore } from "../../stores/tags.store"
import { useFavoritesStore } from "../../stores/favorites.store"
import { usePromptsStore } from "../../stores/prompts.store"

interface FavPanelProps {
  onCtxMenu: (e: any, data: any) => void
  onFavCtxMenu: (e: any, data: any) => void
}

export function FavoritesPanel({ onCtxMenu, onFavCtxMenu }: FavPanelProps) {
  const store = useTagsStore()
  const favStore = useFavoritesStore()
  const promptsStore = usePromptsStore()
  const categories = store.categories

  const [tagCatExpanded, setTagCatExpanded] = useState<Set<string>>(new Set())
  const [tagSubExpanded, setTagSubExpanded] = useState<Set<string>>(new Set())

  const posIds = new Set(promptsStore.positive.map((p: any) => p.tag.id))

  const tagLookup = new Map<string, any>()
  for (const cat of categories) {
    for (const sub of cat.subcategories) {
      for (const t of sub.tags) {
        tagLookup.set(t.id, { tag: t, catZh: cat.zh, subZh: sub.zh, catId: cat.id, subId: sub.id })
      }
    }
  }

  const groupedTags = new Map<string, Map<string, any[]>>()
  const noCategoryTags: any[] = []
  for (const fav of favStore.tagFavs) {
    const info = tagLookup.get(fav.id)
    if (info) {
      if (!groupedTags.has(info.catId)) groupedTags.set(info.catId, new Map())
      const subMap = groupedTags.get(info.catId)!
      if (!subMap.has(info.subId)) subMap.set(info.subId, [])
      subMap.get(info.subId)!.push({ ...fav, ...info })
    } else {
      noCategoryTags.push(fav)
    }
  }

  // Auto-expand all tag categories on first load
  useEffect(() => {
    if (groupedTags.size > 0 && tagCatExpanded.size === 0) {
      setTagCatExpanded(new Set(Array.from(groupedTags.keys())))
    }
  }, [groupedTags.size])

  if (favStore.loading) {
    return <div className="text-sm text-[var(--color-text-secondary)] text-center py-6">加载中...</div>
  }

  const toggleTagCat = (id: string) => {
    setTagCatExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const toggleTagSub = (id: string) => {
    setTagSubExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const handleTagClick = (tagData: any, catZh: string, subZh: string) => {
    const ps = usePromptsStore.getState()
    const curPos = new Set(ps.positive.map((p: any) => p.tag.id))
    if (curPos.has(tagData.id)) {
      ps.removePositive(tagData.id)
    } else {
      ps.addPositive(tagData, catZh, subZh)
    }
  }

  const empty = favStore.subFavs.length === 0 && favStore.tagFavs.length === 0
  if (empty) {
    return (
      <div className="text-sm text-[var(--color-text-secondary)] text-center py-10">
        <div className="text-3xl mb-3">⭐</div>
        <div>还没有收藏</div>
        <div className="text-xs mt-1 opacity-70">右键子类或标签来添加收藏</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3">
      {/* ===== 收藏的子类 ===== */}
      {favStore.subFavs.length > 0 && (
        <div className="ui-tree-card">
          <div className="ui-tree-header flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">⭐ 收藏的子类</span>
            <span className="text-xs text-[var(--color-text-secondary)] ml-auto">{favStore.subFavs.length}</span>
          </div>
          <div className="bg-[var(--color-bg-primary)]/30">
            {favStore.subFavs.map((sub: any) => {
              const sel = store.selectedSubIds.has(sub.id)
              return (
                <div key={sub.id}
                  onClick={() => store.toggleSubSelect(sub.id)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e, { x: e.clientX, y: e.clientY, type: "subcategory", id: sub.id, name: sub.zh, parentId: sub.category_id }) }}
                  className={"flex cursor-pointer items-center gap-1 border-b border-[var(--color-border)]/20 pl-5 pr-2 py-1.5 text-xs group last:border-b-0 " + (sel ? "ui-tree-row-active" : "ui-tree-row")}>
                  <span className="flex-1">{sub.zh}</span>
                  <span className="text-[9px] opacity-50 mr-1">{sub.cat_zh}</span>
                  <span className="text-[9px] opacity-50 w-5 text-right">{sub.tag_count}</span>
                  {sel && <span className="text-[10px]">✓</span>}
                  <button onClick={(e) => { e.stopPropagation(); favStore.toggleSubFav(sub.id) }}
                    className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-0.5" title="取消收藏">✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== 收藏的标签 (3级层级) ===== */}
      {favStore.tagFavs.length > 0 && (
        <div className="ui-tree-card">
          <div className="ui-tree-header flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">⭐ 收藏的标签</span>
            <span className="text-xs text-[var(--color-text-secondary)] ml-auto">{favStore.tagFavs.length}</span>
          </div>
          <div>
            {Array.from(groupedTags.entries()).map(([catId, subMap]) => {
              const catName = Array.from(subMap.values())[0]?.[0]?.catZh || catId
              const isExp = tagCatExpanded.has(catId)
              const totalInCat = Array.from(subMap.values()).reduce((s: number, tags: any[]) => s + tags.length, 0)
              return (
                <div key={catId} className="border-b border-[var(--color-border)]/30 last:border-b-0">
                  {/* L1: 大类 */}
                  <div onClick={() => toggleTagCat(catId)}
                    className="ui-tree-header flex cursor-pointer items-center gap-1.5 px-3 py-1.5">
                    <span className="text-xs w-3 text-center transition-transform" style={{ transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                    <span className="flex-1 text-xs font-semibold text-[var(--color-text-primary)]">{catName}</span>
                    <span className="text-[10px] text-[var(--color-text-secondary)] bg-[var(--color-bg-primary)]/50 px-1.5 rounded">{totalInCat}</span>
                  </div>
                  {isExp && (
                    <div className="bg-[var(--color-bg-primary)]/30 border-t border-[var(--color-border)]/20">
                      {Array.from(subMap.entries()).map(([subId, tags]) => {
                        const subName = tags[0]?.subZh || subId
                        const isSubExp = tagSubExpanded.has(subId)
                        return (
                          <div key={subId}>
                            {/* L2: 子类 */}
                            <div onClick={() => toggleTagSub(subId)}
                              className="ui-tree-row flex cursor-pointer items-center gap-1.5 border-b border-[var(--color-border)]/10 pl-7 pr-2 py-1.5 text-xs">
                              <span className="text-[10px] w-3 text-center transition-transform opacity-60" style={{ transform: isSubExp ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                              <span className="flex-1">{subName}</span>
                              <span className="text-[9px] opacity-40">{tags.length}</span>
                            </div>
                            {isSubExp && (
                              <div className="ml-6 pl-3 border-l-2 border-[var(--color-accent)]/20 bg-[var(--color-bg-secondary)]/30">
                                {/* L3: 标签 */}
                                {tags.map((item: any) => {
                                  const tagData = item.tag || item
                                  const isPos = posIds.has(tagData.id)
                                  return (
                                    <div key={item.fav_id || tagData.id}
                                      onClick={() => handleTagClick(tagData, item.catZh || '', item.subZh || '')}
                                      onContextMenu={(e) => {
                                        e.preventDefault()
                                        const ps = usePromptsStore.getState()
                                        onFavCtxMenu(e, {
                                          x: e.clientX, y: e.clientY,
                                          tag: tagData,
                                          catZh: item.catZh || '',
                                          subZh: item.subZh || '',
                                          isNegative: new Set(ps.negative.map((p: any) => p.tag.id)).has(tagData.id)
                                        })
                                      }}
                                      className={"flex cursor-pointer items-center gap-1 border-b border-[var(--color-border)]/10 pl-2 pr-2 py-1 text-xs group last:border-b-0 " + (isPos ? "ui-tree-row-active" : "ui-tree-row")}>
                                      <span className="flex-1 truncate">{tagData.zh || item.zh || tagData.en || ''}</span>
                                      <span className="text-[9px] opacity-35">{tagData.en}</span>
                                      {isPos && <span className="text-[10px]">✓</span>}
                                      <button onClick={(e) => { e.stopPropagation(); favStore.toggleTagFav(tagData.id) }}
                                        className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-0.5" title="取消收藏">✕</button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {noCategoryTags.length > 0 && noCategoryTags.map((tag: any) => {
              const isPos = posIds.has(tag.id)
              return (
                <div key={tag.id || tag.fav_id}
                  onClick={() => handleTagClick(tag, '', '')}
                  className={"flex cursor-pointer items-center gap-1 border-b border-[var(--color-border)]/10 pl-4 pr-2 py-1.5 text-xs last:border-b-0 " + (isPos ? "ui-tree-row-active" : "ui-tree-row")}>
                  <span className="flex-1">{tag.zh || tag.en || ''}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
