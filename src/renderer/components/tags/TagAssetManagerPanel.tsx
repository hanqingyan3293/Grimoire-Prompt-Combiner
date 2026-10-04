import { useEffect, useState } from 'react'
import { Check, Link2, Plus, Search, ShieldCheck, Tag as TagIcon, X } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'

type SearchResult = { tag: { id: string; en: string; zh: string; source: string }; matchedBy: string; score: number; usageCount: number }
type Suggestion = { id: string; assetType: string; assetKey: string; rawValue: string; tagId: string | null; namespace: string; confidence: number; source: string; status: string }
type Intelligence = { tag: { id: string; en: string; zh: string }; aliases: Array<{ id: string; alias: string; isBuiltin: boolean }>; relations: Array<{ id: string; sourceTagId: string; targetTagId: string; relationType: string; confidence: number }> }

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

  const search = async () => {
    try { setResults(await window.api.tags.search({ query, limit: 60 }) as SearchResult[]) }
    catch (error) { setMessage(error instanceof Error ? error.message : '标签搜索失败') }
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
  useEffect(() => { void search() }, [])
  useEffect(() => { if (tab === 'suggestions') void loadSuggestions() }, [tab])
  useEffect(() => { if (tab === 'asset') void loadAssetLinks() }, [tab, assetType, assetKey])

  const selectTag = async (item: SearchResult) => {
    setTab('search')
    setSelected(await window.api.tags.getIntelligence(item.tag.id) as Intelligence)
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
        <div className='flex gap-2'><input className='ui-field min-w-0 flex-1' value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder='搜索中文、英文或别名' /><Button size='sm' icon={Search} onClick={() => void search()}>搜索</Button></div>
        <div className='space-y-1'>{results.map(item => <div key={item.tag.id} className='ui-list-card flex items-center gap-2 p-2'><button type='button' onClick={() => void selectTag(item)} className='flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[var(--color-accent-text)]'><TagIcon size={15} className='shrink-0 text-[var(--color-accent-text)]' /><span className='min-w-0 flex-1 truncate'><span className='font-medium'>{item.tag.zh || item.tag.en}</span><span className='ml-2 text-xs text-[var(--color-text-secondary)]'>{item.tag.en}</span></span><StatusBadge tone={item.matchedBy === 'alias' ? 'accent' : 'neutral'}>{item.matchedBy}</StatusBadge></button>{selected && selected.tag.id !== item.tag.id ? <Button size='sm' variant='ghost' icon={Link2} onClick={() => void addRelation(item)}>关系</Button> : null}{tab === 'asset' ? <Button size='sm' variant='ghost' icon={Plus} onClick={() => void assignSelected(item)}>标注</Button> : null}</div>)}</div>
        {selected && <section className='ui-list-card space-y-3 p-3'><div className='flex items-center gap-2'><TagIcon size={16} /><div className='min-w-0 flex-1'><div className='truncate text-sm font-semibold'>{selected.tag.zh}</div><div className='truncate text-xs text-[var(--color-text-secondary)]'>{selected.tag.en}</div></div><IconButton icon={X} label='关闭详情' onClick={() => setSelected(null)} /></div><div><div className='mb-1 text-xs font-semibold'>别名</div><div className='flex flex-wrap gap-1'>{selected.aliases.map(alias => <span key={alias.id} className='rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-xs'>{alias.alias}</span>)}</div><div className='mt-2 flex gap-1'><input className='ui-field min-w-0 flex-1' value={aliasDraft} onChange={event => setAliasDraft(event.target.value)} placeholder='添加别名' /><Button size='sm' icon={Plus} onClick={() => void addAlias()}>添加</Button></div></div><div><div className='mb-1 text-xs font-semibold'>关系</div>{selected.relations.length ? selected.relations.map(relation => <div key={relation.id} className='flex items-center gap-2 py-1 text-xs'><Link2 size={13} /><span>{relation.relationType}</span><span className='truncate text-[var(--color-text-secondary)]'>{relation.sourceTagId === selected.tag.id ? relation.targetTagId : relation.sourceTagId}</span></div>) : <div className='text-xs text-[var(--color-text-secondary)]'>暂无关系。可从右侧搜索结果选择目标后创建。</div>}<select className='ui-field mt-2 w-full' value={relationType} onChange={event => setRelationType(event.target.value)}><option value='related'>相关</option><option value='implication'>推导</option><option value='contradiction'>冲突</option><option value='parent'>父级</option></select><div className='mt-2 text-xs text-[var(--color-text-secondary)]'>点击搜索结果即可继续查看标签；关系创建可在后续批量管理中完善。</div></div></section>}
      </>}
      {tab === 'suggestions' && <><div className='flex items-center justify-between'><div className='text-sm font-semibold'>待确认候选</div><Button size='sm' onClick={() => void loadSuggestions()}>刷新</Button></div>{suggestions.length ? suggestions.map(item => <article key={item.id} className='ui-list-card space-y-2 p-3'><div className='flex items-center gap-2'><div className='min-w-0 flex-1'><div className='truncate text-sm font-medium'>{item.rawValue}</div><div className='text-xs text-[var(--color-text-secondary)]'>{item.assetType} · {item.assetKey} · {item.namespace || '未分类'}</div></div><StatusBadge tone={item.confidence >= .8 ? 'success' : 'warning'}>{Math.round(item.confidence * 100)}%</StatusBadge></div><div className='flex gap-2'><Button size='sm' variant='primary' icon={Check} onClick={() => void accept(item)}>接受</Button><Button size='sm' variant='ghost' icon={X} onClick={() => void reject(item)}>拒绝</Button></div></article>) : <EmptyState icon={ShieldCheck} title='暂无待确认候选' description='WD14、提示词解析和 AI 识图结果会显示在这里' />}</>}
      {tab === 'asset' && <><div className='grid gap-2 sm:grid-cols-2'><select className='ui-field' value={assetType} onChange={event => setAssetType(event.target.value)}><option value='image'>图片</option><option value='prompt'>提示词资产</option><option value='canvas-node'>画布节点</option></select><input className='ui-field' value={assetKey} onChange={event => setAssetKey(event.target.value)} placeholder='例如 image:12' /></div><Button size='sm' onClick={() => void loadAssetLinks()}>读取资产标签</Button>{assetLinks.length ? <div className='space-y-1'>{assetLinks.map(item => <div key={item.tagId} className='ui-list-card flex items-center gap-2 p-2 text-xs'><TagIcon size={14} /><span className='flex-1'>{item.tagId}</span><span className='text-[var(--color-text-secondary)]'>{item.source} · {Math.round(item.confidence * 100)}%</span></div>)}</div> : <div className='text-xs text-[var(--color-text-secondary)]'>暂无已确认标签。可在标签字典搜索后接入资产标注。</div>}</>}
      {message && <div className='ui-inline-note ui-inline-note-info text-xs'>{message}</div>}
    </div>
  </div>
}
