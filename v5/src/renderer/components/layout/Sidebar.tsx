import React, { useEffect, useState } from 'react'
import { useTagsStore } from '../../stores/tags.store'
import { usePromptsStore } from '../../stores/prompts.store'

interface SidebarProps {
  onOpenModal: (modal: 'presets' | 'history' | 'settings' | null) => void
}

type ViewMode = 'categories' | 'favorites' | 'frequent'

const Sidebar: React.FC<SidebarProps> = ({ onOpenModal }) => {
  const {
    categories, selectedCategory, selectedSubcategory,
    setSelectedCategory, setSelectedSubcategory,
    search, refreshFavorites, refreshFrequent,
    favorites, frequent, loadTags
  } = useTagsStore()
  const { addPositive, addNegative, clearPositive, clearNegative } = usePromptsStore()
  const [localSearch, setLocalSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('categories')
  const [showAddCat, setShowAddCat] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newSubName, setNewSubName] = useState('')

  useEffect(() => { refreshFavorites(); refreshFrequent() }, [categories])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearch(e.target.value)
    search(e.target.value)
    if (e.target.value.trim()) setViewMode('categories')
  }

  const handleAddFavTag = (tag: any, isNegative: boolean) => {
    const panelTag = {
      tag: { id: tag.id, subcategory_id: '', en: tag.en, zh: tag.zh || '', sort_order: 0, source: 'builtin', created_at: '' },
      weight: 1.0, category: tag.category || '', subcategory: tag.subcategory || ''
    }
    if (isNegative) addNegative(panelTag); else addPositive(panelTag)
  }

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    try {
      await window.electronAPI.tags.addCategory(newCatName.trim())
      setNewCatName('')
      setShowAddCat(false)
      await loadTags()
    } catch (e: any) { alert('Failed: ' + (e.message || e)) }
  }

  const handleAddSubcategory = async () => {
    if (!newSubName.trim() || !selectedCategory) return
    try {
      await window.electronAPI.tags.addSubcategory(selectedCategory, newSubName.trim())
      setNewSubName('')
      setShowAddSub(false)
      await loadTags()
    } catch (e: any) { alert('Failed: ' + (e.message || e)) }
  }

  const handleDeleteCategory = async (catId: string, catName: string) => {
    if (!confirm('Delete category "' + catName + '"?')) return
    try {
      await window.electronAPI.tags.deleteCategory(catId)
      await loadTags()
    } catch (e: any) { alert('Failed: ' + (e.message || e)) }
  }

  const handleDeleteSubcategory = async (subId: string, subName: string) => {
    if (!confirm('Delete subcategory "' + subName + '"?')) return
    try {
      await window.electronAPI.tags.deleteSubcategory(subId)
      await loadTags()
    } catch (e: any) { alert('Failed: ' + (e.message || e)) }
  }

  return (
    <aside className="flex flex-col w-64 flex-shrink-0 border-r" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h1 className="text-lg font-bold mb-3" style={{ color: 'var(--color-accent)' }}>📖 Grimoire v5</h1>
        <input type="text" value={localSearch} onChange={handleSearch} placeholder="Search tags... (Ctrl+K)"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
      </div>

      {/* Tabs */}
      <div className="flex border-b text-xs" style={{ borderColor: 'var(--color-border)' }}>
        {(['categories','favorites','frequent'] as const).map(mode => (
          <button key={mode} onClick={() => { setViewMode(mode); if (mode==='favorites') refreshFavorites(); if (mode==='frequent') refreshFrequent() }}
            className="flex-1 py-2 text-center transition-all"
            style={{ color: viewMode===mode?'var(--color-accent)':'var(--color-text-muted)', borderBottom: viewMode===mode?'2px solid var(--color-accent)':'2px solid transparent', backgroundColor: viewMode===mode?'var(--color-tag-bg)':'transparent' }}>
            {mode==='categories'?'📂 Cat':mode==='favorites'?'⭐ Fav':'🔥 Hot'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {viewMode === 'categories' && (
          <div className="p-2">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Categories</span>
              <button onClick={() => setShowAddCat(!showAddCat)} className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}>
                {showAddCat ? 'Cancel' : '+ New'}
              </button>
            </div>

            {showAddCat && (
              <div className="flex gap-1 mb-2 px-2">
                <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name..."
                  className="flex-1 px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  onKeyDown={e => e.key==='Enter' && handleAddCategory()} />
                <button onClick={handleAddCategory} className="btn btn-sm btn-primary" style={{ fontSize: '0.65rem' }}>OK</button>
              </div>
            )}

            {categories.map(cat => (
              <div key={cat.id}>
                <div className="flex items-center group">
                  <button
                    onClick={() => setSelectedCategory(cat.id===selectedCategory ? null : cat.id)}
                    className="flex-1 text-left px-3 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{ backgroundColor: selectedCategory===cat.id?'var(--color-tag-bg)':'transparent', color: selectedCategory===cat.id?'var(--color-accent)':'var(--color-text-primary)', border: selectedCategory===cat.id?'1px solid var(--color-tag-border)':'1px solid transparent' }}>
                    {cat.name}
                    <span className="float-right text-xs" style={{ color: 'var(--color-text-muted)' }}>{cat.subcategories?.reduce((s: number, x: any) => s+(x.tags?.length||0), 0) || 0}</span>
                  </button>
                  <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="opacity-0 group-hover:opacity-100 text-xs px-1" style={{ color: 'var(--color-danger)' }} title="Delete">✕</button>
                </div>

                {selectedCategory === cat.id && (
                  <div className="ml-3 mt-1 mb-2">
                    <div className="flex items-center justify-between px-2 py-0.5">
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Subcategories</span>
                      <button onClick={() => setShowAddSub(!showAddSub)} className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}>
                        {showAddSub ? 'Cancel' : '+ Sub'}
                      </button>
                    </div>

                    {showAddSub && (
                      <div className="flex gap-1 mb-1 px-2">
                        <input type="text" value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder="Subcategory name..."
                          className="flex-1 px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                          onKeyDown={e => e.key==='Enter' && handleAddSubcategory()} />
                        <button onClick={handleAddSubcategory} className="btn btn-sm btn-primary" style={{ fontSize: '0.65rem' }}>OK</button>
                      </div>
                    )}

                    {cat.subcategories?.map((sub: any) => (
                      <div key={sub.id} className="flex items-center group">
                        <button
                          onClick={() => setSelectedSubcategory(sub.id===selectedSubcategory ? null : sub.id)}
                          className="flex-1 text-left px-3 py-1.5 rounded-md text-xs transition-all"
                          style={{ backgroundColor: selectedSubcategory===sub.id?'var(--color-tag-bg)':'transparent', color: selectedSubcategory===sub.id?'var(--color-accent)':'var(--color-text-secondary)' }}>
                          {sub.name}
                          <span className="float-right" style={{ color: 'var(--color-text-muted)' }}>{sub.tags?.length||0}</span>
                        </button>
                        <button onClick={() => handleDeleteSubcategory(sub.id, sub.name)} className="opacity-0 group-hover:opacity-100 text-xs px-1" style={{ color: 'var(--color-danger)' }} title="Delete">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {viewMode === 'favorites' && (
          <div className="p-2 space-y-1">
            <p className="text-xs px-2 py-1 mb-1" style={{ color: 'var(--color-text-muted)' }}>⭐ Favorites ({favorites.length})</p>
            {favorites.length===0 ? <p className="text-xs text-center py-4" style={{ color: 'var(--color-text-muted)' }}>Right-click tags to favorite</p> : favorites.map((tag: any) => (
              <div key={tag.id} className="flex items-center gap-1 p-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{tag.zh||tag.en}</div><div className="truncate" style={{ color: 'var(--color-text-muted)' }}>{tag.en}</div>{tag.category && <div className="text-xs mt-0.5" style={{ color: 'var(--color-accent)' }}>{tag.category} › {tag.subcategory}</div>}</div>
                <div className="flex gap-0.5 flex-shrink-0">
                  <button onClick={() => handleAddFavTag(tag,false)} className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-success)', color:'white' }}>+</button>
                  <button onClick={() => handleAddFavTag(tag,true)} className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-danger)', color:'white' }}>-</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'frequent' && (
          <div className="p-2 space-y-1">
            <p className="text-xs px-2 py-1 mb-1" style={{ color: 'var(--color-text-muted)' }}>🔥 Frequent</p>
            {frequent.length===0 ? <p className="text-xs text-center py-4" style={{ color: 'var(--color-text-muted)' }}>Auto-tracked on use</p> : frequent.map((tag: any) => (
              <div key={tag.id} className="flex items-center gap-1 p-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
                <span className="text-xs font-bold px-1" style={{ color: 'var(--color-accent)' }}>{tag.count}x</span>
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{tag.zh||tag.en}</div><div className="truncate" style={{ color: 'var(--color-text-muted)' }}>{tag.en}</div></div>
                <button onClick={() => handleAddFavTag(tag,false)} className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-success)', color:'white' }}>+</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-2 border-t flex gap-1" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => onOpenModal('presets')} className="btn btn-sm flex-1" title="Ctrl+P">💾</button>
        <button onClick={() => onOpenModal('history')} className="btn btn-sm flex-1" title="Ctrl+H">📋</button>
        <button onClick={() => onOpenModal('settings')} className="btn btn-sm flex-1" title="Ctrl+,">⚙️</button>
      </div>
      <div className="p-2 border-t flex gap-1" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={clearPositive} className="btn btn-sm flex-1" style={{ fontSize: '0.7rem' }}>🧹 Pos</button>
        <button onClick={clearNegative} className="btn btn-sm flex-1 btn-danger" style={{ fontSize: '0.7rem' }}>🧹 Neg</button>
      </div>
    </aside>
  )
}

export default Sidebar