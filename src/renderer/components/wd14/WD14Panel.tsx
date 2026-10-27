import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clipboard, FolderOpen, History, ImagePlus, LoaderCircle, Plus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'
import { Badge } from '../ui/Badge'
import { FloatingPreview } from '../ui/FloatingPreview'
import { HoverPreview } from '../ui/HoverPreview'
import type { WD14HistoryRecord } from '../../../shared/wd14-types'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'

interface WD14Model {
  id: string
  name: string
  has_csv: boolean
}

interface WD14Diagnostics {
  pythonPath: string
  pythonAvailable: boolean
  runtimeAvailable: boolean
  runtimeVersion: string | null
  modelDirectory: string
  modelDirectoryExists: boolean
  modelCount: number
  pairedModelCount: number
  blockingReason: string | null
}

interface WD14Image {
  id: number
  original_name: string | null
  available: boolean
  dataUrl?: string
}

type HistoryTagItem = { name: string; confidence?: number }

const HISTORY_STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
] as const

const TAG_BUCKET_LABELS: Array<{ key: 'general' | 'character' | 'rating' | 'quality'; label: string }> = [
  { key: 'general', label: '常规' },
  { key: 'character', label: '角色' },
  { key: 'rating', label: '分级' },
  { key: 'quality', label: '质量' },
]

function toHistoryTag(entry: unknown): HistoryTagItem | null {
  if (typeof entry === 'string') return entry ? { name: entry } : null
  if (!entry || typeof entry !== 'object') return null
  const record = entry as { name?: unknown; confidence?: unknown }
  if (typeof record.name !== 'string' || !record.name) return null
  const confidence = Number(record.confidence)
  return { name: record.name, confidence: Number.isFinite(confidence) ? confidence : undefined }
}

// tags 仍可能是旧数据的扁平数组（字符串或 {name, confidence}），此时整体并入 general
function readHistoryTagGroups(value: unknown): Array<{ label: string; tags: HistoryTagItem[] }> {
  if (Array.isArray(value)) {
    const tags = value.map(toHistoryTag).filter((tag): tag is HistoryTagItem => tag !== null)
    return tags.length ? [{ label: '常规', tags }] : []
  }
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return TAG_BUCKET_LABELS.flatMap(bucket => {
    const entries = Array.isArray(source[bucket.key]) ? source[bucket.key] as unknown[] : []
    const tags = entries.map(toHistoryTag).filter((tag): tag is HistoryTagItem => tag !== null)
    return tags.length ? [{ label: bucket.label, tags }] : []
  })
}

function HistoryTagGroups({ tags }: { tags: unknown }) {
  const groups = readHistoryTagGroups(tags)
  if (!groups.length) return <p className='text-xs text-[var(--color-text-secondary)]'>未返回标签</p>
  return <div className='space-y-3'>
    {groups.map(group => <section key={group.label} className='space-y-1.5'>
      <div className='text-xs font-medium text-[var(--color-text-secondary)]'>{group.label} · {group.tags.length}</div>
      <div className='flex flex-wrap gap-1.5'>
        {group.tags.map(tag => <Badge key={tag.name}>{tag.name}{typeof tag.confidence === 'number' && <span className='ml-1 text-[10px] font-normal opacity-70'>{Math.round(tag.confidence * 100)}%</span>}</Badge>)}
      </div>
    </section>)}
  </div>
}

