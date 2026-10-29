import { useEffect, useState } from 'react'
import { Check, Link2, Plus, Search, ShieldCheck, Tag as TagIcon, X } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'
import { TagAutocomplete } from './TagAutocomplete'
import { useTagsStore } from '../../stores/tags.store'

type SearchResult = { tag: { id: string; en: string; zh: string; source: string }; matchedBy: string; score: number; usageCount: number; subcategory?: { subcategoryZh: string; subcategoryEn: string; categoryZh: string; categoryEn: string } }
type Suggestion = { id: string; assetType: string; assetKey: string; rawValue: string; tagId: string | null; namespace: string; confidence: number; source: string; status: string }
type Intelligence = { tag: { id: string; en: string; zh: string }; aliases: Array<{ id: string; alias: string; isBuiltin: boolean }>; relations: Array<{ id: string; sourceTagId: string; targetTagId: string; relationType: string; confidence: number; enabled?: boolean }> }

export function TagAssetManagerPanel() {
  const [tab, setTab] = useState<'search' | 'suggestions' | 'asset'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState<Intelligence | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [assetType, setAssetType] = useState('image')
  const [assetKey, setAssetKey] = useState('image:')
  const [assetLinks, setAssetLinks] = useState<Array<{ tagId: string; source: string; confidence: number }>>([])
  const [message, setMessage] = useState('')
  const [relationType, setRelationType] = useState('related')
  const [aliasDraft, setAliasDraft] = useState('')
  const [suggestionSource, setSuggestionSource] = useState('all')
  const [minimumConfidence, setMinimumConfidence] = useState(0)
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set())
  const [mapTagId, setMapTagId] = useState('')
  const [reverseTagIds, setReverseTagIds] = useState<string[]>([])
  const [reverseLogic, setReverseLogic] = useState<'any' | 'all' | 'none'>('any')
  const [reverseIncludeImplied, setReverseIncludeImplied] = useState(false)
  const [reverseResult, setReverseResult] = useState<{ keys: Array<{ assetKey: string; matchedCount: number }>; total: number } | null>(null)
  const [metaNamespace, setMetaNamespace] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [metaColor, setMetaColor] = useState('')
  const [metaActive, setMetaActive] = useState(true)
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set())
  const allTagsForPicker = useTagsStore(state => state.tags)
  // 消歧义：结果里出现同名（显示名）多于一次时，这些行需要分类上下文。
  const ambiguousNames = new Set(
    Object.entries(results.reduce<Record<string, number>>((acc, item) => {
      const key = (item.tag.zh || item.tag.en).toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})).filter(([, count]) => count > 1).map(([name]) => name),
  )

  const search = async () => {
    // 标签字典是管理视图：包含禁用标签（灰色徽标可再启用），普通补全/搜索则隐藏它们。
    try {
      const found = await window.api.tags.search({ query, limit: 60, includeDisabled: true }) as SearchResult[]
      setResults(found)
      // 批量取元数据以标注「已禁用」状态（一次 IPC，不逐条查）。
      try {
        const metas = await window.api.tags.metadata.list(found.map(item => item.tag.id))
        setDisabledIds(new Set(found.filter((item, index) => metas[index] && metas[index]!.isActive === false).map(item => item.tag.id)))
      } catch { setDisabledIds(new Set()) }
    } catch (error) { setMessage(error instanceof Error ? error.message : '标签搜索失败') }
  }
  const loadSuggestions = async () => {
    try { setSuggestions(await window.api.tags.suggestions.list({ status: 'pending' }) as Suggestion[]) }
    catch (error) { setMessage(error instanceof Error ? error.message : '候选标签读取失败') }
  }
  const loadAssetLinks = async () => {
    if (!assetKey.trim()) return
    try { setAssetLinks(await window.api.tags.assetLinks.list({ assetType, assetKey }) as Array<{ tagId: string; source: string; confidence: number }>) }
    catch (error) { setMessage(error instanceof Error ? error.message : '资产标签读取失败') }
  }
  // 反向检索（Hydrus 语义）：按标签组合找出资产；这是 tag→asset 查询的唯一 UI 入口。
  const runReverseQuery = async () => {
    if (!reverseTagIds.length) { setMessage('请先添加至少一个标签'); return }
    try {
      setReverseResult(await window.api.tags.queryAssets({
        filter: { assetType, tagIds: reverseTagIds, logic: reverseLogic, includeImplied: reverseIncludeImplied },
        page: { limit: 100, offset: 0 },
      }))
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '反向检索失败')
    }
  }
  useEffect(() => { void search() }, [])
  useEffect(() => { if (tab === 'suggestions') void loadSuggestions() }, [tab])
  useEffect(() => { if (tab === 'asset') void loadAssetLinks() }, [tab, assetType, assetKey])

  const selectTag = async (item: SearchResult) => {
    setTab('search')
    setSelected(await window.api.tags.getIntelligence(item.tag.id) as Intelligence)
    await loadMetadata(item.tag.id)
  }
  // TagStudio 语义的元数据字段编辑器：namespace/描述/颜色/启用状态。
  const loadMetadata = async (tagId: string) => {
    try {
      const record = await window.api.tags.metadata.get(tagId)
      setMetaNamespace(record?.namespace || '')
      setMetaDescription(record?.description || '')
      setMetaColor(record?.color || '')
      setMetaActive(record ? record.isActive : true)
    } catch {
      setMetaNamespace(''); setMetaDescription(''); setMetaColor(''); setMetaActive(true)
    }
  }
  const saveMetadata = async () => {
    if (!selected) return
    try {
      // 空颜色不提交（合法值只有 #RRGGBB 或空，校验在主进程）。
      if (metaColor && !/^#[0-9a-fA-F]{6}$/.test(metaColor)) { setMessage('颜色格式应为 #RRGGBB'); return }
      const saved = await window.api.tags.metadata.save({ tagId: selected.tag.id, namespace: metaNamespace, description: metaDescription, color: metaColor, isActive: metaActive })
      setMetaNamespace(saved.namespace); setMetaDescription(saved.description); setMetaColor(saved.color); setMetaActive(saved.isActive)
      setMessage('元数据已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '元数据保存失败')
    }
  }
  const addAlias = async () => {
    if (!selected || !aliasDraft.trim()) return
    await window.api.tags.aliases.create({ tagId: selected.tag.id, alias: aliasDraft.trim() })
    setAliasDraft('')
    setSelected(await window.api.tags.getIntelligence(selected.tag.id) as Intelligence)
  }
  const addRelation = async (target: SearchResult) => {
    if (!selected || selected.tag.id === target.tag.id) return
    await window.api.tags.relations.create({ sourceTagId: selected.tag.id, targetTagId: target.tag.id, relationType })
    setSelected(await window.api.tags.getIntelligence(selected.tag.id) as Intelligence)
  }
  const accept = async (item: Suggestion) => { await window.api.tags.suggestions.accept(item.id); await loadSuggestions() }
  const reject = async (item: Suggestion) => { await window.api.tags.suggestions.reject(item.id); await loadSuggestions() }
  const visibleSuggestions = suggestions.filter(item => (suggestionSource === 'all' || item.source === suggestionSource) && item.confidence >= minimumConfidence)
  const toggleSuggestion = (id: string) => setSelectedSuggestionIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const resolveSelected = async (action: 'accept' | 'reject') => {
    await Promise.all([...selectedSuggestionIds].map(id => action === 'accept' ? window.api.tags.suggestions.accept(id) : window.api.tags.suggestions.reject(id)))
    setSelectedSuggestionIds(new Set())
    await loadSuggestions()
  }
  const mapSuggestion = async (item: Suggestion) => { if (!mapTagId.trim()) return; await window.api.tags.suggestions.map({ id: item.id, tagId: mapTagId.trim() }); setMapTagId(''); await loadSuggestions() }
  const createTagForSuggestion = async (item: Suggestion) => {
    const data = await window.api.tags.getAll()
    const subcategory = data.subcategories[0]
    if (!subcategory) { setMessage('没有可用子分类，请先创建标签分类'); return }
    const created = await window.api.tags.create({ subcategory_id: subcategory.id, en: item.rawValue, zh: item.rawValue })
    await window.api.tags.suggestions.map({ id: item.id, tagId: created.id })
    await loadSuggestions()
  }
  const assignSelected = async (item: SearchResult) => {
    if (!assetKey.trim()) return
    await window.api.tags.assetLinks.assign({ assetType, assetKey, tagId: item.tag.id, source: 'manual', status: 'accepted' })
    await loadAssetLinks()
  }

  return <div className='flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg-secondary)]'>
    <div className='shrink-0 border-b border-[var(--color-border)] p-3'>
      <PanelHeader icon={TagIcon} title='标签与资产' description='统一管理标签关系、候选和资产标注' />
      <div className='mt-3 flex gap-1'>
        {([['search', '标签字典'], ['suggestions', '候选标签'], ['asset', '资产标注']] as const).map(([key, label]) => <button key={key} type='button' className={'ui-nav-tab flex-1 py-2 ' + (tab === key ? 'ui-nav-tab-active' : '')} onClick={() => setTab(key)}>{label}</button>)}
      </div>
    </div>
    <div className='min-h-0 flex-1 overflow-auto p-3 space-y-3'>
      {tab === 'search' && <>
        <div className='flex gap-2'><input className='ui-field min-w-[8rem] flex-1' value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder='搜索中文、英文或别名' /><Button size='sm' icon={Search} onClick={() => void search()}>搜索</Button></div>
        <div className='space-y-1'>{results.map(item => {
          // 消歧义：同名（显示名相同）的命中高亮并显示分类归属，避免选错标签。
          const isAmbiguous = ambiguousNames.has((item.tag.zh || item.tag.en).toLowerCase())
          // Wraps and gives the name a minimum width: at a 210px panel the truncating span collapsed to
          // nothing, so rows showed only badges and the user could not tell which tag was which.
          return <div key={item.tag.id} className={'ui-list-card flex flex-wrap items-center gap-2 p-2' + (isAmbiguous ? ' border-[var(--color-warning)]/50' : '')}>
            <button type='button' onClick={() => void selectTag(item)} className='flex min-w-[8rem] flex-1 items-center gap-2 text-left hover:text-[var(--color-accent-text)]'><TagIcon size={15} className='shrink-0 text-[var(--color-accent-text)]' /><span className='min-w-0 flex-1 truncate'><span className={'font-medium' + (disabledIds.has(item.tag.id) ? ' opacity-50' : '')}>{item.tag.zh || item.tag.en}</span><span className='ml-2 text-xs text-[var(--color-text-secondary)]'>{item.tag.en}</span>{isAmbiguous && item.subcategory ? <span className='ml-2 text-[10px] text-[var(--color-warning)]'>[{item.subcategory.categoryZh || item.subcategory.categoryEn}/{item.subcategory.subcategoryZh || item.subcategory.subcategoryEn}]</span> : null}</span>{disabledIds.has(item.tag.id) ? <StatusBadge tone='warning'>已禁用</StatusBadge> : null}{isAmbiguous && item.subcategory ? null : null}<StatusBadge tone={item.matchedBy === 'alias' ? 'accent' : 'neutral'}>{item.matchedBy}</StatusBadge></button>{selected && selected.tag.id !== item.tag.id ? <Button size='sm' variant='ghost' icon={Link2} onClick={() => void addRelation(item)}>关系</Button> : null}{assetKey.trim() ? <Button size='sm' variant='ghost' icon={Plus} onClick={() => void assignSelected(item)}>标注</Button> : null}
          </div>
        })}</div>
        {selected && <section className='ui-list-card space-y-3 p-3'><div className='flex items-center gap-2'><TagIcon size={16} /><div className='min-w-0 flex-1'><div className='truncate text-sm font-semibold'>{selected.tag.zh}</div><div className='truncate text-xs text-[var(--color-text-secondary)]'>{selected.tag.en}</div></div><IconButton icon={X} label='关闭详情' onClick={() => setSelected(null)} /></div><div><div className='mb-1 text-xs font-semibold'>别名</div><div className='flex flex-wrap gap-1'>{selected.aliases.map(alias => <span key={alias.id} className='rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-xs'>{alias.alias}</span>)}</div><div className='mt-2 flex gap-1'><input className='ui-field min-w-[8rem] flex-1' value={aliasDraft} onChange={event => setAliasDraft(event.target.value)} placeholder='添加别名' /><Button size='sm' icon={Plus} onClick={() => void addAlias()}>添加</Button></div></div><div><div className='mb-1 text-xs font-semibold'>元数据</div><div className='space-y-1.5'>
              <input className='ui-field' value={metaNamespace} onChange={event => setMetaNamespace(event.target.value)} placeholder='命名空间（如 character / style）' aria-label='标签命名空间' />
              <input className='ui-field' value={metaColor} onChange={event => setMetaColor(event.target.value)} placeholder='颜色（#RRGGBB）' aria-label='标签颜色' />
              <textarea className='ui-field resize-y' rows={2} value={metaDescription} onChange={event => setMetaDescription(event.target.value)} placeholder='描述' aria-label='标签描述' />
              <label className='inline-flex items-center gap-1.5 text-xs'><input type='checkbox' checked={metaActive} onChange={event => setMetaActive(event.target.checked)} />启用该标签</label>
              <Button size='sm' icon={Check} onClick={() => void saveMetadata()}>保存元数据</Button>
            </div></div>
            <div><div className='mb-1 text-xs font-semibold'>关系</div>{selected.relations.length ? selected.relations.map(relation => <div key={relation.id} className='flex items-center gap-2 py-1 text-xs'><Link2 size={13} /><span>{relation.relationType}</span><span className='min-w-0 flex-1 truncate text-[var(--color-text-secondary)]'>{relation.sourceTagId === selected.tag.id ? relation.targetTagId : relation.sourceTagId}</span><IconButton icon={X} label='删除关系' onClick={async () => { await window.api.tags.relations.delete(relation.id); setSelected(await window.api.tags.getIntelligence(selected.tag.id) as Intelligence) }} /></div>) : <div className='text-xs text-[var(--color-text-secondary)]'>暂无关系。可从其他搜索结果创建。</div>}<select className='ui-field mt-2 w-full' value={relationType} onChange={event => setRelationType(event.target.value)}><option value='related'>相关</option><option value='implication'>推导</option><option value='contradiction'>冲突</option><option value='parent'>父级</option></select></div></section>}
      </>}
      {tab === 'suggestions' && <><div className='grid gap-2 grid-cols-2'><select className='ui-field' value={suggestionSource} onChange={event => setSuggestionSource(event.target.value)}><option value='all'>全部来源</option><option value='wd14'>WD14</option><option value='parsed'>提示词解析</option><option value='ai-vision'>AI 识图</option><option value='imported'>导入</option></select><select className='ui-field' value={minimumConfidence} onChange={event => setMinimumConfidence(Number(event.target.value))}><option value='0'>全部置信度</option><option value='0.8'>≥ 80%</option><option value='0.9'>≥ 90%</option></select></div><div className='flex items-center justify-between'><div className='text-sm font-semibold'>待确认候选（{visibleSuggestions.length}）</div><div className='flex gap-1'><Button size='sm' variant='primary' icon={Check} disabled={!selectedSuggestionIds.size} onClick={() => void resolveSelected('accept')}>接受选中</Button><Button size='sm' variant='ghost' icon={X} disabled={!selectedSuggestionIds.size} onClick={() => void resolveSelected('reject')}>拒绝选中</Button><Button size='sm' onClick={() => void loadSuggestions()}>刷新</Button></div></div>{visibleSuggestions.length ? visibleSuggestions.map(item => <article key={item.id} className='ui-list-card flex flex-wrap items-center gap-2 p-3'><input type='checkbox' checked={selectedSuggestionIds.has(item.id)} onChange={() => toggleSuggestion(item.id)} /><div className='min-w-0 flex-1'><div className='truncate text-sm font-medium'>{item.rawValue}</div><div className='text-xs text-[var(--color-text-secondary)]'>{item.assetType} · {item.assetKey} · {item.namespace || '未分类'}</div></div><StatusBadge tone={item.confidence >= .8 ? 'success' : 'warning'}>{Math.round(item.confidence * 100)}%</StatusBadge><IconButton icon={Check} label='接受标签' onClick={() => void accept(item)} /><IconButton icon={X} label='拒绝标签' onClick={() => void reject(item)} className='ui-icon-button-danger' /><Button size='sm' onClick={() => void createTagForSuggestion(item)}>创建标签</Button><div className='flex w-full gap-1'><input className='ui-field min-w-[8rem] flex-1' value={mapTagId} onChange={event => setMapTagId(event.target.value)} placeholder='输入目标 tagId 映射' /><Button size='sm' onClick={() => void mapSuggestion(item)}>映射</Button></div></article>) : <EmptyState icon={ShieldCheck} title='暂无待确认候选' description='WD14、提示词解析和 AI 识图结果会显示在这里' />}</>}
      {tab === 'asset' && <>
        <div className='grid gap-2 grid-cols-2'><select className='ui-field' value={assetType} onChange={event => setAssetType(event.target.value)}><option value='image'>图片</option><option value='prompt'>提示词资产</option><option value='canvas-node'>画布节点</option></select><input className='ui-field' value={assetKey} onChange={event => setAssetKey(event.target.value)} placeholder='例如 image:12' /></div>
        <Button size='sm' onClick={() => void loadAssetLinks()}>读取资产标签</Button>
        {assetLinks.length ? <div className='space-y-1'>{assetLinks.map(item => <div key={item.tagId} className='ui-list-card flex items-center gap-2 p-2 text-xs'><TagIcon size={14} /><span className='flex-1'>{item.tagId}</span><span className='text-[var(--color-text-secondary)]'>{item.source} · {Math.round(item.confidence * 100)}%</span></div>)}</div> : <div className='text-xs text-[var(--color-text-secondary)]'>暂无已确认标签。可在标签字典搜索后接入资产标注。</div>}
        {/* 反向检索：按标签找资产（Hydrus 语义，tag→asset 的唯一 UI 入口） */}
        <section className='ui-list-card space-y-2 p-3'>
          <div className='mb-1 text-xs font-semibold'>按标签反查资产</div>
          <TagAutocomplete allTags={allTagsForPicker} placeholder='添加筛选标签…' excludeIds={reverseTagIds} onSelect={item => setReverseTagIds(current => [...current, item.id])} />
          {reverseTagIds.length > 0 && <div className='flex flex-wrap gap-1'>{reverseTagIds.map(id => <span key={id} className='ui-prompt-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]'><span>{allTagsForPicker.find(tag => tag.id === id)?.zh || allTagsForPicker.find(tag => tag.id === id)?.en || id}</span><button type='button' aria-label={`移除筛选标签 ${id}`} className='text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]' onClick={() => setReverseTagIds(current => current.filter(value => value !== id))}>×</button></span>)}</div>}
          <div className='flex flex-wrap items-center gap-2'>
            <select className='ui-field w-28' value={reverseLogic} onChange={event => setReverseLogic(event.target.value as 'any' | 'all' | 'none')} aria-label='匹配逻辑'><option value='any'>任一标签</option><option value='all'>全部标签</option><option value='none'>排除标签</option></select>
            <label className='inline-flex items-center gap-1.5 text-xs'><input type='checkbox' checked={reverseIncludeImplied} onChange={event => setReverseIncludeImplied(event.target.checked)} />包含隐含子标签</label>
            <Button size='sm' icon={Search} onClick={() => void runReverseQuery()} disabled={!reverseTagIds.length}>反查</Button>
          </div>
          {reverseResult ? (reverseResult.total > 0 ? <div className='space-y-1'>
            <div className='text-xs text-[var(--color-text-secondary)]'>匹配 {reverseResult.total} 个资产{reverseResult.total > reverseResult.keys.length ? `，显示前 ${reverseResult.keys.length} 个` : ''}</div>
            {reverseResult.keys.map(entry => <div key={entry.assetKey} className='ui-list-card flex items-center gap-2 p-2 text-xs'><TagIcon size={14} /><span className='flex-1'>{entry.assetKey}</span><span className='text-[var(--color-text-secondary)]'>命中 {entry.matchedCount} 个标签</span></div>)}
          </div> : <div className='text-xs text-[var(--color-text-secondary)]'>没有匹配的资产</div>) : null}
        </section>
      </>}
      {message && <div className='ui-inline-note ui-inline-note-info text-xs'>{message}</div>}
    </div>
  </div>
}
