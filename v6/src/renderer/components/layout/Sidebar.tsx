import React, { useEffect, useState } from 'react'
import { useTagsStore } from '../../stores/tags.store'
import { usePromptsStore } from '../../stores/prompts.store'
import { useI18n } from '../../i18n/context'
import ConfirmDialog from '../ui/ConfirmDialog'

type ViewMode = 'categories' | 'favorites' | 'frequent'

const Sidebar: React.FC = () => {
  const { t } = useI18n()
  const {
    categories, selectedCategory, selectedSubcategory,
    setSelectedCategory, setSelectedSubcategory,
    search, refreshFavorites, refreshFrequent,
    favorites, frequent, loadTags,
  } = useTagsStore()
  const { addPositive, addNegative, clearPositive, clearNegative } = usePromptsStore()
  const [localSearch, setLocalSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('categories')
  const [showAddCat, setShowAddCat] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newSubName, setNewSubName] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'category' | 'subcategory' | 'tag'
    id: string
    name: string
  } | null>(null)

  useEffect(() => { refreshFavorites(); refreshFrequent() }, [categories])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearch(e.target.value); search(e.target.value)
    if (e.target.value.trim()) setViewMode('categories')
  }

  const handleAddTag = (tag: any, isNeg: boolean) => {
    const pt = {
      tag: { id: tag.id, subcategory_id: '', en: tag.en, zh: tag.zh||'', sort_order: 0, source: 'builtin', created_at: '' },
      weight: 1.0,
      category: tag.category||'',
      subcategory: tag.subcategory||'',
    }
    if (isNeg) addNegative(pt); else addPositive(pt)
  }

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    try { await window.electronAPI.tags.addCategory(newCatName.trim()); setNewCatName(''); setShowAddCat(false); await loadTags() } catch {}
  }

  const handleAddSubcategory = async () => {
    if (!newSubName.trim()||!selectedCategory) return
    try { await window.electronAPI.tags.addSubcategory(selectedCategory, newSubName.trim()); setNewSubName(''); setShowAddSub(false); await loadTags() } catch {}
  }

  const handleDeleteCategory = async () => {
    if (!confirmDelete || confirmDelete.type !== 'category') return
    try { await window.electronAPI.tags.deleteCategory(confirmDelete.id); await loadTags() } catch {}
    setConfirmDelete(null)
  }

  const handleDeleteSubcategory = async () => {
    if (!confirmDelete || confirmDelete.type !== 'subcategory') return
    try { await window.electronAPI.tags.deleteSubcategory(confirmDelete.id); await loadTags() } catch {}
    setConfirmDelete(null)
  }

  // Export tag library
  const handleExport = async () => {
    try {
      const data = JSON.stringify({ categories, version: '5.3.2', exportedAt: new Date().toISOString() }, null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grimoire-tags-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert('导出失败: ' + e.message)
    }
  }

  // Import tag library
  const handleImport = async () => {
    if (!importText.trim()) { setShowImport(false); return }
    try {
      const data = JSON.parse(importText)
      if (!data.categories || !Array.isArray(data.categories)) {
        alert('无效的标签库格式')
        return
      }
      // Simple merge: add all tags
      let added = 0
      for (const cat of data.categories) {
        for (const sub of (cat.subcategories || [])) {
          for (const tag of (sub.tags || [])) {
            try {
              await window.electronAPI.tags.add({
                category: cat.name,
                subcategory: sub.name,
                en: tag.en,
                zh: tag.zh || '',
              })
              added++
            } catch {}
          }
        }
      }
      await loadTags()
      alert(`导入完成: 已添加 ${added} 个标签`)
    } catch (e: any) {
      alert('导入失败: ' + e.message)
    }
    setShowImport(false)
    setImportText('')
  }

  // Handle file import
  const handleFileImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      setImportText(text)
      setShowImport(true)
    }
    input.click()
  }

  return (
    <div className="sidebar ps-panel">
      {/* Search */}
      <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)' }}>
        <input type="text" value={localSearch} onChange={handleSearch}
          placeholder={t('sidebar.search')}
          className="ps-input w-full" title={t('sidebar.search')} />
      </div>

      {/* View mode tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
        {(['categories','favorites','frequent'] as const).map(m => (
          <button key={m} onClick={() => {
            setViewMode(m);
            if(m==='favorites')refreshFavorites();
            if(m==='frequent')refreshFrequent()
          }}
            title={t('sidebar.'+m)}
            className={'ps-tab' + (viewMode===m?' ps-tab--active':'')}
            style={{ flex: 1, justifyContent: 'center' }}>
            <span className="ps-tab__label">
              {m==='categories'?'📂':m==='favorites'?'⭐':'🔥'} {t('sidebar.'+m)}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="cat-tree">
        {viewMode === 'categories' && (
          <div>
            {/* Add Category + Import/Export */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-dim)', fontWeight: 600 }}>
                {t('sidebar.categories')}
              </span>
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={() => setShowAddCat(!showAddCat)}
                  title={t('common.new')}
                  className="ps-btn ps-btn--xs">{showAddCat?'✕':'+ '+t('common.new')}</button>
                <button onClick={handleExport} title="导出标签库"
                  className="ps-btn ps-btn--xs">📤</button>
                <button onClick={handleFileImport} title="导入标签库"
                  className="ps-btn ps-btn--xs">📥</button>
              </div>
            </div>

            {showAddCat && (
              <div style={{ display: 'flex', gap: 4, padding: '0 8px 4px' }}>
                <input type="text" value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder={t('sidebar.categories')}
                  className="ps-input flex-1"
                  style={{ height: 22, fontSize: 10 }}
                  onKeyDown={e => e.key==='Enter'&&handleAddCategory()} />
                <button onClick={handleAddCategory}
                  className="ps-btn ps-btn--xs ps-btn--primary">{t('common.save')}</button>
              </div>
            )}

            {/* Import text dialog */}
            {showImport && (
              <div style={{ padding: '0 8px 4px', background: 'var(--color-bg-secondary)' }}>
                <div style={{ fontSize: 10, marginBottom: 4, color: 'var(--color-text-secondary)' }}>
                  导入标签库 (JSON)
                </div>
                <textarea value={importText}
                  onChange={e => setImportText(e.target.value)}
                  className="ps-input w-full"
                  style={{ height: 80, fontSize: 10, resize: 'vertical' }}
                  placeholder='粘贴 JSON 数据...' />
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button onClick={handleImport}
                    className="ps-btn ps-btn--xs ps-btn--primary">导入</button>
                  <button onClick={() => { setShowImport(false); setImportText('') }}
                    className="ps-btn ps-btn--xs">取消</button>
                </div>
              </div>
            )}

            {/* Category list */}
            {categories.map(cat => (
              <div key={cat.id}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div
                    onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                    title={cat.name}
                    className={'cat-item' + (selectedCategory === cat.id ? ' cat-item--active' : '')}
                    style={{ flex: 1 }}>
                    <span className="truncate">{cat.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-dim)', flexShrink: 0 }}>
                      {cat.subcategories?.length || 0}
                    </span>
                  </div>
                  <button
                    onClick={() => setConfirmDelete({ type: 'category', id: cat.id, name: cat.name })}
                    title={t('common.del')}
                    className="ps-icon-btn"
                    style={{
                      width: 18, height: 18, fontSize: 10, opacity: 0, marginRight: 4,
                      color: 'var(--color-danger)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>×</button>
                </div>

                {selectedCategory === cat.id && (
                  <div>
                    {/* Add Subcategory */}
                    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 20, paddingRight: 4 }}>
                      <div style={{ flex: 1, fontSize: 10, color: 'var(--color-text-dim)' }}>
                        {t('common.sub')}
                      </div>
                      <button onClick={() => setShowAddSub(!showAddSub)}
                        className="ps-btn ps-btn--xs">+ {t('common.new')}</button>
                    </div>
                    {showAddSub && (
                      <div style={{ display: 'flex', gap: 4, padding: '0 8px 4px', marginLeft: 12 }}>
                        <input type="text" value={newSubName}
                          onChange={e => setNewSubName(e.target.value)}
                          placeholder={t('common.sub')}
                          className="ps-input flex-1"
                          style={{ height: 22, fontSize: 10 }}
                          onKeyDown={e => e.key==='Enter'&&handleAddSubcategory()} />
                        <button onClick={handleAddSubcategory}
                          className="ps-btn ps-btn--xs ps-btn--primary">{t('common.save')}</button>
                      </div>
                    )}

                    {/* Subcategories */}
                    {cat.subcategories?.map((sub: any) => (
                      <div key={sub.id} style={{ display: 'flex', alignItems: 'center' }}>
                        <div
                          onClick={() => setSelectedSubcategory(sub.id === selectedSubcategory ? '' : sub.id)}
                          title={sub.name}
                          className={'cat-item cat-item--sub' + (selectedSubcategory === sub.id ? ' cat-item--active' : '')}
                          style={{ flex: 1 }}>
                          <span className="truncate">{sub.name}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-dim)', flexShrink: 0 }}>
                            {sub.tags?.length || 0}
                          </span>
                        </div>
                        <button
                          onClick={() => setConfirmDelete({ type: 'subcategory', id: sub.id, name: sub.name })}
                          title={t('common.del')}
                          className="ps-icon-btn"
                          style={{
                            width: 18, height: 18, fontSize: 10, opacity: 0, marginRight: 4,
                            color: 'var(--color-danger)',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {viewMode === 'favorites' && (
          <div style={{ padding: 4 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-dim)', padding: '4px 8px', fontWeight: 600 }}>
              ⭐ {t('sidebar.favorites')} ({favorites.length})
            </div>
            {favorites.length === 0 ? (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 10, padding: 16, textAlign: 'center' }}>
                {t('sidebar.noFavs')}
              </div>
            ) : (
              favorites.map((tag: any) => (
                <div key={tag.id} style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', gap: 4 }}>
                  <div className="truncate flex-1 min-w-0" style={{ fontSize: 11 }} title={tag.en}>
                    <div style={{ color: 'var(--color-text-primary)' }}>{tag.zh || tag.en}</div>
                    <div style={{ color: 'var(--color-text-dim)', fontSize: 10 }}>{tag.en}</div>
                  </div>
                  <button onClick={() => handleAddTag(tag, false)} title={t('right.pos')}
                    className="ps-btn ps-btn--xs"
                    style={{ background: 'var(--color-success)', color: 'white', border: 'none', width: 20 }}>+</button>
                  <button onClick={() => handleAddTag(tag, true)} title={t('right.neg')}
                    className="ps-btn ps-btn--xs"
                    style={{ background: 'var(--color-danger)', color: 'white', border: 'none', width: 20 }}>-</button>
                </div>
              ))
            )}
          </div>
        )}

        {viewMode === 'frequent' && (
          <div style={{ padding: 4 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-dim)', padding: '4px 8px', fontWeight: 600 }}>
              🔥 {t('sidebar.frequent')}
            </div>
            {frequent.length === 0 ? (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 10, padding: 16, textAlign: 'center' }}>
                {t('sidebar.noFreq')}
              </div>
            ) : (
              frequent.map((tag: any) => (
                <div key={tag.id} style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', gap: 4 }}>
                  <span style={{
                    fontSize: 10, color: 'var(--color-accent)', fontWeight: 700,
                    width: 24, textAlign: 'center', flexShrink: 0,
                  }}>{tag.count}x</span>
                  <div className="truncate flex-1 min-w-0" style={{ fontSize: 11 }} title={tag.en}>
                    <div style={{ color: 'var(--color-text-primary)' }}>{tag.zh || tag.en}</div>
                    <div style={{ color: 'var(--color-text-dim)', fontSize: 10 }}>{tag.en}</div>
                  </div>
                  <button onClick={() => handleAddTag(tag, false)} title={t('right.pos')}
                    className="ps-btn ps-btn--xs"
                    style={{ background: 'var(--color-success)', color: 'white', border: 'none', width: 20 }}>+</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Clear buttons */}
      <div style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid var(--color-border)' }}>
        <button onClick={clearPositive} title={t('sidebar.clearPos')}
          className="ps-btn ps-btn--sm flex-1">{t('sidebar.clearPos')}</button>
        <button onClick={clearNegative} title={t('sidebar.clearNeg')}
          className="ps-btn ps-btn--sm ps-btn--danger flex-1">{t('sidebar.clearNeg')}</button>
      </div>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('common.deleteConfirm')}
        message={
          confirmDelete
            ? `确定删除${confirmDelete.type === 'category' ? '分类' : '子类'} "${confirmDelete.name}" 吗？\n\n此操作将同时删除所有关联的标签，不可撤销！`
            : ''
        }
        variant="danger"
        confirmLabel="删除"
        onConfirm={() => {
          if (confirmDelete?.type === 'category') handleDeleteCategory()
          else if (confirmDelete?.type === 'subcategory') handleDeleteSubcategory()
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

export default Sidebar
