import React, { useMemo, useState } from 'react'
import { useTagsStore } from '../../stores/tags.store'
import { usePromptsStore } from '../../stores/prompts.store'
import type { Tag } from '@shared/types'
import TagCard from '../tags/TagCard'
import TagEditModal from '../tags/TagEditModal'

const MainContent: React.FC = () => {
  const { categories, selectedCategory, selectedSubcategory, searchQuery, searchResults, editTag, deleteTag, toggleFavorite, loadTags } = useTagsStore()
  const { addPositive, addNegative } = usePromptsStore()
  const [editingTag, setEditingTag] = useState<any>(null)

  const displayTags = useMemo(() => {
    if (searchQuery.trim()) return searchResults.flatMap((r: any) => (r.tags||[]).map((t: Tag) => ({...t, _cat: r.category||'', _sub: r.subcategory||''})))
    if (!selectedCategory) return []
    const cat = categories.find(c => c.id===selectedCategory)
    if (!cat) return []
    if (selectedSubcategory) { const sub = cat.subcategories?.find(s=>s.id===selectedSubcategory); return (sub?.tags||[]).map((t:Tag)=>({...t, _cat: cat.name, _sub: sub?.name||''})) }
    return (cat.subcategories||[]).flatMap(sub => (sub.tags||[]).map((t:Tag)=>({...t, _cat: cat.name, _sub: sub.name})))
  }, [categories, selectedCategory, selectedSubcategory, searchQuery, searchResults])

  const makePanelTag = (tag: any) => ({ tag: { id: tag.id, subcategory_id: tag.subcategory_id, en: tag.en, zh: tag.zh, sort_order: tag.sort_order||0, source: tag.source||'builtin', created_at: tag.created_at||'' }, weight: 1.0, category: tag._cat||'', subcategory: tag._sub||'' })

  const handleClick = (tag: any, e: React.MouseEvent) => { if (e.shiftKey) addNegative(makePanelTag(tag)); else addPositive(makePanelTag(tag)) }

  const handleSelectAll = () => { const ptags = displayTags.map(t => makePanelTag(t)); ptags.forEach(p => addPositive(p)) }

  const handleClearPage = () => {
    const ids = new Set(displayTags.map(t=>t.id))
    const store = usePromptsStore.getState()
    store.positive.filter(p=>ids.has(p.tag.id)).forEach(p=>store.removePositive(p.tag.id))
  }

  const handleEdit = (tag: any) => setEditingTag(tag)
  const handleSaveEdit = async (data: { tagId: string; en: string; zh: string }) => { await editTag(data); await loadTags() }
  const handleDeleteTag = async (tagId: string) => { await deleteTag(tagId); await loadTags() }
  const handleToggleFavorite = async (tag: any) => { await toggleFavorite(tag.id, tag.is_favorite||false); await loadTags() }

  const currentCat = categories.find(c=>c.id===selectedCategory)
  const currentSub = currentCat?.subcategories?.find(s=>s.id===selectedSubcategory)

  return (
    <main className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{searchQuery.trim() ? 'Search: "'+searchQuery+'"' : currentSub ? currentCat?.name+' > '+currentSub.name : currentCat ? currentCat.name : 'Select a category'}{!searchQuery.trim()&&displayTags.length>0&&<span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>({displayTags.length})</span>}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Click=add pos | Shift+Click=add neg | Right-click=edit/fav</p>
        {displayTags.length > 0 && (
          <div className="flex gap-1 mt-2">
            <button onClick={handleSelectAll} className="btn btn-sm" style={{ fontSize: '0.7rem' }}>Select All ({displayTags.length})</button>
            <button onClick={handleClearPage} className="btn btn-sm btn-danger" style={{ fontSize: '0.7rem' }}>Clear Page</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {displayTags.length===0 ? (
          <div className="flex items-center justify-center h-full"><div className="text-center"><p className="text-3xl mb-3">Tags</p><p style={{ color: 'var(--color-text-muted)' }}>Select a category from the left</p><p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>or Ctrl+K to search</p></div></div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {displayTags.map((tag: any) => <TagCard key={tag.id} tag={tag} onClick={(e: React.MouseEvent) => handleClick(tag, e)} onEdit={handleEdit} onDelete={handleDeleteTag} onToggleFavorite={handleToggleFavorite} />)}
          </div>
        )}
      </div>

      <TagEditModal tag={editingTag} onClose={()=>setEditingTag(null)} onSave={handleSaveEdit} onDelete={handleDeleteTag} />
    </main>
  )
}

export default MainContent