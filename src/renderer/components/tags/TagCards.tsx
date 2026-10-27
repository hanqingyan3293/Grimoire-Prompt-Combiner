// 魔导书 Grimoire v7 — 标签卡片网格
import React, { useEffect, useState } from "react"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"
import { useSettingsStore } from "../../stores/settings.store"
import { useFavoritesStore } from "../../stores/favorites.store"
import { Modal } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Ban, Bookmark, Inbox, Pencil, Plus, Star, Trash2 } from "lucide-react"
import type { Tag, Subcategory, Category } from "../../../shared/types"

function tagCardScale(value: string) {
  const fontSize = Number.parseInt(value, 10)
  if (fontSize <= 13) return { card: "w-[72px] h-[72px]", text: "text-[11px]", subtext: "text-[9px]" }
  if (fontSize >= 16) return { card: "w-[110px] h-[110px]", text: "text-sm", subtext: "text-xs" }
  return { card: "w-[90px] h-[90px]", text: "text-xs", subtext: "text-[10px]" }
}

export function TagCards() {
  const { categories, updateTag, deleteTag, searchQuery, selectedSubIds } = useTagsStore()
  const { positive, negative, addPositive, addNegative, removePositive, removeNegative, includeImplied, impliedExcluded } = usePromptsStore()
  const favStore = useFavoritesStore()
  const ui_scale = useSettingsStore(s => s.ui_scale)
  const scale = tagCardScale(ui_scale)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tag: Tag } | null>(null)
  const [editTag, setEditTag] = useState<Tag | null>(null)
  const [editEn, setEditEn] = useState("")
  const [editZh, setEditZh] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<Tag | null>(null)
  const [addModal, setAddModal] = useState<{ subId: string; subName: string } | null>(null)
  const [addEn, setAddEn] = useState("")
  const [addZh, setAddZh] = useState("")
  const [searchTagIds, setSearchTagIds] = useState<Set<string> | null>(null)
  const [impliedIds, setImpliedIds] = useState<Set<string>>(new Set())
  // TagMaster 风格分组浏览：按 tag_metadata.namespace 分组展示当前可见标签，
  // 并可只用某一组过滤（未设置 namespace 的标签归入「未分组」）。
  const [groupView, setGroupView] = useState(false)
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const [namespaces, setNamespaces] = useState<Record<string, string>>({})
  const positiveKey = positive.map(p => p.tag.id).join(',')

  useEffect(() => {
    let disposed = false
    if (!searchQuery.trim()) { setSearchTagIds(null); return () => { disposed = true } }
    void window.api.tags.search({ query: searchQuery, limit: 200 }).then((items: any[]) => {
      if (!disposed) setSearchTagIds(new Set(items.map(item => String(item?.tag?.id || '')).filter(Boolean)))
    }).catch(() => { if (!disposed) setSearchTagIds(new Set()) })
    return () => { disposed = true }
  }, [searchQuery])

  // TagMaster-style indeterminate display: tags implied by the current positive
  // selection render dashed. The fetch is debounced and race-guarded; user
  // exclusions are filtered at render time so toggling is instant.
  useEffect(() => {
    const selectedIds = positiveKey ? positiveKey.split(',') : []
    if (selectedIds.length === 0) { setImpliedIds(new Set()); return }
    let disposed = false
    const timer = window.setTimeout(() => {
      void window.api.tags.expandRelations({ tagIds: selectedIds }).then(value => {
        if (disposed) return
        const entries = value as Array<{ tag?: { id?: string } }>
        const next = new Set<string>()
        for (const entry of entries || []) {
          const id = String(entry?.tag?.id || '')
          if (id && !selectedIds.includes(id)) next.add(id)
        }
        setImpliedIds(next)
      }).catch(() => { if (!disposed) setImpliedIds(new Set()) })
    }, 120)
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [positiveKey])

  const selectedSubs: Array<{ sub: Subcategory; cat: Category }> = []
  for (const cat of categories) {
    for (const sub of cat.subcategories) {
      if (selectedSubIds.has(sub.id)) selectedSubs.push({ sub, cat })
    }
  }

  const selectedIds = new Set(positive.map(p => p.tag.id))
  const negativeIds = new Set(negative.map(p => p.tag.id))

  // 分组浏览开启时按 namespace 批量取元数据（只对当前可见子类的标签）。
  useEffect(() => {
    if (!groupView) return
    const ids = [...new Set(selectedSubs.flatMap(({ sub }) => sub.tags.map(tag => tag.id)))]
    if (!ids.length) { setNamespaces({}); return }
    let disposed = false
    void window.api.tags.metadata.list(ids).then(rows => {
      if (disposed) return
      const map: Record<string, string> = {}
      ids.forEach((id, index) => { map[id] = rows[index]?.namespace || '' })
      setNamespaces(map)
    }).catch(() => { if (!disposed) setNamespaces({}) })
    return () => { disposed = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupView, selectedSubIds, categories])

  const handleLeftClick = (tag: Tag, sub: Subcategory, cat: Category) => {
    if (selectedIds.has(tag.id)) removePositive(tag.id)
    else {
      // Promoting an implied tag clears any earlier "exclude implied" gesture.
      includeImplied(tag.id)
      addPositive(tag, cat.zh, sub.zh)
    }
  }

  const handleRightClick = (e: React.MouseEvent, tag: Tag) => {
    e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, tag })
  }

  const handleAddNegative = () => {
    if (!contextMenu) return
    const tag = contextMenu.tag
    for (const cat of categories) {
      for (const sub of cat.subcategories) {
        if (sub.tags.find(t => t.id === tag.id)) {
          if (negativeIds.has(tag.id)) removeNegative(tag.id)
          else addNegative(tag, cat.zh, sub.zh)
          break
        }
      }
    }
    setContextMenu(null)
  }

  const openEdit = (tag: Tag) => { setEditTag(tag); setEditEn(tag.en); setEditZh(tag.zh); setContextMenu(null) }

  const handleSaveEdit = async () => {
    if (!editTag || !editEn.trim() || !editZh.trim()) return
    await updateTag(editTag.id, editEn.trim(), editZh.trim())
    setEditTag(null)
  }

  const handleDeleteTag = async () => {
    if (!deleteConfirm) return
    await deleteTag(deleteConfirm.id)
    setDeleteConfirm(null)
  }

  const handleAddTag = async () => {
    if (!addEn.trim() || !addZh.trim() || !addModal) return
    const { addTag } = useTagsStore.getState()
    await addTag({ subcategory_id: addModal.subId, en: addEn.trim(), zh: addZh.trim() })
    setAddModal(null); setAddEn(""); setAddZh("")
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto p-4">
      {selectedSubs.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-[var(--color-text-secondary)]">
            <Inbox size={28} className="mx-auto mb-3 opacity-65" aria-hidden="true" />
            <div className="text-sm">点击左侧子类查看标签</div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 p-[2px]">
          {/* TagMaster 分组浏览开关 + namespace 过滤 */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={groupView} onChange={event => { setGroupView(event.target.checked); if (!event.target.checked) setNamespaceFilter('') }} />
              分组浏览（按命名空间）
            </label>
            {groupView ? (
              <select className="ui-field w-40" value={namespaceFilter} onChange={event => setNamespaceFilter(event.target.value)} aria-label="命名空间过滤">
                <option value="">全部命名空间</option>
                {[...new Set(Object.values(namespaces).filter(Boolean))].sort().map(value => <option key={value} value={value}>{value}</option>)}
                {Object.values(namespaces).some(value => !value) ? <option value="__ungrouped__">未分组</option> : null}
              </select>
            ) : null}
          </div>
          {selectedSubs.map(({ sub, cat }) => {
            const base = searchQuery
              ? sub.tags.filter(t => t.en.toLowerCase().includes(searchQuery.toLowerCase()) || t.zh.includes(searchQuery) || Boolean(searchTagIds?.has(t.id)))
              : sub.tags
            // 分组视图下按所选 namespace 收窄（未分组项在「未分组」选项里）。
            const filtered = groupView && namespaceFilter
              ? base.filter(tag => (namespaces[tag.id] || '') === (namespaceFilter === '__ungrouped__' ? '' : namespaceFilter))
              : base
            if (groupView && namespaceFilter && filtered.length === 0) return null
            return (
              <div key={sub.id} className="ui-list-card ui-list-card-no-hover p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    <span className="text-[var(--color-accent-text)]">{cat.zh}</span>
                    <span className="mx-1">/</span>
                    <span>{sub.zh}</span>
                    <span className="ml-2 opacity-50">({filtered.length})</span>
                  </div>
                  <Button size="sm" icon={Plus} onClick={() => setAddModal({ subId: sub.id, subName: sub.zh })}>添加标签</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filtered.map(tag => {
                    const isPositive = selectedIds.has(tag.id)
                    const isNegative = negativeIds.has(tag.id)
                    const isImplied = !isPositive && !isNegative && impliedIds.has(tag.id) && !impliedExcluded.includes(tag.id)
                    return (
                      <button key={tag.id}
                        onClick={() => handleLeftClick(tag, sub, cat)}
                        onContextMenu={(e) => handleRightClick(e, tag)}
                        title={isImplied ? "被所选标签隐含，点击转为显式" : undefined}
                        className={`ui-tag-card ${scale.card} flex flex-col items-center justify-center rounded border p-1 relative overflow-hidden ${isPositive ? "ui-tag-card-positive" : isNegative ? "ui-tag-card-negative" : isImplied ? "ui-tag-card-implied" : ""}`}>
                        {isPositive && isNegative && (
                          <div className="ui-tag-card-mixed-bar absolute left-0 top-0 bottom-0 w-[3px]" />
                        )}
                        <div className="flex items-start justify-center gap-1"><span className={`${scale.text} font-medium text-[var(--color-text-primary)] text-center leading-tight line-clamp-2`}>{tag.zh}</span>{favStore.isTagFav(tag.id) && <Star size={11} className="mt-0.5 shrink-0 fill-[var(--color-warning)] text-[var(--color-warning)]" aria-label="已收藏" />}</div>
                        <div className={`${scale.subtext} opacity-50 truncate mt-0.5 max-w-full`}>{tag.en}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (<>
        <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
        <div className="ui-popover-surface ui-popover-menu fixed z-50 min-w-[180px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={handleAddNegative} className="ui-menu-item flex items-center gap-2 px-3 py-2 text-sm"><Ban size={15} aria-hidden="true" />{negativeIds.has(contextMenu.tag.id) ? "取消负面" : "加入负面"}</button>
          <button onClick={() => { favStore.toggleTagFav(contextMenu!.tag.id); setContextMenu(null) }} className="ui-menu-item flex items-center gap-2 px-3 py-2 text-sm"><Bookmark size={15} aria-hidden="true" />{favStore.isTagFav(contextMenu!.tag.id) ? "取消收藏" : "收藏"}</button>
          <button onClick={() => openEdit(contextMenu.tag)} className="ui-menu-item flex items-center gap-2 px-3 py-2 text-sm"><Pencil size={15} aria-hidden="true" />编辑</button>
          <div className="ui-menu-divider" />
          <button onClick={() => { setDeleteConfirm(contextMenu.tag); setContextMenu(null) }} className="ui-menu-item flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-danger)]"><Trash2 size={15} aria-hidden="true" />删除</button>
        </div>
      </>)}

      {/* Edit Tag Modal */}
      <Modal title="编辑标签" open={!!editTag} onClose={() => setEditTag(null)}>
        <div className="space-y-4 p-2" onClick={e => e.stopPropagation()}>
          <div><label className="text-xs text-[var(--color-text-secondary)]">英文名</label>
            <input value={editEn} onChange={e => setEditEn(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit() }}
              className="ui-field mt-1.5" autoFocus /></div>
          <div><label className="text-xs text-[var(--color-text-secondary)]">中文名</label>
            <input value={editZh} onChange={e => setEditZh(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit() }}
              className="ui-field mt-1.5" /></div>
          <div className="flex gap-3 pt-2">
            <Button onClick={() => setEditTag(null)} className="flex-1">取消</Button>
            <Button variant="primary" onClick={handleSaveEdit} className="flex-1">保存</Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal title="确认删除" open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <div className="space-y-4 p-2" onClick={e => e.stopPropagation()}>
          <p className="text-sm">确定删除标签 &ldquo;{deleteConfirm?.zh}&rdquo;？此操作不可撤销。</p>
          <div className="flex gap-3 pt-2">
            <Button onClick={() => setDeleteConfirm(null)} className="flex-1">取消</Button>
            <Button variant="danger" icon={Trash2} onClick={handleDeleteTag} className="flex-1">删除</Button>
          </div>
        </div>
      </Modal>

      {/* Add Tag Modal */}
      <Modal title={`添加标签到 ${addModal?.subName || ""}`} open={!!addModal} onClose={() => setAddModal(null)}>
        <div className="space-y-4 p-2" onClick={e => e.stopPropagation()}>
          <div><label className="text-xs text-[var(--color-text-secondary)]">英文名</label>
            <input value={addEn} onChange={e => setAddEn(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddTag() }}
              className="ui-field mt-1.5" autoFocus /></div>
          <div><label className="text-xs text-[var(--color-text-secondary)]">中文名</label>
            <input value={addZh} onChange={e => setAddZh(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddTag() }}
              className="ui-field mt-1.5" /></div>
          <div className="flex gap-3 pt-2">
            <Button onClick={() => setAddModal(null)} className="flex-1">取消</Button>
            <Button variant="primary" icon={Plus} onClick={handleAddTag} className="flex-1">添加</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
