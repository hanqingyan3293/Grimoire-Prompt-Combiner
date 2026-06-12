import React from 'react'
import { useTagsStore } from '../../stores/tags.store'
import { usePromptsStore } from '../../stores/prompts.store'
import { useI18n } from '../../i18n/context'

const StatusBar: React.FC = () => {
  const { t } = useI18n()
  const { categories, selectedCategory, selectedSubcategory } = useTagsStore()
  const { positive, negative } = usePromptsStore()

  // Build breadcrumb
  let breadcrumb = ''
  if (selectedCategory) {
    const cat = categories.find(c => c.id === selectedCategory)
    breadcrumb = cat?.name || ''
    if (selectedSubcategory) {
      const sub = cat?.subcategories?.find(s => s.id === selectedSubcategory)
      breadcrumb += ' › ' + (sub?.name || '')
    }
  }

  // Total tag count
  let totalTags = 0
  for (const c of categories) {
    for (const s of c.subcategories || []) {
      totalTags += (s.tags || []).length
    }
  }

  return (
    <div className="ps-statusbar">
      <div className="ps-statusbar__item">
        <span style={{ color: 'var(--color-accent)' }}>📂</span>
        <span>{breadcrumb || t('main.selectCat')}</span>
      </div>
      <div className="ps-statusbar__sep" />
      <div className="ps-statusbar__item">
        <span>{t('statusBar.tagsCount')}: {totalTags}</span>
      </div>
      <div className="ps-statusbar__sep" />
      <div className="ps-statusbar__item" style={{ color: 'var(--color-success)' }}>
        <span>{t('statusBar.positiveCount')}: {positive.length}</span>
      </div>
      <div className="ps-statusbar__item" style={{ color: 'var(--color-danger)' }}>
        <span>{t('statusBar.negativeCount')}: {negative.length}</span>
      </div>
      <div style={{ flex: 1 }} />
      <div className="ps-statusbar__item">
        <span style={{ color: 'var(--color-text-dim)' }}>Grimoire v5.3.2</span>
      </div>
    </div>
  )
}

export default StatusBar
