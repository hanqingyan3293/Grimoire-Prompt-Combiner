// 魔导书 Grimoire v7 — 左侧栏
import React, { useState } from "react"
import { useTagsStore } from "../../stores/tags.store"
import { Modal } from "../ui/Modal"

export function Sidebar() {
  const store = useTagsStore()
  const categories = store.categories
  const loading = store.loading
  const searchQuery = store.searchQuery

  const [editModal, setEditModal] = useState<{
    type: "category" | "subcategory"
    id?: string; parentId?: string; zh?: string
  } | null>(null)
  const [editZh, setEditZh] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: string; id: string; name: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  // Sync expandedCats when categories load
  React.useEffect(() => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      categories.forEach(c => next.add(c.id))
      return next
    })
  }, [categories])

  const toggleCat = (catId: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  const displayCategories = React.useMemo(() => {
    if (!searchQuery.trim()) return categories
    const q = searchQuery.toLowerCase()
    return categories
      .map(cat => ({
        ...cat,
        subcategories: cat.subcategories
          .map(sub => ({
            ...sub,
            tags: sub.tags.filter(t => t.en.toLowerCase().includes(q) || t.zh.includes(q)),
          }))
          .filter(sub => sub.tags.length > 0 || sub.zh.includes(q) || cat.zh.includes(q)),
      }))
      .filter(cat => cat.subcategories.length > 0 || cat.zh.includes(q))
  }, [categories, searchQuery])

  const handleSaveEdit = async () => {
    if (!editModal || !editZh.trim() || saving) return
    const name = editZh.trim()
    setSaving(true)
    try {
      if (editModal.type === "category") {
        if (editModal.id) {
          await window.api.tags.updateCategory({ id: editModal.id, zh: name })
        } else {
          await window.api.tags.createCategory({ zh: name })
        }
      } else if (editModal.type === "subcategory" && editModal.parentId) {
        if (editModal.id) {
          await window.api.tags.updateSubcategory({ id: editModal.id, zh: name })
        } else {
          await window.api.tags.createSubcategory({ category_id: editModal.parentId, zh: name })
        }
      }
      await new Promise(r => setTimeout(r, 150))
      await store.loadTags()
      setEditModal(null)
      setEditZh("")
      toast("已保存", "success")
    } catch (e: any) {
      toast("操作失败: " + (e?.message || String(e)), "error")
    }
    setSaving(false)
  }

  const confirmDelete = async () => {
    if (!deleteConfirm || deleting) return
    setDeleting(true)
    try {
      if (deleteConfirm.type === "category") {
        await window.api.tags.deleteCategory(deleteConfirm.id)
      } else if (deleteConfirm.type === "subcategory") {
        await window.api.tags.deleteSubcategory(deleteConfirm.id)
      } else if (deleteConfirm.type === "tag") {
        await window.api.tags.delete(deleteConfirm.id)
      }
      await new Promise(r => setTimeout(r, 150))
      await store.loadTags()
      setDeleteConfirm(null)
      toast("已删除", "success")
    } catch (e: any) {
      toast("删除失败: " + (e?.message || String(e)), "error")
    }
    setDeleting(false)
  }

  const handleResetTags = async () => {
    if (!confirm("确定重新导入标签库？当前所有标签将被替换为默认标签。")) return
    setGroupMenuOpen(false)
    try {
      await window.api.tags.reset()
      await store.loadTags()
      toast("标签库已重置为默认", "success")
    } catch (e: any) {
      toast("重置失败: " + (e?.message || String(e)), "error")
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col w-[260px] min-w-[260px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="text-sm text-[var(--color-text-secondary)]">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-[260px] min-w-[260px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Search */}
      <div className="p-2 border-b border-[var(--color-border)]">
        <input value={searchQuery} onChange={e => store.setSearchQuery(e.target.value)}
          placeholder="搜索标签/大类/子类..."
          className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]" />
      </div>

      {/* Group menu */}
      <div className="p-2 border-b border-[var(--color-border)]">
        <button onClick={() => setGroupMenuOpen(!groupMenuOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)]">
          📁 <span className="truncate">标签库管理</span> <span className="ml-auto text-xs">▼</span>
        </button>
        {groupMenuOpen && (
          <div className="mt-1 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded p-2 space-y-1">
            <button onClick={handleResetTags}
              className="w-full text-left px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)] rounded">
              🔄 重置为默认标签库
            </button>
            <button onClick={async () => {
              if (window.api.db) {
                try {
                  const r = await window.api.db.export()
                  if (r) toast("数据库已导出", "success")
                } catch (e: any) { toast("导出失败: " + (e?.message || String(e)), "error") }
              }
              setGroupMenuOpen(false)
            }} className="w-full text-left px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)] rounded">
              💾 导出数据库
            </button>
            <button onClick={async () => {
              if (window.api.db) {
                try {
                  const r = await window.api.db.import()
                  if (r) { await store.loadTags(); toast("数据库已导入", "success") }
                } catch (e: any) { toast("导入失败: " + (e?.message || String(e)), "error") }
              }
              setGroupMenuOpen(false)
            }} className="w-full text-left px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)] rounded">
              📥 导入数据库
            </button>
          </div>
        )}
      </div>

      {/* Category tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {displayCategories.length === 0 && (
          <div className="text-xs text-[var(--color-text-secondary)] text-center py-4">没有匹配的标签</div>
        )}
        {displayCategories.map(cat => {
          const isExpanded = expandedCats.has(cat.id)
          return (
            <div key={cat.id} className="border border-[var(--color-border)] rounded overflow-hidden">
              {/* Category header */}
              <div onClick={() => toggleCat(cat.id)}
                className="flex items-center gap-1 px-3 py-2 cursor-pointer bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)]/10 transition-all">
                <span className="text-xs transition-transform"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">{cat.zh}</span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">{cat.subcategories.length}</span>
                <button onClick={(e) => { e.stopPropagation(); setEditModal({ type: "category", id: cat.id, zh: cat.zh }); setEditZh(cat.zh) }}
                  className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] px-1">✏</button>
                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: "category", id: cat.id, name: cat.zh }) }}
                  className="text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-1">✕</button>
              </div>
              {/* Subcategories */}
              {isExpanded && (
                <div className="border-t border-[var(--color-border)]/50 bg-[var(--color-bg-primary)]/30">
                  {cat.subcategories.map(sub => {
                    const sel = store.selectedSubIds.has(sub.id)
                    return (
                      <div key={sub.id}
                        onClick={() => store.toggleSubSelect(sub.id)}
                        className={`flex items-center gap-1 pl-5 pr-2 py-1.5 cursor-pointer group transition-all text-xs ${
                          sel ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium" : "hover:bg-[var(--color-accent)]/5 text-[var(--color-text-secondary)]"
                        }`}>
                        <span className="flex-1">{sub.zh}</span>
                        <span className="text-[9px] opacity-50 w-5 text-right">{sub.tags.length}</span>
                        {sel && <span className="text-[10px]">✓</span>}
                        <button onClick={(e) => { e.stopPropagation(); setEditModal({ type: "subcategory", id: sub.id, parentId: cat.id, zh: sub.zh }); setEditZh(sub.zh) }}
                          className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] px-0.5">✏</button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: "subcategory", id: sub.id, name: sub.zh }) }}
                          className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-0.5">✕</button>
                      </div>
                    )
                  })}
                  <button onClick={() => { setEditModal({ type: "subcategory", parentId: cat.id }); setEditZh("") }}
                    className="w-full text-left pl-5 pr-2 py-1.5 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 border-t border-[var(--color-border)]/30">
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
          className="w-full py-1.5 text-xs text-[var(--color-accent)] border border-dashed border-[var(--color-accent)]/30 rounded hover:bg-[var(--color-accent)]/10">
          + 添加大类
        </button>
      </div>

      {/* Edit Modal */}
      <Modal title={(editModal?.id ? "编辑" : "新增") + (editModal?.type === "category" ? "大类" : "子类")} open={!!editModal} onClose={() => { if (!saving) setEditModal(null) }}>
        <div className="space-y-4 p-4 min-w-[320px]">
          <div>
            <label className="text-xs text-[var(--color-text-secondary)]">中文名</label>
            <input value={editZh} onChange={e => setEditZh(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !saving) handleSaveEdit() }}
              disabled={saving}
              className="w-full mt-1.5 px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] disabled:opacity-50" autoFocus />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditModal(null)} disabled={saving} className="flex-1 py-3 text-sm bg-[var(--color-bg-tertiary)] rounded disabled:opacity-50">取消</button>
            <button onClick={handleSaveEdit} disabled={saving || !editZh.trim()} className="flex-1 py-3 text-sm bg-[var(--color-accent)] text-white rounded disabled:opacity-50">
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal title="确认删除" open={!!deleteConfirm} onClose={() => { if (!deleting) setDeleteConfirm(null) }}>
        <div className="space-y-4 p-4 min-w-[320px]">
          <p className="text-sm text-[var(--color-text-primary)]">确定删除 <span className="font-bold text-red-400">{deleteConfirm?.name}</span>？</p>
          <p className="text-xs text-[var(--color-text-secondary)]">此操作不可撤销{deleteConfirm?.type === "category" ? "，下属所有子类和标签也会被删除" : deleteConfirm?.type === "subcategory" ? "，下属所有标签也会被删除" : ""}。</p>
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
