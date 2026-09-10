import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Clock3, Copy, Database, FolderOpen, Heart, Layers3, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PromptAssetItem, PromptAssetPage, PromptAssetSourceFilter } from '../../../shared/prompt-asset-types'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import { ResourceCard, ResourceGroup } from '../ui/ResourceCards'
import { FloatingPreview } from '../ui/FloatingPreview'

const PAGE_SIZE = 40

const SOURCES: Array<{ value: PromptAssetSourceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'asset', label: '资产' },
  { value: 'history', label: '历史' },
  { value: 'preset', label: '预设' },
  { value: 'favorite', label: '收藏' },
]

const SOURCE_META: Record<PromptAssetItem['source'], { label: string; icon: LucideIcon; tone: 'neutral' | 'accent' | 'success' | 'warning' }> = {
  asset: { label: '资产', icon: Database, tone: 'accent' },
  history: { label: '历史', icon: Clock3, tone: 'neutral' },
  preset: { label: '预设', icon: Layers3, tone: 'warning' },
  favorite: { label: '收藏', icon: Heart, tone: 'success' },
}

type AssetCategory = { id: string; parentId: string | null; name: string; sourceScope: string; sortOrder: number; isBuiltin: boolean }

function toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}

export function PromptAssetsPanel() {
  const [page, setPage] = useState<PromptAssetPage>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 })
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<PromptAssetSourceFilter>('all')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PromptAssetItem | null>(null)
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const requestId = useRef(0)
  const tags = useTagsStore(state => state.tags)
  const replaceFromPromptText = usePromptsStore(state => state.replaceFromPromptText)
  const loadPresetData = usePromptsStore(state => state.loadPresetData)
  const addPositive = usePromptsStore(state => state.addPositive)

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(queryDraft.trim()); setOffset(0) }, 220)
    return () => window.clearTimeout(timer)
  }, [queryDraft])

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    try {
      const result = await window.api.promptAssets.list({ query, source, limit: PAGE_SIZE, offset })
      if (currentRequest !== requestId.current) return
      if (result.total > 0 && offset >= result.total) {
        setOffset(Math.max(0, Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE))
        return
      }
      setPage(result)
      setError(null)
    } catch (cause) {
      if (currentRequest !== requestId.current) return
      console.error('Failed to load prompt assets:', cause)
      setError(cause instanceof Error ? cause.message : '提示词资产加载失败')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [query, source, offset])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void window.api.promptAssets.categories.list().then(setCategories).catch(() => {}) }, [])
  useEffect(() => {
    const reload = window.api.db.onReload(() => void load())
    const refresh = window.api.db.onRefresh(() => void load())
    return () => { reload(); refresh() }
  }, [load])

  const apply = (item: PromptAssetItem) => {
    if (item.source === 'preset' && item.presetData) {
      loadPresetData(item.presetData, new Map(tags.map(tag => [tag.id, tag])))
      toast(`已应用预设：${item.name}`, 'success')
      return
    }
    if (item.source === 'favorite' && item.tagId) {
      const tag = tags.find(candidate => candidate.id === item.tagId)
      if (!tag) { toast('收藏标签已不在当前标签库中', 'error'); return }
      addPositive(tag, item.detail.split(' / ')[0] || '', item.detail.split(' / ')[1] || '')
      toast(`已添加标签：${tag.zh || tag.en}`, 'success')
      return
    }
    const result = replaceFromPromptText(item.prompt, tags)
    if (result.matched === 0) {
      toast('当前标签库中没有可匹配的标签，已保留资产原文供复制', 'info')
      return
    }
    toast(`已应用 ${result.matched} 个标签${result.unknown.length ? `，${result.unknown.length} 个未匹配` : ''}`, 'success')
  }

  const copyPrompt = async (item: PromptAssetItem) => {
    try {
      await navigator.clipboard.writeText(item.prompt)
      toast(`已复制：${item.name}`, 'success')
    } catch (cause) {
      console.error('Failed to copy prompt asset:', cause)
      toast('复制提示词资产失败', 'error')
    }
  }

  const totalPages = Math.max(1, Math.ceil(page.total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const createCategory = async (sourceScope: PromptAssetSourceFilter) => {
    const name = window.prompt('请输入分类名称')?.trim()
    if (!name || sourceScope === 'all') return
    await window.api.promptAssets.categories.create({ name, sourceScope })
    setCategories(await window.api.promptAssets.categories.list())
  }

  const categoriesByParent = useMemo(() => {
    const grouped = new Map<string | null, AssetCategory[]>()
    for (const category of categories) {
      const parentId = category.parentId || null
      grouped.set(parentId, [...(grouped.get(parentId) || []), category])
    }
    return grouped
  }, [categories])

  const refreshAfterCategoryChange = async () => {
    await Promise.all([
      load(),
      window.api.promptAssets.categories.list().then(setCategories),
    ])
  }

  return (
    <div className='h-full space-y-3 overflow-auto p-3'>
      <PanelHeader icon={FolderOpen} title='提示词资产' description={`${page.total} 条资产，统一浏览迁移内容、历史、预设和收藏`} actions={<div className='flex items-center gap-1'><Button size='sm' icon={Plus} onClick={() => void createCategory(source === 'all' ? 'asset' : source)}>新建分类</Button><IconButton icon={RefreshCw} label='刷新提示词资产' onClick={() => void load()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} /></div>} />

      <div className='relative'>
        <Search size={14} className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]' aria-hidden='true' />
        <input value={queryDraft} onChange={event => setQueryDraft(event.target.value)} className='ui-field pl-8 pr-9' placeholder='搜索名称、提示词、章节或分类' aria-label='搜索提示词资产' />
        {queryDraft && <IconButton icon={X} label='清除资产搜索' onClick={() => setQueryDraft('')} className='absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2' />}
      </div>

      <div className='ui-segmented grid grid-cols-3 sm:grid-cols-5' role='group' aria-label='资产来源'>
        {SOURCES.map(option => <button key={option.value} onClick={() => { setSource(option.value); setOffset(0) }} aria-pressed={source === option.value} className={`ui-segmented-item truncate px-1 text-[11px] ${source === option.value ? 'ui-segmented-item-active' : ''}`}>{option.label}</button>)}
      </div>

      {error && <div className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={15} aria-hidden='true' /><span className='flex-1'>{error}</span><Button size='sm' variant='ghost' onClick={() => void load()}>重试</Button></div>}

      {loading && page.items.length === 0 ? (
        <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载提示词资产</div>
      ) : page.items.length === 0 ? (
        <EmptyState icon={Search} title={query ? '没有匹配的提示词资产' : '暂无提示词资产'} description={query ? '尝试缩短关键词或切换来源' : '导入朋友项目提示词、保存预设或产生历史记录后会显示在这里'} />
      ) : (
        <div className='space-y-3'>
          {page.total > PAGE_SIZE && <div className='sticky top-0 z-30 -mx-1 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 px-3 py-2 shadow-sm backdrop-blur'><span className='text-xs text-[var(--color-text-secondary)]'>第 {currentPage} / {totalPages} 页</span><div className='flex items-center gap-1'><IconButton icon={ChevronLeft} label='上一页' onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0 || loading} /><IconButton icon={ChevronRight} label='下一页' onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= page.total || loading} /></div></div>}
          {(['asset', 'history', 'preset', 'favorite'] as PromptAssetItem['source'][]).map(group => {
            const items = page.items.filter(item => item.source === group)
            const title = SOURCE_META[group].label
            const roots = (categoriesByParent.get(null) || []).filter(category => category.sourceScope === group)
            const visibleCategoryIds = new Set<string>()
            const collectIds = (categoryId: string) => {
              visibleCategoryIds.add(categoryId)
              for (const child of categoriesByParent.get(categoryId) || []) collectIds(child.id)
            }
            roots.forEach(category => collectIds(category.id))
            const uncategorized = items.filter(item => !item.categoryIds?.some(id => visibleCategoryIds.has(id)))
            const renderCard = (item: PromptAssetItem) => <ResourceCard key={item.id}><AssetCard item={item} onPreview={() => setPreview(item)} onCopy={() => void copyPrompt(item)} onApply={() => apply(item)} onDragStart={event => { event.dataTransfer.setData('text/prompt-asset-id', item.id.replace(/^asset:/, '')); event.dataTransfer.effectAllowed = 'move' }} /></ResourceCard>
            return <ResourceGroup key={group} id={`prompt-assets:${group}`} title={title} count={items.length} empty={!items.length} forceOpen={Boolean(query)} contentClassName='col-span-full block'>
              <div className='col-span-full min-w-0 space-y-2'>
                {roots.map(category => <PromptAssetCategoryBranch key={category.id} category={category} categoriesByParent={categoriesByParent} items={items} onAssign={async (categoryId, itemId) => { await window.api.promptAssets.categories.assign({ assetId: itemId, categoryId }); await refreshAfterCategoryChange() }} renderCard={renderCard} forceOpen={Boolean(query)} />)}
                {uncategorized.length > 0 && <ResourceGroup id={`prompt-assets:uncategorized:${group}`} title='未分类' count={uncategorized.length} forceOpen={Boolean(query)}>{uncategorized.map(renderCard)}</ResourceGroup>}
              </div>
            </ResourceGroup>
          })}
        </div>
      )}


      <FloatingPreview title={preview?.name || '提示词资产预览'} open={preview !== null} onClose={() => setPreview(null)}>
        {preview && <AssetPreview item={preview} onCopy={() => void copyPrompt(preview)} onApply={() => { apply(preview); setPreview(null) }} />}
      </FloatingPreview>
    </div>
  )
}

