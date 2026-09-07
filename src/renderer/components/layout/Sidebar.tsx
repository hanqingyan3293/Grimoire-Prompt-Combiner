// 魔导书 Grimoire v7 — 左侧栏 (标签库 / 收藏)
import React, { useState, useEffect, useRef } from "react"
import { useTagsStore } from "../../stores/tags.store"
import { useFavoritesStore } from "../../stores/favorites.store"
import { usePromptsStore } from "../../stores/prompts.store"
import { Modal } from "../ui/Modal"
import { FavoritesPanel } from "./FavoritesPanel"

type TabType = "tags" | "favorites"

export function Sidebar() {
  const store = useTagsStore()
  const favStore = useFavoritesStore()
  const categories = store.categories
  const loading = store.loading
  const searchQuery = store.searchQuery

  const [activeTab, setActiveTab] = useState<TabType>("tags")
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [editModal, setEditModal] = useState<{ type: "category" | "subcategory"; id?: string; parentId?: string; zh?: string } | null>(null)
  const [editZh, setEditZh] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [groups, setGroups] = useState<any[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string>("default")
  const [newGroupName, setNewGroupName] = useState("")
  const [showNewGroupInput, setShowNewGroupInput] = useState(false)
  const [renamingGroup, setRenamingGroup] = useState<{id:string,name:string}|null>(null)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: "category" | "subcategory"; id: string; name: string; parentId?: string } | null>(null)
  const [favCtxMenu, setFavCtxMenu] = useState<{ x: number; y: number; tag: any; catZh: string; subZh: string; isNegative: boolean } | null>(null)

  useEffect(() => { setExpandedCats(prev => { const n = new Set(prev); categories.forEach(c => n.add(c.id)); return n }) }, [categories])
  useEffect(() => { favStore.loadFavorites() }, [])
  useEffect(() => { loadGroups() }, [])

  const loadGroups = async () => {
    try {
      const list = await window.api.tagGroups.list()
      setGroups(list || [])
      const active = (list || []).find((g: any) => g.is_active)
      if (active) setActiveGroupId(active.id)
    } catch (e) { /* ignore */ }
  }

  const switchGroup = async (id: string) => {
    try {
      await window.api.tagGroups.setActive(id)
      setActiveGroupId(id)
      await store.loadTags()
      setGroupMenuOpen(false)
      toast("已切换到标签组", "success")
    } catch (e: any) { toast("切换失败: " + (e?.message || String(e)), "error") }
  }

  const createGroup = async () => {
    const name = newGroupName.trim()
    if (!name) return
    try {
      await window.api.tagGroups.create(name, activeGroupId)
      setNewGroupName("")
      setShowNewGroupInput(false)
      await loadGroups()
      toast("已创建标签组", "success")
    } catch (e: any) { toast("创建失败: " + (e?.message || String(e)), "error") }
  }

  const deleteGroup = async (id: string) => {
    const g = groups.find((x: any) => x.id === id)
    if (!confirm(g ? '确定删除标签组 "' + g.name + '"？其下所有标签数据将被删除。' : '确定删除？')) return
    try {
      await window.api.tagGroups.delete(id)
      await loadGroups()
      if (id === activeGroupId) {
        const list = await window.api.tagGroups.list()
        const first = (list || []).find((x: any) => x.id !== id)
        if (first) { await window.api.tagGroups.setActive(first.id); setActiveGroupId(first.id); await store.loadTags() }
      }
      toast("已删除", "success")
    } catch (e: any) { toast("删除失败: " + (e?.message || String(e)), "error") }
  }

  const renameGroup = async () => {
    if (!renamingGroup || !renamingGroup.name.trim()) return
    try {
      await window.api.tagGroups.rename(renamingGroup.id, renamingGroup.name.trim())
      setRenamingGroup(null)
      await loadGroups()
      toast("已重命名", "success")
    } catch (e: any) { toast("重命名失败: " + (e?.message || String(e)), "error") }
  }

  const exportGroup = async (id: string) => {
    try {
      const data = await window.api.tagGroups.export(id)
      const g = groups.find((x: any) => x.id === id)
      const fileName = (g?.name || "tag_group") + ".json"
      if (window.api.dialog?.save) {
        await window.api.dialog.save(JSON.stringify(data, null, 2), fileName)
        toast("已导出", "success")
      } else {
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
        toast("已复制到剪贴板", "info")
      }
    } catch (e: any) { toast("导出失败: " + (e?.message || String(e)), "error") }
  }

  const importGroup = async () => {
    try {
      if (window.api.dialog?.open) {
        const result = await window.api.dialog.open()
        if (result) {
          const data = JSON.parse(result)
          const name = data.group?.name || "导入的标签组"
          await window.api.tagGroups.import(data, name)
          await loadGroups()
          toast("导入成功", "success")
        }
      } else {
        const text = prompt("请粘贴 JSON 内容:")
        if (text) {
          const data = JSON.parse(text)
          const name = data.group?.name || "导入的标签组"
          await window.api.tagGroups.import(data, name)
          await loadGroups()
          toast("导入成功", "success")
        }
      }
    } catch (e: any) { toast("导入失败: " + (e?.message || String(e)), "error") }
  }

  useEffect(() => {
    const handler = () => { setCtxMenu(null); setFavCtxMenu(null) }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [])

  const handleSaveEdit = async () => {
    if (!editModal || !editZh.trim() || saving) return
    const name = editZh.trim()
    setSaving(true)
    try {
      if (editModal.type === "category") {
        if (editModal.id) await window.api.tags.updateCategory({ id: editModal.id, zh: name })
        else await window.api.tags.createCategory({ zh: name })
      } else if (editModal.type === "subcategory" && editModal.parentId) {
        if (editModal.id) await window.api.tags.updateSubcategory({ id: editModal.id, zh: name })
        else await window.api.tags.createSubcategory({ category_id: editModal.parentId, zh: name })
      }
      await new Promise(r => setTimeout(r, 150))
      await store.loadTags()
      setEditModal(null); setEditZh("")
      toast("\u5df2\u4fdd\u5b58", "success")
    } catch (e: any) { toast("\u64cd\u4f5c\u5931\u8d25: " + (e?.message || String(e)), "error") }
    setSaving(false)
  }

  const confirmDelete = async () => {
    if (!deleteConfirm || deleting) return
    setDeleting(true)
    try {
      if (deleteConfirm.type === "category") await window.api.tags.deleteCategory(deleteConfirm.id)
      else if (deleteConfirm.type === "subcategory") await window.api.tags.deleteSubcategory(deleteConfirm.id)
      await new Promise(r => setTimeout(r, 150))
      await store.loadTags()
      setDeleteConfirm(null)
      toast("\u5df2\u5220\u9664", "success")
    } catch (e: any) { toast("\u5220\u9664\u5931\u8d25: " + (e?.message || String(e)), "error") }
    setDeleting(false)
  }

const handleCtxEdit = () => {
    if (!ctxMenu) return
    if (ctxMenu.type === "category") { setEditModal({ type: "category", id: ctxMenu.id, zh: ctxMenu.name }); setEditZh(ctxMenu.name) }
    else { setEditModal({ type: "subcategory", id: ctxMenu.id, parentId: ctxMenu.parentId, zh: ctxMenu.name }); setEditZh(ctxMenu.name) }
    setCtxMenu(null)
  }

  const handleCtxDelete = () => { if (!ctxMenu) return; setDeleteConfirm({ type: ctxMenu.type, id: ctxMenu.id, name: ctxMenu.name }); setCtxMenu(null) }

  const handleCtxSelectAll = () => {
    if (!ctxMenu || ctxMenu.type !== "category") return
    const cat = categories.find(c => c.id === ctxMenu.id)
    if (!cat) return
    const newSel = new Set(store.selectedSubIds)
    for (const sub of cat.subcategories) newSel.add(sub.id)
    useTagsStore.setState({ selectedSubIds: newSel })
    setCtxMenu(null)
  }

  const handleCtxFavSub = () => { if (!ctxMenu || ctxMenu.type !== "subcategory") return; favStore.toggleSubFav(ctxMenu.id); setCtxMenu(null) }
  const handleClearAll = () => { useTagsStore.setState({ selectedSubIds: new Set() }); toast("已清除全部选中", "info") }

  const toggleCat = (catId: string) => {
    setExpandedCats(prev => { const n = new Set(prev); if (n.has(catId)) n.delete(catId); else n.add(catId); return n })
  }

  const displayCategories = React.useMemo(() => {
    if (!searchQuery.trim()) return categories
    const q = searchQuery.toLowerCase()
    return categories.map(cat => ({
      ...cat,
      subcategories: cat.subcategories.map(sub => ({
        ...sub,
        tags: sub.tags.filter(t => t.en.toLowerCase().includes(q) || t.zh.includes(q)),
      })).filter(sub => sub.tags.length > 0 || sub.zh.includes(q) || cat.zh.includes(q)),
    })).filter(cat => cat.subcategories.length > 0 || cat.zh.includes(q))
  }, [categories, searchQuery])

  

  if (loading) {
    return <div className="flex h-full w-full min-w-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
      <div className="text-sm text-[var(--color-text-secondary)]">加载中...</div>
    </div>
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Tab bar */}
      <div className="ui-toolbar flex">
        <button onClick={() => setActiveTab("tags")}
          className={"ui-nav-tab flex-1 py-2 " + (activeTab === "tags" ? "ui-nav-tab-active" : "")}>
          🏷 标签库
        </button>
        <button onClick={() => setActiveTab("favorites")}
          className={"ui-nav-tab flex-1 py-2 " + (activeTab === "favorites" ? "ui-nav-tab-active" : "")}>
          ⭐ 收藏
        </button>
      </div>

      {activeTab === "tags" ? (
        <>
          <div className="p-2 border-b border-[var(--color-border)] flex gap-1">
            <input value={searchQuery} onChange={e => store.setSearchQuery(e.target.value)}
              placeholder="搜索..."
              className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]" />
            <button onClick={handleClearAll} title="清除全部选中"
              className="ui-subtle-button px-2 py-2 text-xs hover:text-red-400">✕</button>
          </div>

                                        <div className="p-2 border-b border-[var(--color-border)]">
            <button onClick={() => setGroupMenuOpen(!groupMenuOpen)}
              className="ui-subtle-button flex w-full items-center gap-2 px-3 py-2 text-sm font-medium">
              <span className="text-base">{'📁'}</span>
              <span className="truncate">标签组</span>
              <span className="text-xs text-[var(--color-text-secondary)]">{groups.length}</span>
              <span className="ml-auto text-xs transition-transform" style={{ transform: groupMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </button>
            {groupMenuOpen && (
              <div className="ui-popover-surface mt-1">
                <div className="max-h-48 overflow-y-auto">
                  {groups.length === 0 && (
                    <div className="px-3 py-4 text-xs text-[var(--color-text-secondary)] text-center">暂无标签组</div>
                  )}
                  {groups.map((g: any) => (
                    <div key={g.id}
                      className={"flex items-center gap-2 px-3 py-2 text-sm transition-colors " + (g.id === activeGroupId ? "ui-tree-row-active" : "ui-tree-row")}>
                      {g.id === activeGroupId && <span className="text-xs">◉</span>}
                      {renamingGroup?.id === g.id ? (
                        <input value={renamingGroup?.name || ''}
                          onChange={e => setRenamingGroup({ id: g.id, name: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') renameGroup(); if (e.key === 'Escape') setRenamingGroup(null) }}
                          onBlur={renameGroup}
                          autoFocus
                          className="flex-1 px-2 py-1 bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded text-xs text-[var(--color-text-primary)] outline-none" />
                      ) : (
                        <span onClick={() => switchGroup(g.id)} className="flex-1 truncate cursor-pointer">{g.name}</span>
                      )}
                      {g.id === activeGroupId && !renamingGroup && (
                        <div className="flex gap-0.5">
                          <button onClick={(e) => { e.stopPropagation(); setRenamingGroup({ id: g.id, name: g.name }) }}
                            className="px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)] rounded" title="重命名">✏</button>
                          <button onClick={(e) => { e.stopPropagation(); exportGroup(g.id) }}
                            className="px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)] rounded" title="导出">📤</button>
                        </div>
                      )}
                      {g.id !== activeGroupId && !renamingGroup && (
                        <button onClick={(e) => { e.stopPropagation(); deleteGroup(g.id) }}
                          className="px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] hover:text-red-400 rounded" title="删除">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="border-t border-[var(--color-border)] p-2 space-y-1">
                  {showNewGroupInput ? (
                    <div className="flex gap-1">
                      <input value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') createGroup(); if (e.key === 'Escape') { setShowNewGroupInput(false); setNewGroupName("") } }}
                        placeholder="输入组名..."
                        autoFocus
                        className="flex-1 px-3 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded text-xs text-[var(--color-text-primary)] outline-none" />
                      <button onClick={createGroup} className="rounded bg-[var(--color-accent-fill)] px-3 py-1.5 text-xs text-[var(--color-accent-foreground)]">确定</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowNewGroupInput(true)}
                      className="ui-menu-item flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span>➕</span> 新建标签组
                    </button>
                  )}
                  <button onClick={importGroup}
                    className="ui-menu-item flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span>📥</span> 导入标签组
                  </button>
                </div>
              </div>
            )}
          </div>

<div className="flex-1 overflow-y-auto p-2 space-y-1">
            {displayCategories.length === 0 && <div className="text-xs text-[var(--color-text-secondary)] text-center py-4">没有匹配的标签</div>}
            {displayCategories.map(cat => {
              const isExpanded = expandedCats.has(cat.id)
              return (
                <div key={cat.id} className="ui-tree-card">
                  <div onClick={() => toggleCat(cat.id)}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: "category", id: cat.id, name: cat.zh }) }}
                    className="ui-tree-header flex cursor-pointer items-center gap-1 px-3 py-2">
                    <span className="text-xs transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                    <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">{cat.zh}</span>
                    <span className="ui-count-badge">{cat.subcategories.length}</span>
                    <button onClick={(e) => { e.stopPropagation(); setEditModal({ type: "category", id: cat.id, zh: cat.zh }); setEditZh(cat.zh) }}
                      className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)] px-1" title="编辑">✏</button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: "category", id: cat.id, name: cat.zh }) }}
                      className="text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-1" title="删除">✕</button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border)]/50 bg-[var(--color-bg-primary)]/30">
                      {cat.subcategories.map(sub => {
                        const sel = store.selectedSubIds.has(sub.id)
                        const isFav = favStore.isSubFav(sub.id)
                        return (
                          <div key={sub.id}
                            onClick={() => store.toggleSubSelect(sub.id)}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, type: "subcategory", id: sub.id, name: sub.zh, parentId: cat.id }) }}
                    className={"flex cursor-pointer items-center gap-1 pl-5 pr-2 py-1.5 text-xs group " + (sel ? "ui-tree-row-active" : "ui-tree-row")}>
                            <span className="flex-1">{sub.zh}{isFav ? " ⭐" : ""}</span>
                            <span className="text-[9px] opacity-50 w-5 text-right">{sub.tags.length}</span>
                            {sel && <span className="text-[10px]">✓</span>}
                            <button onClick={(e) => { e.stopPropagation(); setEditModal({ type: "subcategory", id: sub.id, parentId: cat.id, zh: sub.zh }); setEditZh(sub.zh) }}
                              className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)] px-0.5" title="编辑">✏</button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: "subcategory", id: sub.id, name: sub.zh }) }}
                              className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-0.5" title="删除">✕</button>
                          </div>
                        )
                      })}
                      <button onClick={() => { setEditModal({ type: "subcategory", parentId: cat.id }); setEditZh("") }}
                        className="w-full text-left pl-5 pr-2 py-1.5 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent)]/5 border-t border-[var(--color-border)]/30">
                        + 添加子类
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="p-2 border-t border-[var(--color-border)]">
            <button onClick={() => { setEditModal({ type: "category" }); setEditZh("") }}
              className="w-full rounded border border-dashed border-[var(--color-accent)]/35 py-1.5 text-xs text-[var(--color-accent-text)] hover:bg-[var(--color-accent)]/10">+ 添加大类</button>
          </div>
        </>
      ) : (
        <FavoritesPanel
            onCtxMenu={(e: any, data: any) => setCtxMenu(data)}
            onFavCtxMenu={(e: any, data: any) => setFavCtxMenu(data)}
          />
      )}

      {/* Sidebar Context Menu */}
      {ctxMenu && (
        <div className="fixed z-50 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded shadow-lg py-1 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button onClick={handleCtxEdit}
            className="w-full text-left px-3 py-2 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 flex items-center gap-2">✏ 编辑</button>
          {ctxMenu.type === "category" && (
            <button onClick={handleCtxSelectAll}
              className="w-full text-left px-3 py-2 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 flex items-center gap-2">☑ 全选子类</button>
          )}
          {ctxMenu.type === "subcategory" && (
            <button onClick={handleCtxFavSub}
              className="w-full text-left px-3 py-2 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 flex items-center gap-2">
              ⭐ {favStore.isSubFav(ctxMenu.id) ? "取消收藏" : "收藏此子类"}
            </button>
          )}
          <div className="border-t border-[var(--color-border)]/50 my-1" />
          <button onClick={handleCtxDelete}
            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-400/10 flex items-center gap-2">✕ 删除</button>
        </div>
      )}

      {/* Favorite Tag Context Menu */}
      {favCtxMenu && (<>
        <div className="fixed inset-0 z-40" onClick={() => setFavCtxMenu(null)} />
        <div className="fixed z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded shadow-2xl py-1.5 min-w-[160px]" style={{ left: favCtxMenu.x, top: favCtxMenu.y }}>
          <button onClick={() => {
            const ps = usePromptsStore.getState()
            const posIds = new Set(ps.positive.map(p => p.tag.id))
            if (posIds.has(favCtxMenu.tag.id)) ps.removePositive(favCtxMenu.tag.id)
            else ps.addPositive(favCtxMenu.tag, favCtxMenu.catZh, favCtxMenu.subZh)
            setFavCtxMenu(null)
          }} className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15">
            ☑ {new Set(usePromptsStore.getState().positive.map(p => p.tag.id)).has(favCtxMenu.tag.id) ? "✓ 取消正面" : "加入正面"}
          </button>
          <button onClick={() => {
            const ps = usePromptsStore.getState()
            const negIds = new Set(ps.negative.map(p => p.tag.id))
            if (negIds.has(favCtxMenu.tag.id)) ps.removeNegative(favCtxMenu.tag.id)
            else ps.addNegative(favCtxMenu.tag, favCtxMenu.catZh, favCtxMenu.subZh)
            setFavCtxMenu(null)
          }} className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15">
            ☒ {favCtxMenu.isNegative ? "✓ 取消负面" : "加入负面"}
          </button>
          <div className="border-t border-[var(--color-border)] my-1" />
          <button onClick={() => { favStore.toggleTagFav(favCtxMenu.tag.id); setFavCtxMenu(null) }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15">★ 取消收藏</button>
        </div>
      </>)}

      {/* Edit Modal */}
      <Modal title={(editModal?.id ? "编辑" : "新增") + (editModal?.type === "category" ? "大类" : "子类")} open={!!editModal} onClose={() => { if (!saving) setEditModal(null) }}>
        <div className="space-y-4 p-4 min-w-[320px]">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">中文名</label>
            <input value={editZh} onChange={e => setEditZh(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !saving) handleSaveEdit() }}
              disabled={saving} autoFocus
              className="w-full mt-1.5 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] disabled:opacity-50" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditModal(null)} disabled={saving} className="flex-1 py-3 text-sm bg-[var(--color-bg-tertiary)] rounded disabled:opacity-50">取消</button>
            <button onClick={handleSaveEdit} disabled={saving || !editZh.trim()} className="flex-1 rounded bg-[var(--color-accent-fill)] py-3 text-sm text-[var(--color-accent-foreground)] disabled:opacity-50">
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal title="确认删除" open={!!deleteConfirm} onClose={() => { if (!deleting) setDeleteConfirm(null) }}>
        <div className="space-y-4 p-4 min-w-[320px]">
          <p className="text-sm text-[var(--color-text-primary)]">确定删除 <span className="font-bold text-red-400">{deleteConfirm?.name}</span>？</p>
          <p className="text-xs text-[var(--color-text-secondary)]">此操作不可撤销{deleteConfirm?.type === "category" ? "，下属所有子类和标签也会被删除" : "，下属所有标签也会被删除"}。</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setDeleteConfirm(null)} disabled={deleting} className="flex-1 py-3 text-sm bg-[var(--color-bg-tertiary)] rounded disabled:opacity-50">取消</button>
            <button onClick={confirmDelete} disabled={deleting} className="flex-1 py-3 text-sm bg-red-500 text-white rounded disabled:opacity-50">
              {deleting ? "删除中..." : "确认删除"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function toast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
