// 魔导书 Grimoire v7 — 标签卡片网格
import React, { useState, useMemo } from "react"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"
import { useSettingsStore } from "../../stores/settings.store"
import { useFavoritesStore } from "../../stores/favorites.store"
import { Modal } from "../ui/Modal"
import type { Tag, Subcategory, Category } from "../../../shared/types"

const SCALE_SIZES: Record<string, { card: string; text: string; subtext: string }> = {
  small:  { card: "w-[72px] h-[72px]", text: "text-[11px]", subtext: "text-[9px]" },
  medium: { card: "w-[90px] h-[90px]", text: "text-xs",     subtext: "text-[10px]" },
  large:  { card: "w-[110px] h-[110px]", text: "text-sm",   subtext: "text-xs" },
}

export function TagCards() {
  const { categories, loadTags, updateTag, deleteTag, searchQuery, selectedSubIds } = useTagsStore()
  const { positive, negative, addPositive, addNegative, removePositive, removeNegative } = usePromptsStore()
  const favStore = useFavoritesStore()
  const ui_scale = useSettingsStore(s => s.ui_scale)
  const custom_accent = useSettingsStore(s => s.custom_accent)

  const scale = SCALE_SIZES[ui_scale] || SCALE_SIZES.medium

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tag: Tag } | null>(null)
  const [editTag, setEditTag] = useState<Tag | null>(null)
  const [editEn, setEditEn] = useState("")
  const [editZh, setEditZh] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<Tag | null>(null)
  const [addModal, setAddModal] = useState<{ subId: string; subName: string } | null>(null)
  const [addEn, setAddEn] = useState("")
  const [addZh, setAddZh] = useState("")

  const negativeGlowColor = useMemo(() => {
    const hex = (custom_accent || "#a855f7").replace("#", "")
    const r = 255 - parseInt(hex.substring(0, 2), 16)
    const g = 255 - parseInt(hex.substring(2, 4), 16)
    const b = 255 - parseInt(hex.substring(4, 6), 16)
    return `rgba(${r},${g},${b},0.25)`
  }, [custom_accent])

  const negativeBorderColor = useMemo(() => {
    const hex = (custom_accent || "#a855f7").replace("#", "")
    const r = 255 - parseInt(hex.substring(0, 2), 16)
    const g = 255 - parseInt(hex.substring(2, 4), 16)
    const b = 255 - parseInt(hex.substring(4, 6), 16)
    return `rgba(${r},${g},${b},0.6)`
  }, [custom_accent])

  const selectedSubs: Array<{ sub: Subcategory; cat: Category }> = []
  for (const cat of categories) {
    for (const sub of cat.subcategories) {
      if (selectedSubIds.has(sub.id)) selectedSubs.push({ sub, cat })
    }
  }

  const selectedIds = new Set(positive.map(p => p.tag.id))
  const negativeIds = new Set(negative.map(p => p.tag.id))

  const handleLeftClick = (tag: Tag, sub: Subcategory, cat: Category) => {
    if (selectedIds.has(tag.id)) removePositive(tag.id)
    else addPositive(tag, cat.zh, sub.zh)
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
    <div className="h-full overflow-y-auto p-4">
      {selectedSubs.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-[var(--color-text-secondary)]">
            <div className="text-4xl mb-3">📨</div>
            <div className="text-sm">点击左侧子类查看标签</div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {selectedSubs.map(({ sub, cat }) => {
            const filtered = searchQuery
              ? sub.tags.filter(t => t.en.toLowerCase().includes(searchQuery.toLowerCase()) || t.zh.includes(searchQuery))
              : sub.tags
            return (
              <div key={sub.id} className="ui-list-card ui-list-card-no-hover p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    <span className="text-[var(--color-accent)]">{cat.zh}</span>
                    <span className="mx-1">/</span>
                    <span>{sub.zh}</span>
                    <span className="ml-2 opacity-50">({filtered.length})</span>
                  </div>
                  <button onClick={() => setAddModal({ subId: sub.id, subName: sub.zh })}
                    className="ui-subtle-button px-2 py-1 text-[10px]">
                    + 添加标签
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filtered.map(tag => {
                    const isPositive = selectedIds.has(tag.id)
                    const isNegative = negativeIds.has(tag.id)
                    let bgStyle = {}
                    let borderStyle = {}
                    if (isPositive) {
                      bgStyle = { backgroundColor: `${custom_accent || "#a855f7"}25` }
                      borderStyle = { borderColor: `${custom_accent || "#a855f7"}50`, boxShadow: `0 0 8px ${custom_accent || "#a855f7"}40` }
                    } else if (isNegative) {
                      bgStyle = { backgroundColor: negativeGlowColor }
                      borderStyle = { borderColor: negativeBorderColor, boxShadow: `0 0 8px ${negativeBorderColor}` }
                    }
                    return (
                      <button key={tag.id}
                        onClick={() => handleLeftClick(tag, sub, cat)}
                        onContextMenu={(e) => handleRightClick(e, tag)}
                        className={`${scale.card} flex flex-col items-center justify-center border rounded cursor-pointer transition-all hover:shadow-md p-1 relative overflow-hidden`}
                        style={{ ...bgStyle, ...borderStyle }}>
                        {isPositive && isNegative && (
                          <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: negativeBorderColor }} />
                        )}
                        <div className="flex items-start justify-center gap-0.5"><span className={`${scale.text} font-medium text-[var(--color-text-primary)] text-center leading-tight line-clamp-2`}>{tag.zh}</span>{favStore.isTagFav(tag.id) && <span className="text-[10px] leading-none shrink-0 mt-0.5">⭐</span>}</div>
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
        <div className="fixed z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded shadow-2xl py-1.5 min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={handleAddNegative} className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15">{negativeIds.has(contextMenu.tag.id) ? "✓ 取消负面" : "☒ 加入负面"}</button>
          <button onClick={() => { favStore.toggleTagFav(contextMenu!.tag.id); setContextMenu(null) }} className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15">{favStore.isTagFav(contextMenu!.tag.id) ? "★ 取消收藏" : "☆ 收藏"}</button>
          <button onClick={() => openEdit(contextMenu.tag)} className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15">✏ 编辑</button>
          <div className="border-t border-[var(--color-border)] my-1" />
          <button onClick={() => { setDeleteConfirm(contextMenu.tag); setContextMenu(null) }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/15">🗑 删除</button>
        </div>
      </>)}

      {/* Edit Tag Modal */}
      <Modal title="编辑标签" open={!!editTag} onClose={() => setEditTag(null)}>
        <div className="space-y-4 p-2" onClick={e => e.stopPropagation()}>
          <div><label className="text-xs text-[var(--color-text-secondary)]">英文名</label>
            <input value={editEn} onChange={e => setEditEn(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit() }}
              className="w-full mt-1.5 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" autoFocus /></div>
          <div><label className="text-xs text-[var(--color-text-secondary)]">中文名</label>
            <input value={editZh} onChange={e => setEditZh(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSaveEdit() }}
              className="w-full mt-1.5 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" /></div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditTag(null)} className="flex-1 py-3 text-sm bg-[var(--color-bg-tertiary)] rounded">取消</button>
            <button onClick={handleSaveEdit} className="flex-1 py-3 text-sm bg-[var(--color-accent)] text-white rounded">保存</button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal title="确认删除" open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <div className="space-y-4 p-2" onClick={e => e.stopPropagation()}>
          <p className="text-sm">确定删除标签 &ldquo;{deleteConfirm?.zh}&rdquo;？此操作不可撤销。</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-3 text-sm bg-[var(--color-bg-tertiary)] rounded">取消</button>
            <button onClick={handleDeleteTag} className="flex-1 py-3 text-sm bg-red-500 text-white rounded">删除</button>
          </div>
        </div>
      </Modal>

      {/* Add Tag Modal */}
      <Modal title={`添加标签到 ${addModal?.subName || ""}`} open={!!addModal} onClose={() => setAddModal(null)}>
        <div className="space-y-4 p-2" onClick={e => e.stopPropagation()}>
          <div><label className="text-xs text-[var(--color-text-secondary)]">英文名</label>
            <input value={addEn} onChange={e => setAddEn(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddTag() }}
              className="w-full mt-1.5 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" autoFocus /></div>
          <div><label className="text-xs text-[var(--color-text-secondary)]">中文名</label>
            <input value={addZh} onChange={e => setAddZh(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddTag() }}
              className="w-full mt-1.5 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" /></div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setAddModal(null)} className="flex-1 py-3 text-sm bg-[var(--color-bg-tertiary)] rounded">取消</button>
            <button onClick={handleAddTag} className="flex-1 py-3 text-sm bg-[var(--color-accent)] text-white rounded">添加</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