function SourceBadge({ item }: { item: PromptAssetItem }) {
  const meta = SOURCE_META[item.source]
  const Icon = meta.icon
  return <Badge tone={meta.tone}><Icon size={11} aria-hidden='true' />{meta.label}</Badge>
}

function AssetCard({ item, onPreview, onCopy, onApply, onDragStart }: { item: PromptAssetItem; onPreview: () => void; onCopy: () => void; onApply: () => void; onDragStart?: (event: React.DragEvent) => void }) {
  return (
    <div className='min-w-0 p-3' draggable={Boolean(onDragStart)} onDragStart={onDragStart}>
      <div className='flex min-w-0 items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <h3 className='min-w-0 break-words text-sm font-medium leading-5 text-[var(--color-text-primary)] line-clamp-2' title={item.name || '未命名资产'}>{item.name || '未命名资产'}</h3>
          <div className='mt-1 flex min-w-0 flex-wrap items-center gap-1.5'><SourceBadge item={item} />{item.nsfw && <Badge tone='danger'>NSFW</Badge>}</div>
          {item.detail && <div className='mt-1 truncate text-[11px] text-[var(--color-text-secondary)]' title={item.detail}>{item.detail}</div>}
          <p className='mt-2 line-clamp-3 break-words font-mono text-xs leading-5 text-[var(--color-text-primary)]'>{item.prompt || '无提示词文本'}</p>
        </div>
        <div className='flex shrink-0 gap-1'>
          <IconButton icon={Copy} label={`复制 ${item.name}`} onClick={onCopy} />
          <Button size='sm' onClick={onPreview}>预览</Button>
        </div>
      </div>
      <Button size='sm' variant='primary' icon={FolderOpen} onClick={onApply} className='mt-3 w-full'>应用到提示词</Button>
    </div>
  )
}

