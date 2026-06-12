import React, { useMemo, useState } from 'react'
import { useTagsStore } from '../../stores/tags.store'
import { usePromptsStore } from '../../stores/prompts.store'
import { useI18n } from '../../i18n/context'
import type { Tag } from '@shared/types'
import TagCard from '../tags/TagCard'
import TagEditModal from '../tags/TagEditModal'
import ConfirmDialog from '../ui/ConfirmDialog'

const MainContent: React.FC = () => {
  const { t } = useI18n()
  const {
    categories, selectedCategory, selectedSubcategory,
    searchQuery, searchResults,
    editTag, deleteTag, toggleFavorite, loadTags,
  } = useTagsStore()
  const { addPositive, addNegative, positive, removePositive } = usePromptsStore()
  const [editingTag, setEditingTag] = useState<any>(null)
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<any>(null)

  const displayTags = useMemo(() => {
    if (searchQuery.trim())
      return searchResults.flatMap((r: any) =>
        (r.tags || []).map((t: Tag) => ({
          ...t, _cat: r.category || '', _sub: r.subcategory || '',
        }))
      )
    if (!selectedCategory) return []
    const cat = categories.find(c => c.id === selectedCategory)
    if (!cat) return []
    if (selectedSubcategory) {
      const sub = cat.subcategories?.find(s => s.id === selectedSubcategory)
      return (sub?.tags || []).map((t: Tag) => ({
        ...t, _cat: cat.name, _sub: sub?.name || '',
      }))
    }
    return (cat.subcategories || []).flatMap(sub =>
      (sub.tags || []).map((t: Tag) => ({
        ...t, _cat: cat.name, _sub: sub.name,
      }))
    )
  }, [categories, selectedCategory, selectedSubcategory, searchQuery, searchResults])

  const mk = (tag: any) => ({
    tag: {
      id: tag.id, subcategory_id: tag.subcategory_id,
      en: tag.en, zh: tag.zh,
      sort_order: tag.sort_order || 0,
      source: tag.source || 'builtin',
      created_at: tag.created_at || '',
    },
    weight: 1.0,
    category: tag._cat || '',
    subcategory: tag._sub || '',
  })

  // Check if a tag is in positive prompts
  const isTagSelected = (tagId: string) => {
    return positive.some(p => p.tag.id === tagId)
  }

  // Toggle tag in positive prompts
  const handleToggleTag = (tag: any) => {
    if (isTagSelected(tag.id)) {
      removePositive(tag.id)
    } else {
      addPositive(mk(tag))
    }
  }

  // Shift+click = add to negative
  const handleClick = (tag: any, e: React.MouseEvent) => {
    if (e.shiftKey) {
      addNegative(mk(tag))
    } else {
      handleToggleTag(tag)
    }
  }

  const handleSelectAll = () => {
    displayTags.forEach(t => {
      if (!isTagSelected(t.id)) addPositive(mk(t))
    })
  }

  const handleClearPage = () => {
    const ids = new Set(displayTags.map(t => t.id))
    const s = usePromptsStore.getState()
    s.positive.filter(p => ids.has(p.tag.id)).forEach(p => s.removePositive(p.tag.id))
  }

  const handleEditSave = async (d: { tagId: string; en: string; zh: string }) => {
    await editTag(d); await loadTags()
  }

  const handleDeleteTag = async (id: string) => {
    await deleteTag(id); await loadTags(); setConfirmDeleteTag(null)
  }

  const cc = categories.find(c => c.id === selectedCategory)
  const cs = cc?.subcategories?.find(s => s.id === selectedSubcategory)

  const selectedCount = displayTags.filter(t => isTagSelected(t.id)).length

  return (
    <div className="main-content">
      {/* Header */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <h2 style={{
          fontSize: 'var(--font-size-panel)', fontWeight: 600,
          color: 'var(--color-text-primary)', margin: '0 0 2px 0',
        }}>
          {searchQuery.trim()
            ? t('main.search') + ': "' + searchQuery + '"'
            : cs
              ? cc?.name + ' › ' + cs.name
              : cc
                ? cc.name
                : t('main.selectCat')}
          {!searchQuery.trim() && displayTags.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-text-dim)' }}>
              ({displayTags.length})
            </span>
          )}
          {selectedCount > 0 && (
            <span style={{
              marginLeft: 8, fontSize: 10,
              color: 'var(--color-accent)', fontWeight: 600,
            }}>
              已选 {selectedCount}
            </span>
          )}
        </h2>
        <div style={{ fontSize: 10, color: 'var(--color-text-dim)', lineHeight: 1.6 }}>
          {t('main.clickHint')}
        </div>
        {displayTags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button onClick={handleSelectAll}
              title={t('main.selectAll') + ' (' + displayTags.length + ')'}
              className="ps-btn ps-btn--xs">
              {t('main.selectAll')} ({displayTags.length})
            </button>
            <button onClick={handleClearPage}
              title={t('main.clearPage')}
              className="ps-btn ps-btn--xs ps-btn--danger">
              {t('main.clearPage')}
            </button>
          </div>
        )}
      </div>

      {/* Tag Grid */}
      <div className="tag-grid">
        {displayTags.length === 0 ? (
          <div className="flex-center" style={{
            gridColumn: '1/-1', height: '100%', minHeight: 200,
            flexDirection: 'column', gap: 8,
          }}>
            <span style={{ fontSize: 32 }}>📖</span>
            <span style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)' }}>
              {t('main.noTags')}
            </span>
          </div>
        ) : (
          displayTags.map((tag: any) => (
            <TagCard
              key={tag.id}
              tag={tag}
              selected={isTagSelected(tag.id)}
              onClick={(e: React.MouseEvent) => handleClick(tag, e)}
              onEdit={setEditingTag}
              onDelete={(t: any) => setConfirmDeleteTag(t)}
              onToggleFavorite={async (t: any) => {
                await toggleFavorite(t.id, t.is_favorite || false); await loadTags()
              }}
            />
          ))
        )}
      </div>

      {/* Edit Modal */}
      <TagEditModal
        tag={editingTag}
        onClose={() => setEditingTag(null)}
        onSave={handleEditSave}
        onDelete={(id: string) => setConfirmDeleteTag({ id, en: editingTag?.en || '', zh: editingTag?.zh || '' })}
      />

      {/* Delete Tag Confirm */}
      <ConfirmDialog
        open={confirmDeleteTag !== null}
        title="删除标签"
        message={
          confirmDeleteTag
            ? `确定删除标签 "${confirmDeleteTag.zh || confirmDeleteTag.en}" (${confirmDeleteTag.en}) 吗？\n\n此操作不可撤销！`
            : ''
        }
        variant="danger"
        confirmLabel="删除"
        onConfirm={() => confirmDeleteTag && handleDeleteTag(confirmDeleteTag.id)}
        onCancel={() => setConfirmDeleteTag(null)}
      />
    </div>
  )
}

export default MainContent
