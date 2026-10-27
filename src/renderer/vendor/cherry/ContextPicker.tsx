import { useEffect, useState } from 'react'
import { Image, Plus, ScanSearch, Tags, Workflow } from 'lucide-react'
import type { PromptAssetItem } from '@shared/prompt-asset-types'
import type { CanvasProject } from '@shared/canvas-types'
import type { WD14HistoryRecord } from '@shared/wd14-types'
import { getCherryHostBridge } from '../../services/cherry-host-bridge'

export type AgentContextRef = {
  kind: 'image' | 'prompt' | 'tag' | 'canvas' | 'wd14'
  id: string
  label: string
  data: Record<string, unknown>
}

export function CherryContextPicker({ contexts, onChange }: { contexts: AgentContextRef[]; onChange: (contexts: AgentContextRef[]) => void }) {
  const [images, setImages] = useState<Array<{ id: number; original_name: string | null }>>([])
  const [prompts, setPrompts] = useState<PromptAssetItem[]>([])
  const [canvases, setCanvases] = useState<CanvasProject[]>([])
  const [tags, setTags] = useState<Array<{ id: string; en?: string; zh?: string }>>([])
  const [wd14History, setWd14History] = useState<WD14HistoryRecord[]>([])
  const [kind, setKind] = useState<AgentContextRef['kind']>('image')
  const [selected, setSelected] = useState('')

  useEffect(() => {
    let disposed = false
    const bridge = typeof window !== 'undefined' ? getCherryHostBridge() : undefined
    const load = async () => {
      const [imageRows, promptPage, canvasRows, tagRows, historyRows] = await Promise.all([
        bridge ? bridge.context.images.list().catch(() => []) : Promise.resolve([]),
        bridge ? bridge.context.prompts.list({ limit: 100 }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        bridge ? bridge.context.canvases.list().catch(() => []) : Promise.resolve([]),
        bridge ? bridge.context.tags.search({ query: '', limit: 100 }).catch(() => []) : Promise.resolve([]),
        bridge ? bridge.context.wd14.history.list({ limit: 100 }).catch(() => []) : Promise.resolve([]),
      ])
      if (disposed) return
      setImages(imageRows.map(item => ({ id: item.id, original_name: item.original_name })))
      const promptData = promptPage as { items?: PromptAssetItem[] } | PromptAssetItem[]
      setPrompts(Array.isArray(promptData) ? promptData : promptData.items || [])
      setCanvases((canvasRows || []) as CanvasProject[])
      setTags((tagRows as Array<Record<string, unknown>>).map(row => ({
        id: String(row.id || ''),
        en: typeof row.en === 'string' ? row.en : undefined,
        zh: typeof row.zh === 'string' ? row.zh : undefined,
      })).filter(row => row.id))
      setWd14History((historyRows || []) as WD14HistoryRecord[])
    }
    void load()
    return () => { disposed = true }
  }, [])

  const options = kind === 'image'
    ? images.map(item => ({ id: String(item.id), label: item.original_name || '图片 ' + item.id, data: { imageId: item.id, name: item.original_name || '' } }))
    : kind === 'prompt'
      ? prompts.map(item => ({ id: item.id, label: item.name, data: { promptAssetId: item.id, name: item.name, prompt: item.prompt } }))
      : kind === 'tag'
        ? tags.map(item => ({ id: item.id, label: item.zh ? item.zh + ' · ' + (item.en || '') : item.en || item.id, data: { tagId: item.id, en: item.en || '', zh: item.zh || '' } }))
        : kind === 'canvas'
          ? canvases.map(item => ({ id: item.id, label: item.name, data: { projectId: item.id, name: item.name } }))
          : wd14History.map(item => ({ id: item.id, label: item.image_name + ' · ' + item.created_at, data: { historyId: item.id, imageId: item.image_id, tags: item.tags, status: item.status } }))

  const add = () => {
    const option = options.find(item => item.id === selected)
    if (!option || contexts.some(context => context.kind === kind && context.id === option.id)) return
    onChange([...contexts, { kind, id: option.id, label: option.label, data: option.data }])
    setSelected('')
  }

  return <section data-agent-context-picker className="ui-list-card space-y-2 p-3 text-xs"><div className="flex items-center gap-2"><div className="font-semibold text-[var(--color-text-secondary)]">Grimoire 上下文</div><span className="text-[10px] text-[var(--color-text-secondary)]">仅在你添加后发送</span></div><div className="flex gap-2"><select className="ui-field w-28" value={kind} onChange={event => { setKind(event.target.value as AgentContextRef['kind']); setSelected('') }} aria-label="上下文类型"><option value="image">图片</option><option value="prompt">提示词</option><option value="tag">标签</option><option value="canvas">画布</option><option value="wd14">WD14 结果</option></select><select className="ui-field min-w-0 flex-1" value={selected} onChange={event => setSelected(event.target.value)} aria-label="选择上下文"><option value="">选择要附加的内容</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><button type="button" className="ui-toolbar-button" onClick={add} disabled={!selected} aria-label="添加上下文" title="添加上下文"><Plus size={14} /></button></div>{contexts.length > 0 && <div className="flex flex-wrap gap-1.5">{contexts.map(context => <button type="button" key={context.kind + ':' + context.id} onClick={() => onChange(contexts.filter(item => item !== context))} className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-2 py-1 text-[10px] text-[var(--color-accent-text)]" title="点击移除上下文">{context.kind === 'image' ? <Image size={11} /> : context.kind === 'tag' ? <Tags size={11} /> : context.kind === 'wd14' ? <ScanSearch size={11} /> : <Workflow size={11} />}<span className="max-w-40 truncate">{context.label}</span></button>)}</div>}</section>
}