function PromptAssetCategoryBranch({ category, categoriesByParent, items, onAssign, renderCard, forceOpen, depth = 0 }: {
  category: AssetCategory
  categoriesByParent: Map<string | null, AssetCategory[]>
  items: PromptAssetItem[]
  onAssign: (categoryId: string, assetId: string) => Promise<void>
  renderCard: (item: PromptAssetItem) => React.ReactNode
  forceOpen: boolean
  depth?: number
}) {
  const children = categoriesByParent.get(category.id) || []
  const categoryItems = items.filter(item => item.categoryIds?.includes(category.id))
  return <ResourceGroup id={`prompt-assets:category:${category.id}`} title={category.name} count={categoryItems.length} empty={!categoryItems.length && !children.length} forceOpen={forceOpen} contentClassName='col-span-full block'>
    <div className='col-span-full min-w-0 space-y-2' style={{ marginLeft: Math.min(depth, 4) * 10 }} onDragOver={event => event.preventDefault()} onDrop={event => { const assetId = event.dataTransfer.getData('text/prompt-asset-id'); if (assetId) void onAssign(category.id, assetId) }}>
      {categoryItems.length > 0 && <div className='grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]'>{categoryItems.map(renderCard)}</div>}
      {children.map(child => <PromptAssetCategoryBranch key={child.id} category={child} categoriesByParent={categoriesByParent} items={items} onAssign={onAssign} renderCard={renderCard} forceOpen={forceOpen} depth={depth + 1} />)}
    </div>
  </ResourceGroup>
}

function AssetPreview({ item, onCopy, onApply }: { item: PromptAssetItem; onCopy: () => void; onApply: () => void }) {
  return (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4'>
      <div className='flex min-w-0 flex-wrap gap-2'><SourceBadge item={item} />{item.nsfw && <Badge tone='danger'>NSFW</Badge>}{item.variantCount > 0 && <Badge>{item.variantCount} 个变体</Badge>}</div>
      {item.detail && <p className='rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]'>{item.detail}</p>}
      <pre className='min-h-0 max-h-none min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 text-xs leading-5 text-[var(--color-text-primary)]'>{item.prompt || '该资产没有可显示的提示词文本'}</pre>
      <div className='flex flex-col gap-2 sm:flex-row'><Button icon={Copy} onClick={onCopy} className='flex-1'>复制原文</Button><Button variant='primary' icon={FolderOpen} onClick={onApply} className='flex-1'>应用到提示词</Button></div>
    </div>
  )
}