export function WD14Panel() {
  const [images, setImages] = useState<WD14Image[]>([])
  const [models, setModels] = useState<WD14Model[]>([])
  const [modelId, setModelId] = useState('')
  const [unionModelIds, setUnionModelIds] = useState<string[]>([])
  const [unionMode, setUnionMode] = useState<'union' | 'intersection'>('union')
  const [threshold, setThreshold] = useState('0.35')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<WD14Diagnostics | null>(null)
  const [pythonPath, setPythonPath] = useState('')
  const [modelDirectory, setModelDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'danger'>('info')
  const [history, setHistory] = useState<WD14HistoryRecord[]>([])
  const [historyImages, setHistoryImages] = useState<Record<string, string>>({})
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<(typeof HISTORY_STATUS_FILTERS)[number]['value']>('all')
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set())
  const [previewHistory, setPreviewHistory] = useState<WD14HistoryRecord | null>(null)
  const [tagSuggestions, setTagSuggestions] = useState<Array<{ id: string; assetKey: string; rawValue: string; namespace: string; confidence: number }>>([])
  const allTags = useTagsStore(state => state.tags)
  const addPositive = usePromptsStore(state => state.addPositive)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const settings = await window.api.settings.getAll()
      setPythonPath(typeof settings.wd14_python_path === 'string' ? settings.wd14_python_path : '')
      setModelDirectory(typeof settings.wd14_model_directory === 'string' ? settings.wd14_model_directory : '')
      const diagnosis = await window.api.wd14.diagnostics() as WD14Diagnostics
      setDiagnostics(diagnosis)
      const imageList = await window.api.images.list()
      const availableImages = imageList.filter(image => image.available).map(image => ({ id: image.id, original_name: image.original_name, available: image.available }))
      const withData = await Promise.all(availableImages.map(async image => {
        try { return { ...image, dataUrl: await window.api.images.readData(image.id) } }
        catch { return image }
      }))
      setImages(withData)
      if (diagnosis.blockingReason) {
        setModels([])
        setMessageTone('info')
        setMessage(diagnosis.blockingReason + '；请选择正确的模型目录和 Python 后刷新')
        return
      }
      const modelList = await window.api.wd14.models()
      setModels(modelList.models.filter(model => Boolean(model.has_csv)).map(model => ({ id: String(model.id), name: String(model.name), has_csv: Boolean(model.has_csv) })))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const items = await window.api.wd14.history.list({ query: historyQuery, limit: 100 })
      setHistory(items)
      setSelectedHistoryIds(previous => new Set([...previous].filter(id => items.some(item => item.id === id))))
      const imageEntries = await Promise.all(items.map(async item => [item.id, await window.api.wd14.history.readImage(item.id)] as const))
      setHistoryImages(Object.fromEntries(imageEntries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    }
    catch (error) { showMessage(error instanceof Error ? error.message : 'WD14 历史记录读取失败', 'danger') }
    finally { setHistoryLoading(false) }
  }, [historyQuery])

  const loadTagSuggestions = useCallback(async () => {
    try { setTagSuggestions(await window.api.tags.suggestions.list({ assetType: 'image', status: 'pending' }) as Array<{ id: string; assetKey: string; rawValue: string; namespace: string; confidence: number }>) }
    catch { setTagSuggestions([]) }
  }, [])

  useEffect(() => {
    void load().catch(error => {
      setLoading(false)
      setMessageTone('danger')
      setMessage(error instanceof Error ? error.message : 'WD14 Worker 不可用')
    })
  }, [load])

  useEffect(() => { void loadHistory() }, [loadHistory])
  useEffect(() => { void loadTagSuggestions() }, [loadTagSuggestions])

  useEffect(() => {
    const cleanup = window.api.tasks.onUpdated(event => {
      if (event.kind === 'wd14' && (event.status === 'succeeded' || event.status === 'failed')) { void loadHistory(); void loadTagSuggestions() }
    })
    return cleanup
  }, [loadHistory, loadTagSuggestions])

  const acceptSuggestion = async (id: string) => { await window.api.tags.suggestions.accept(id); await loadTagSuggestions() }
  const rejectSuggestion = async (id: string) => { await window.api.tags.suggestions.reject(id); await loadTagSuggestions() }
  const batchAcceptHighConfidence = async () => {
    const ids = tagSuggestions.filter(item => item.confidence >= 0.7).map(item => item.id)
    if (!ids.length) return
    await window.api.tags.suggestions.batchResolve({ ids, action: 'accept' })
    await loadTagSuggestions()
  }
  const batchRejectAll = async () => {
    const ids = tagSuggestions.map(item => item.id)
    if (!ids.length || !window.confirm('拒绝全部待确认标签？')) return
    await window.api.tags.suggestions.batchResolve({ ids, action: 'reject' })
    await loadTagSuggestions()
  }

  const showMessage = (value: string, tone: 'info' | 'success' | 'danger' = 'info') => {
    setMessageTone(tone)
    setMessage(value)
  }

  const chooseModelDirectory = async () => {
    try {
      const directory = await window.api.wd14.selectModelDirectory()
      if (!directory) return
      await window.api.settings.set('wd14_model_directory', directory)
      await load()
      showMessage('WD14 模型目录已更新', 'success')
    } catch (error) { showMessage(error instanceof Error ? error.message : '模型目录设置失败', 'danger') }
  }

  const choosePythonPath = async () => {
    try {
      const selected = await window.api.wd14.selectPythonPath()
      if (!selected) return
      await window.api.settings.set('wd14_python_path', selected)
      setPythonPath(selected)
      await load()
      showMessage('Python 解释器已更新', 'success')
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Python 路径设置失败', 'danger') }
  }

  const createTask = async (imageId: number) => {
    setBusy(true)
    setMessage('')
    try {
      const task = await window.api.wd14.createTask({ imageId, modelId: modelId || undefined, modelIds: unionModelIds.length > 1 ? unionModelIds : undefined, unionMode: unionModelIds.length > 1 ? unionMode : undefined, threshold: Number(threshold) })
      showMessage('任务已创建：' + String(task.id), 'success')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '任务创建失败', 'danger')
    } finally {
      setBusy(false)
    }
  }

  // image_snapshot_path 的类型由并行会话加入 wd14-types；声明落地前后都用局部窄化读取
  const historySnapshotPath = (item: WD14HistoryRecord) => {
    const path = (item as WD14HistoryRecord & { image_snapshot_path?: string | null }).image_snapshot_path
    return typeof path === 'string' && path ? path : ''
  }

  const openHistorySnapshot = async (item: WD14HistoryRecord) => {
    const path = historySnapshotPath(item)
    if (!path) return
    try { await window.api.system.showItemInFolder(path) }
    catch (error) { showMessage(error instanceof Error ? error.message : '打开原图失败', 'danger') }
  }

  const toggleHistorySelection = (id: string) => {
    setSelectedHistoryIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const batchCreateTasks = async () => {
    const selected = history.filter(item => selectedHistoryIds.has(item.id))
    const queued = selected.filter(item => Number.isFinite(item.image_id) && item.image_id > 0)
    const skipped = selected.length - queued.length
    if (!queued.length) { showMessage('所选历史记录缺少图片 ID，无法批量反推', 'info'); return }
    setBusy(true)
    setMessage('')
    try {
      let created = 0
      let failed = 0
      for (const item of queued) {
        try { await window.api.wd14.createTask({ imageId: item.image_id, modelId: modelId || undefined, modelIds: unionModelIds.length > 1 ? unionModelIds : undefined, unionMode: unionModelIds.length > 1 ? unionMode : undefined, threshold: Number(threshold) }); created += 1 }
        catch { failed += 1 }
      }
      setSelectedHistoryIds(new Set())
      showMessage('已提交 ' + created + ' 个反推任务' + (failed ? '，失败 ' + failed + ' 个' : '') + (skipped ? '，跳过 ' + skipped + ' 个缺少图片的记录' : ''), created ? 'success' : 'danger')
    } finally {
      setBusy(false)
    }
  }

  const applyHistoryTags = (item: WD14HistoryRecord) => {
    const names = Object.values(item.tags).flat().map(tag => tag.name).filter(Boolean)
    const tagMap = new Map(allTags.flatMap(tag => [[tag.en.toLowerCase(), tag], [tag.zh, tag]]))
    let added = 0
    let unknown = 0
    for (const name of names) {
      const tag = tagMap.get(name.toLowerCase()) || tagMap.get(name)
      if (!tag) { unknown += 1; continue }
      addPositive(tag, '', '')
      added += 1
    }
    showMessage('已应用 ' + added + ' 个标签' + (unknown ? '，未匹配 ' + unknown + ' 个' : ''), added ? 'success' : 'info')
  }

  const deleteHistory = async (item: WD14HistoryRecord) => {
    if (!window.confirm('确定删除“' + item.image_name + '”的反推历史吗？')) return
    await window.api.wd14.history.delete(item.id)
    await loadHistory()
  }

  const clearHistory = async () => {
    if (!history.length || !window.confirm('确定清空全部 WD14 反推历史吗？此操作不可撤销。')) return
    await window.api.wd14.history.clear()
    await loadHistory()
  }

  const visibleHistory = historyStatus === 'all' ? history : history.filter(item => item.status === historyStatus)

  return (
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader
        icon={ImagePlus}
        title='WD14 图片反推'
        description='本地模型反推，结果会进入任务队列'
        actions={<IconButton icon={RefreshCw} label='刷新 WD14 状态' onClick={() => void load()} disabled={loading || busy} className={loading ? 'ui-spin-icon' : ''} />}
      />
      {diagnostics && (
        <section className='ui-list-card p-3'>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]'><Settings2 size={15} className='text-[var(--color-accent-text)]' aria-hidden='true' />运行环境</div>
              <div className='mt-2 flex flex-wrap gap-1.5'>
                <StatusBadge tone={diagnostics.pythonAvailable ? 'success' : 'danger'}>Python {diagnostics.pythonAvailable ? '可用' : '不可用'}</StatusBadge>
                <StatusBadge tone={diagnostics.runtimeAvailable ? 'success' : 'danger'}>onnxruntime {diagnostics.runtimeAvailable ? '可用' : '缺失'}</StatusBadge>
                {diagnostics.runtimeVersion && <Badge>v{diagnostics.runtimeVersion}</Badge>}
              </div>
              <div className='mt-1 truncate text-[11px] text-[var(--color-text-secondary)]' title={pythonPath || diagnostics.pythonPath}>解释器：{pythonPath || diagnostics.pythonPath}</div>
              <div className='mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]'><span className='truncate' title={diagnostics.modelDirectory}>模型：{diagnostics.pairedModelCount}/{diagnostics.modelCount} 个可用配对</span><StatusBadge tone={diagnostics.modelDirectoryExists && diagnostics.pairedModelCount > 0 ? 'success' : 'warning'}>{diagnostics.modelDirectoryExists && diagnostics.pairedModelCount > 0 ? '模型就绪' : '待配置模型'}</StatusBadge></div>
            </div>
            <StatusBadge tone={diagnostics.blockingReason ? 'warning' : 'success'}>{diagnostics.blockingReason || '可用'}</StatusBadge>
          </div>
          {diagnostics.blockingReason && <div className='ui-inline-note ui-inline-note-info mt-3 text-xs' role='status'><Settings2 size={15} className='mt-0.5 shrink-0' aria-hidden='true' /><span>{diagnostics.blockingReason}；请选择模型目录和 Python 后刷新</span></div>}
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button size='sm' icon={FolderOpen} onClick={() => void chooseModelDirectory()} disabled={busy}>选择模型目录</Button>
            <Button size='sm' icon={Settings2} onClick={() => void choosePythonPath()} disabled={busy}>选择 Python</Button>
          </div>
        </section>
      )}
      <label className='block text-xs text-[var(--color-text-secondary)]' htmlFor='wd14-model'>模型</label>
      <select id='wd14-model' value={modelId} onChange={event => setModelId(event.target.value)} className='ui-field' disabled={busy || models.length === 0}>
        <option value=''>自动选择可用模型</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      {/* 多模型 union（BDTM AutoTagger 语义）：勾选 ≥2 个模型时并集合并，单模型走原路径 */}
      {models.length > 1 ? (
        <details className='rounded border border-[var(--color-border)] p-2'>
          <summary className='cursor-pointer text-xs text-[var(--color-text-secondary)]'>多模型合并反推{unionModelIds.length > 1 ? `（已选 ${unionModelIds.length} 个）` : ''}</summary>
          <div className='mt-2 space-y-1.5'>
            {models.map(model => (
              <label key={model.id} className='flex items-center gap-2 text-xs'>
                <input type='checkbox' checked={unionModelIds.includes(model.id)} onChange={() => setUnionModelIds(current => current.includes(model.id) ? current.filter(value => value !== model.id) : [...current, model.id])} disabled={busy} />
                <span className='truncate'>{model.name}</span>
              </label>
            ))}
            <label className='flex items-center gap-2 text-xs'>
              <span className='text-[var(--color-text-secondary)]'>合并方式</span>
              <select className='ui-field w-32' value={unionMode} onChange={event => setUnionMode(event.target.value as 'union' | 'intersection')} disabled={busy} aria-label='多模型合并方式'>
                <option value='union'>并集（取最高置信度）</option>
                <option value='intersection'>交集（共同命中）</option>
              </select>
            </label>
          </div>
        </details>
      ) : null}
      <label className='block text-xs text-[var(--color-text-secondary)]' htmlFor='wd14-threshold'>阈值：{threshold}</label>
      <input id='wd14-threshold' type='range' min='0.01' max='0.99' step='0.01' value={threshold} onChange={event => setThreshold(event.target.value)} className='w-full accent-[var(--color-accent)]' disabled={busy} />
      {message && <div className={'ui-inline-note ui-inline-note-' + messageTone} role={messageTone === 'danger' ? 'alert' : 'status'}>{messageTone === 'success' ? <CheckCircle2 size={15} aria-hidden='true' /> : <AlertTriangle size={15} aria-hidden='true' />}<span>{message}</span></div>}
      <section className='space-y-2'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]'><ImagePlus size={15} className='text-[var(--color-accent-text)]' aria-hidden='true' />待反推图片</div>
          <span className='text-xs text-[var(--color-text-secondary)]'>{images.length} 张</span>
        </div>
        {loading && images.length === 0 ? <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin' aria-hidden='true' />正在读取图片资源</div> : images.length === 0 ? <EmptyState icon={ImagePlus} title='没有可反推的图片' description='请先在图片资源库导入可用图片' /> : (
          <div className='grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3'>
            {images.map(image => (
              <div key={image.id} className='min-w-0'>
                <HoverPreview
                  className='w-[320px] max-w-[calc(100vw-32px)] overflow-hidden p-2 transition-opacity duration-150'
                  preview={<>
                    {image.dataUrl ? <img src={image.dataUrl} alt='' className='max-h-[260px] w-full rounded object-contain' /> : <div className='grid h-40 place-items-center text-xs text-[var(--color-text-secondary)]'>图片不可用</div>}
                    <div className='mt-2 truncate px-1 text-xs text-[var(--color-text-secondary)]'>{image.original_name || ('图片 ' + image.id)}</div>
                  </>}
                >
                  <article className='ui-list-card overflow-hidden'>
                    {image.dataUrl ? <img src={image.dataUrl} alt={image.original_name || ('图片 ' + image.id)} className='aspect-[4/3] w-full object-cover' loading='lazy' /> : <div className='grid aspect-[4/3] place-items-center bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'><ImagePlus size={28} /></div>}
                    <div className='space-y-2 p-3'>
                      <div className='truncate text-sm font-medium text-[var(--color-text-primary)]' title={image.original_name || ('图片 ' + image.id)}>{image.original_name || ('图片 ' + image.id)}</div>
                      <Button size='sm' variant='primary' icon={ImagePlus} className='w-full' disabled={busy || Boolean(diagnostics?.blockingReason)} onClick={() => void createTask(image.id)}>反推</Button>
                    </div>
                  </article>
                </HoverPreview>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className='space-y-2 border-t border-[var(--color-border)] pt-3'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]'><History size={15} className='text-[var(--color-accent-text)]' aria-hidden='true' />反推历史</div>
          <div className='flex gap-1'>
            {history.length > 0 && <IconButton icon={Trash2} label='清空反推历史' onClick={() => void clearHistory()} className='ui-icon-button-danger' />}
            <IconButton icon={RefreshCw} label='刷新反推历史' onClick={() => void loadHistory()} disabled={historyLoading} className={historyLoading ? 'ui-spin-icon' : ''} />
          </div>
        </div>
        <div className='relative'>
          <Search size={14} className='pointer-events-none absolute left-2.5 top-2.5 text-[var(--color-text-secondary)]' aria-hidden='true' />
          <input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} className='ui-field w-full pl-8' placeholder='搜索文件名、标签或模型' aria-label='搜索反推历史' />
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          {HISTORY_STATUS_FILTERS.map(filter => <button key={filter.value} type='button' className={'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' + (historyStatus === filter.value ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 font-medium text-[var(--color-accent-text)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10')} onClick={() => setHistoryStatus(filter.value)}>{filter.label}</button>)}
        </div>
        {selectedHistoryIds.size > 0 && <div className='flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2'>
          <span className='text-xs text-[var(--color-text-secondary)]'>已选 {selectedHistoryIds.size} 条</span>
          <Button size='sm' variant='primary' icon={ImagePlus} disabled={busy || Boolean(diagnostics?.blockingReason)} onClick={() => void batchCreateTasks()}>批量反推</Button>
        </div>}
        {visibleHistory.length === 0 ? <div className='py-5 text-center text-xs text-[var(--color-text-secondary)]'>{history.length === 0 ? '暂无反推历史' : '没有符合当前筛选的历史'}</div> : (
          <div className='space-y-2'>
            {visibleHistory.map(item => {
              const image = images.find(candidate => candidate.id === item.image_id)
              const historyImage = historyImages[item.id] || image?.dataUrl
              const tags = Object.values(item.tags).flat().map(tag => tag.name).filter(Boolean)
              const snapshotPath = historySnapshotPath(item)
              return <article key={item.id} className='ui-list-card flex cursor-pointer gap-3 p-3' onClick={event => { if ((event.target as HTMLElement).closest('button, input')) return; setPreviewHistory(item) }}>
                <input type='checkbox' className='mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]' checked={selectedHistoryIds.has(item.id)} onChange={() => toggleHistorySelection(item.id)} aria-label={'选择历史：' + item.image_name} />
                {historyImage ? <img src={historyImage} alt='' className='size-16 shrink-0 rounded object-cover' /> : <div className='grid size-16 shrink-0 place-items-center rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'><ImagePlus size={20} /></div>}
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-xs font-medium text-[var(--color-text-primary)]' title={item.image_name}>{item.image_name}</div>
                  <div className='mt-1 line-clamp-3 text-[11px] leading-5 text-[var(--color-text-secondary)]'>{item.status === 'failed' ? item.error_message || '反推失败' : tags.join(', ') || '未返回标签'}</div>
                  <div className='mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]'>
                    <StatusBadge tone={item.status === 'failed' ? 'danger' : 'success'}>{item.status === 'failed' ? '失败' : '成功'}</StatusBadge>
                    <Badge>{item.model_id || '自动模型'}</Badge>
                    <span>阈值 {item.threshold}</span>
                  </div>
                </div>
                <div className='flex shrink-0 flex-col gap-1'>
                  <button type='button' className='grid size-7 place-items-center rounded hover:bg-[var(--color-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-40' title='打开原图' disabled={!snapshotPath} onClick={() => void openHistorySnapshot(item)}><FolderOpen size={14} /></button>
                  <button type='button' className='grid size-7 place-items-center rounded hover:bg-[var(--color-bg-tertiary)]' title='复制标签' onClick={() => void navigator.clipboard.writeText(tags.join(', '))}><Clipboard size={14} /></button>
                  {item.status === 'succeeded' && <button type='button' className='grid size-7 place-items-center rounded hover:bg-[var(--color-bg-tertiary)]' title='应用到正面提示词' onClick={() => applyHistoryTags(item)}><Plus size={14} /></button>}
                  <button type='button' className='grid size-7 place-items-center rounded text-red-500 hover:bg-red-500/10' title='删除历史' onClick={() => void deleteHistory(item)}><Trash2 size={14} /></button>
                </div>
              </article>
            })}
          </div>
        )}
      </section>

      {tagSuggestions.length > 0 && <section className='space-y-2 border-t border-[var(--color-border)] pt-3'>
        <div className='flex items-center justify-between gap-2'><div className='text-sm font-medium text-[var(--color-text-primary)]'>待确认标签</div><div className='flex items-center gap-2'><span className='text-xs text-[var(--color-text-secondary)]'>{tagSuggestions.length} 条</span><Button size='sm' onClick={() => void batchAcceptHighConfidence()}>接受 ≥70%</Button><Button size='sm' variant='ghost' onClick={() => void batchRejectAll()}>全部拒绝</Button></div></div>
        <div className='space-y-2'>{tagSuggestions.slice(0, 30).map(item => <article key={item.id} className='ui-list-card flex items-center gap-2 p-2'><div className='min-w-0 flex-1'><div className='truncate text-xs font-medium'>{item.rawValue}</div><div className='truncate text-[10px] text-[var(--color-text-secondary)]'>{item.assetKey} · {item.namespace || '未分类'}</div></div><Badge>{Math.round(item.confidence * 100)}%</Badge><IconButton icon={CheckCircle2} label='接受标签' onClick={() => void acceptSuggestion(item.id)} /><IconButton icon={Trash2} label='拒绝标签' onClick={() => void rejectSuggestion(item.id)} className='ui-icon-button-danger' /></article>)}</div>
      </section>}

      <FloatingPreview
        open={previewHistory !== null}
        title={previewHistory?.image_name || '反推详情'}
        onClose={() => setPreviewHistory(null)}
        footer={previewHistory && previewHistory.status === 'succeeded' ? <div className='flex justify-end'><Button size='sm' variant='primary' icon={Plus} onClick={() => { applyHistoryTags(previewHistory); setPreviewHistory(null) }}>应用到正面提示词</Button></div> : undefined}
      >
        {previewHistory && (previewHistory.status === 'failed'
          ? <p className='text-xs leading-5 text-[var(--color-text-secondary)]'>{previewHistory.error_message || '反推失败'}</p>
          : <HistoryTagGroups tags={previewHistory.tags} />)}
      </FloatingPreview>
    </div>
  )
}
