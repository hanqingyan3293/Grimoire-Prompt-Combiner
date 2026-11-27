import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CircleAlert, CloudCog, ImagePlus, Link2, LoaderCircle, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react'
import type { ComfyHistoryResult, ComfyQueue } from '@shared/types'
import { BrowserPanel } from '../browser/BrowserPanel'
import { usePromptsStore } from '../../stores/prompts.store'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'

type ModelFamily = 'sdxl' | 'krea2' | 'anima'
type ComfyModels = { checkpoints: string[]; unets: string[]; loras: string[] }
type ComfyBinding = { key: string; label: string; nodeId: string; field: string; valueType: 'string' | 'number' | 'integer' | 'json' }

interface WorkflowItem {
  id: string
  name: string
  source: string
  analysis: { nodeCount?: number; warnings?: string[] }
  bindings: ComfyBinding[]
  defaults: Record<string, unknown>
}

interface QuickForm {
  family: ModelFamily
  model: string
  prompt: string
  negative: string
  seed: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  width: number
  height: number
  batch: number
  loras: string[]
}

const DEFAULT_QUICK_FORM: QuickForm = {
  family: 'sdxl', model: '', prompt: '', negative: '', seed: -1, steps: 25, cfg: 7,
  sampler: 'euler', scheduler: 'normal', width: 1024, height: 1024, batch: 1, loras: [],
}

const SAMPLERS = ['euler', 'euler_ancestral', 'heun', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc']
const SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform']

export function ComfyUIPanel() {
  const [online, setOnline] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [models, setModels] = useState<ComfyModels>({ checkpoints: [], unets: [], loras: [] })
  const [queue, setQueue] = useState<ComfyQueue | null>(null)
  const [historyPromptId, setHistoryPromptId] = useState('')
  const [history, setHistory] = useState<ComfyHistoryResult | null>(null)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8188')
  const [baseUrlDraft, setBaseUrlDraft] = useState('http://127.0.0.1:8188')
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [nodeCount, setNodeCount] = useState<number | null>(null)
  const [nodeTypes, setNodeTypes] = useState<string[]>([])
  const [remoteWorkflows, setRemoteWorkflows] = useState<string[]>([])
  const [selectedRemoteWorkflow, setSelectedRemoteWorkflow] = useState('')
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [remoteLoaded, setRemoteLoaded] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const remoteSequence = useRef(0)
  const endpointRef = useRef(baseUrl)
  const [workflowValues, setWorkflowValues] = useState<Record<string, Record<string, unknown>>>({})
  const [quickForm, setQuickForm] = useState<QuickForm>(() => {
    const current = splitPrompt(usePromptsStore.getState().getFullPrompt('en'))
    return { ...DEFAULT_QUICK_FORM, prompt: current.prompt, negative: current.negative }
  })
  const [selectedLora, setSelectedLora] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickBusy, setQuickBusy] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'danger'>('info')
  const [view, setView] = useState<'console' | 'web'>('console')

  const modelOptions = quickForm.family === 'sdxl' ? models.checkpoints : models.unets
  const promptCount = usePromptsStore(state => state.positive.length + state.negative.length)
  const showMessage = (value: string, tone: 'info' | 'success' | 'danger' = 'info') => {
    setMessageTone(tone)
    setMessage(value)
  }

  useEffect(() => {
    if (!quickForm.model && modelOptions[0]) setQuickForm(form => ({ ...form, model: modelOptions[0] }))
  }, [quickForm.family, quickForm.model, modelOptions])

  const refresh = async (): Promise<boolean> => {
    let ok = true
    setBusy(true); setMessage('')
    try {
      const settings = await window.api.settings.getAll()
      const configuredUrl = typeof settings.comfyui_base_url === 'string' ? settings.comfyui_base_url : 'http://127.0.0.1:8188'
      if (configuredUrl !== endpointRef.current) {
        endpointRef.current = configuredUrl; remoteSequence.current++
        setRemoteWorkflows([]); setSelectedRemoteWorkflow(''); setRemoteLoaded(false); setRemoteError(null); setRemoteBusy(false)
      }
      setBaseUrl(configuredUrl); setBaseUrlDraft(configuredUrl)
      const status = await window.api.comfy.status()
      setOnline(status.online); setVersion(status.comfyui_version)
      if (status.online) {
        setModels(await window.api.comfy.models())
        const types = Object.keys(await window.api.comfy.objectInfo()).sort()
        setNodeTypes(types); setNodeCount(types.length)
        setQueue(await window.api.comfy.queue())
      } else {
        setView('console')
        setQueue(null)
        setNodeCount(null)
        setNodeTypes([])
      }
      setWorkflows(await window.api.comfy.workflows())
    } catch (error) { ok = false; showMessage(error instanceof Error ? error.message : 'ComfyUI 读取失败', 'danger') }
    finally { setBusy(false) }
    return ok
  }

  useEffect(() => { void refresh() }, [])

  const loadHistory = async () => {
    const promptId = historyPromptId.trim()
    if (!promptId) return
    setHistoryBusy(true); setMessage('')
    try { setHistory(await window.api.comfy.history(promptId)) }
    catch (error) { setHistory(null); showMessage(error instanceof Error ? error.message : 'ComfyUI 历史读取失败', 'danger') }
    finally { setHistoryBusy(false) }
  }

  const saveBaseUrl = async () => {
    try {
      await window.api.settings.set('comfyui_base_url', baseUrlDraft.trim())
      setBaseUrl(baseUrlDraft.trim())
      await refresh()
      // Saving the address and successfully connecting are different outcomes. Reporting only "已保存" left a
      // failed connect looking like a success — the status badge still said 未连接 and nothing explained why.
      const status = await window.api.comfy.status()
      if (status.online) showMessage('ComfyUI 地址已保存，连接成功', 'success')
      else showMessage('ComfyUI 地址已保存，但连接失败：未检测到 ' + baseUrlDraft.trim() + ' 上的服务', 'danger')
    } catch (error) { showMessage(error instanceof Error ? error.message : 'ComfyUI 地址保存失败', 'danger') }
  }

  const deleteWorkflow = async (workflow: WorkflowItem) => {
    setBusy(true); setMessage('')
    try {
      const removed = await window.api.comfy.deleteWorkflow(workflow.id)
      if (removed) showMessage('工作流已删除', 'success')
      else showMessage('工作流删除失败', 'danger')
      await refresh()
    } catch (error) { showMessage(error instanceof Error ? error.message : '工作流删除失败', 'danger') }
    finally { setBusy(false) }
  }

  const importWorkflow = async () => {
    setBusy(true); setMessage('')
    try {
      const workflow = await window.api.comfy.importWorkflow() as WorkflowItem | null
      if (workflow) {
        const warningCount = Array.isArray(workflow.analysis?.warnings) ? workflow.analysis.warnings.length : 0
        const refreshed = await refresh()
        if (refreshed) showMessage(warningCount ? '工作流已导入，含 ' + warningCount + ' 条警告' : '工作流已导入', warningCount ? 'info' : 'success')
      }
    } catch (error) { showMessage(error instanceof Error ? error.message : '工作流导入失败', 'danger') }
    finally { setBusy(false) }
  }

  const readRemoteWorkflows = async () => {
    const sequence = ++remoteSequence.current
    setRemoteBusy(true); setRemoteError(null)
    try {
      const list = await window.api.comfy.remoteWorkflows()
      if (sequence !== remoteSequence.current) return
      setRemoteWorkflows(list); setRemoteLoaded(true)
      setSelectedRemoteWorkflow(current => list.includes(current) ? current : list[0] || '')
    } catch (error) {
      if (sequence !== remoteSequence.current) return
      setRemoteLoaded(false)
      setRemoteError(error instanceof Error ? error.message : '服务工作流读取失败，请重试')
    } finally { if (sequence === remoteSequence.current) setRemoteBusy(false) }
  }
  const importRemoteWorkflow = async () => {
    if (!selectedRemoteWorkflow) return
    const sequence = ++remoteSequence.current
    setRemoteBusy(true); setRemoteError(null)
    try {
      const workflow = await window.api.comfy.importRemoteWorkflow(selectedRemoteWorkflow) as WorkflowItem
      if (sequence !== remoteSequence.current) return
      const refreshed = await refresh()
      if (refreshed) showMessage('服务工作流已导入：' + workflow.name, 'success')
    } catch (error) { if (sequence === remoteSequence.current) setRemoteError(error instanceof Error ? error.message : '服务工作流导入失败，请重试') }
    finally { if (sequence === remoteSequence.current) setRemoteBusy(false) }
  }

  const updateQuick = <K extends keyof QuickForm>(key: K, value: QuickForm[K]) => {
    setQuickForm(form => ({ ...form, [key]: value }))
  }

  const addLora = () => {
    if (!selectedLora || quickForm.loras.includes(selectedLora)) return
    updateQuick('loras', [...quickForm.loras, selectedLora])
    setSelectedLora('')
  }

  const createQuickTask = async () => {
    if (!quickForm.model) { showMessage('请先选择模型', 'danger'); return }
    setQuickBusy(true); setMessage('')
    try {
      const task = await window.api.comfy.quickGenerate({
        ...quickForm,
        loras: quickForm.loras.map(name => ({ name, strength_model: 1, strength_clip: 1 })),
      })
      showMessage('快捷生成任务已加入队列：' + String(task.id), 'success')
    } catch (error) { showMessage(error instanceof Error ? error.message : '快捷生成任务创建失败', 'danger') }
    finally { setQuickBusy(false) }
  }

  const createWorkflowTask = async (workflow: WorkflowItem) => {
    setBusy(true); setMessage('')
    try {
      const values = workflowValues[workflow.id] || defaultWorkflowValues(workflow.bindings, workflow.defaults, quickForm.prompt)
      const task = await window.api.comfy.createTask(workflow.id, values)
      showMessage('工作流任务已加入队列：' + String(task.id), 'success')
    } catch (error) { showMessage(error instanceof Error ? error.message : '任务创建失败', 'danger') }
    finally { setBusy(false) }
  }

  const updateWorkflowValue = (workflowId: string, key: string, value: unknown) => {
    setWorkflowValues(current => ({ ...current, [workflowId]: { ...(current[workflowId] || {}), [key]: value } }))
  }

  const quickLoraSet = useMemo(() => new Set(quickForm.loras), [quickForm.loras])

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4'>
      <PanelHeader icon={CloudCog} title='ComfyUI 工作台' description='连接本地服务，编辑工作流并提交生成任务' actions={<div className='flex items-center gap-2'><StatusBadge tone={online ? 'success' : 'danger'}>{online ? `已连接${version ? ` · v${version}` : ''}` : '未连接'}</StatusBadge><IconButton icon={RefreshCw} label='刷新 ComfyUI 状态' onClick={() => void refresh()} disabled={busy} className={busy ? 'ui-spin-icon' : ''} /></div>} />
      <div role='tablist' aria-label='ComfyUI 视图' className='flex gap-1 border-b border-[var(--color-border)]'>
        <button type='button' role='tab' aria-selected={view === 'console'} onClick={() => setView('console')} className='ui-nav-item px-3 py-2'>控制台</button>
        <button type='button' role='tab' aria-selected={view === 'web'} disabled={!online} onClick={() => setView('web')} className='ui-nav-item px-3 py-2 disabled:opacity-50'>嵌入网页</button>
      </div>
      {view === 'web' && online ? (
        <div className='min-h-0 flex-1'>
          <BrowserPanel panelId='comfyui-web' initialUrl={baseUrl} />
        </div>
      ) : <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-auto'>
      {!online && <p role='status' className='ui-inline-note ui-inline-note-warning'>连接服务后可使用嵌入网页；当前仍可配置地址并查看本地工作流。</p>}
      <section className='ui-list-card p-3'>
        <Field label='ComfyUI 地址'>
          {/* Wraps instead of squeezing: at a 210px panel the input was 12px wide and showed "ht". */}
          <div className='flex flex-wrap gap-2'>
            <input value={baseUrlDraft} onChange={event => setBaseUrlDraft(event.target.value)} className='ui-field min-w-[10rem] flex-1' placeholder='http://127.0.0.1:8188' />
            <Button size='sm' icon={Save} onClick={() => void saveBaseUrl()} disabled={busy || baseUrlDraft.trim() === baseUrl}>保存并连接</Button>
          </div>
        </Field>
      </section>

      <section aria-label='ComfyUI 队列与历史' className='ui-list-card p-3'>
        <div className='mb-2'>
          <h3 className='text-sm font-semibold text-[var(--color-text-primary)]'>队列与历史</h3>
          <p className='mt-1 text-[11px] text-[var(--color-text-secondary)]'>只读取 ComfyUI 的 /queue 与 /history，不提交新任务</p>
        </div>
        <div className='grid grid-cols-2 gap-2 text-center text-xs [&>*]:min-w-0'>
          <Metric label='运行中' value={queue ? queue.queue_running : '—'} />
          <Metric label='等待中' value={queue ? queue.queue_pending : '—'} />
        </div>
        <div className='mt-2'>
          <Field label='历史任务 ID'>
            <div className='flex flex-wrap gap-2'>
              <input value={historyPromptId} onChange={event => setHistoryPromptId(event.target.value)} className='ui-field min-w-[10rem] flex-1' placeholder='prompt_id' />
              <Button size='sm' onClick={() => void loadHistory()} disabled={busy || historyBusy || !online || !historyPromptId.trim()}>{historyBusy ? '查询中...' : '查询历史'}</Button>
            </div>
          </Field>
        </div>
        {history && <div className='mt-2 flex min-w-0 items-center gap-2' role='status'>
          <StatusBadge tone={history.status === 'error' ? 'danger' : history.status === 'done' ? 'success' : 'accent'}>{historyStatusLabel(history)}</StatusBadge>
          {history.status === 'error' && history.message && <span className='min-w-0 truncate text-[11px] text-[var(--color-text-secondary)]' title={history.message}>{history.message}</span>}
        </div>}
      </section>

      <div className='grid grid-cols-2 gap-2 text-center text-xs [&>*]:min-w-0'>
        <Metric label='Checkpoint' value={models.checkpoints.length} />
        <Metric label='UNet' value={models.unets.length} />
        <Metric label='LoRA' value={models.loras.length} />
      </div>

      <section className='ui-list-card p-3'>
        <div className='mb-3 flex items-center justify-between gap-2'>
          <div>
            <h3 className='text-sm font-semibold text-[var(--color-text-primary)]'>快捷生成</h3>
            <p className='mt-1 text-[11px] text-[var(--color-text-secondary)]'>{promptCount ? `当前提示词组合包含 ${promptCount} 个标签` : '可直接输入提示词，或从提示词工作区带入'}</p>
          </div>
          <Button size='sm' icon={Link2} onClick={() => { const current = splitPrompt(usePromptsStore.getState().getFullPrompt('en')); updateQuick('prompt', current.prompt); updateQuick('negative', current.negative) }}>带入当前提示词</Button>
        </div>
        <div className='grid grid-cols-2 gap-2'>
          <Field label='模型家族'><select value={quickForm.family} onChange={event => { const family = event.target.value as ModelFamily; updateQuick('family', family); updateQuick('model', '') }} className='ui-field'><option value='sdxl'>SDXL</option><option value='krea2'>Krea2</option><option value='anima'>Anima</option></select></Field>
          <Field label='模型'><select value={quickForm.model} onChange={event => updateQuick('model', event.target.value)} className='ui-field'><option value=''>选择模型</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select></Field>
        </div>
        <div className='mt-2 grid gap-2'>
          <Field label='正面提示词'><textarea value={quickForm.prompt} onChange={event => updateQuick('prompt', event.target.value)} className='ui-field min-h-20 resize-y' placeholder='输入正面提示词' /></Field>
          <Field label='负面提示词'><textarea value={quickForm.negative} onChange={event => updateQuick('negative', event.target.value)} className='ui-field min-h-16 resize-y' placeholder='输入负面提示词' /></Field>
        </div>
        <div className='mt-2 grid grid-cols-2 gap-2'>
          <NumberField label='Seed' value={quickForm.seed} min={-1} max={4294967295} onChange={value => value !== undefined && updateQuick('seed', value)} />
          <NumberField label='Steps' value={quickForm.steps} min={1} max={200} onChange={value => value !== undefined && updateQuick('steps', value)} />
          <NumberField label='CFG' value={quickForm.cfg} min={0} max={50} step={0.1} onChange={value => value !== undefined && updateQuick('cfg', value)} />
          <NumberField label='Batch' value={quickForm.batch} min={1} max={16} onChange={value => value !== undefined && updateQuick('batch', value)} />
        </div>
        <div className='mt-2 grid grid-cols-2 gap-2'>
          <Field label='采样器'><select value={quickForm.sampler} onChange={event => updateQuick('sampler', event.target.value)} className='ui-field'>{SAMPLERS.map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label='调度器'><select value={quickForm.scheduler} onChange={event => updateQuick('scheduler', event.target.value)} className='ui-field'>{SCHEDULERS.map(value => <option key={value}>{value}</option>)}</select></Field>
          <NumberField label='宽度' value={quickForm.width} min={64} max={4096} onChange={value => value !== undefined && updateQuick('width', value)} />
          <NumberField label='高度' value={quickForm.height} min={64} max={4096} onChange={value => value !== undefined && updateQuick('height', value)} />
        </div>
        <div className='mt-2'><Field label='LoRA'><div className='flex gap-2'><select value={selectedLora} onChange={event => setSelectedLora(event.target.value)} className='ui-field min-w-0 flex-1'><option value=''>选择 LoRA</option>{models.loras.filter(name => !quickLoraSet.has(name)).map(name => <option key={name} value={name}>{name}</option>)}</select><Button size='sm' icon={Plus} onClick={addLora} disabled={!selectedLora}>添加</Button></div>{quickForm.loras.length > 0 && <div className='mt-2 flex flex-wrap gap-1.5'>{quickForm.loras.map(name => <span key={name} className='ui-prompt-chip ui-prompt-chip-positive gap-1 px-2 text-[11px]'><span className='max-w-48 truncate'>{name}</span><IconButton icon={X} label={`移除 LoRA ${name}`} onClick={() => updateQuick('loras', quickForm.loras.filter(item => item !== name))} className='h-5 w-5 flex-none' /></span>)}</div>}</Field></div>
        <Button variant='primary' icon={ImagePlus} onClick={() => void createQuickTask()} disabled={quickBusy || !online || !quickForm.model} className='mt-3 w-full'>{quickBusy ? '加入中...' : '加入快捷生成队列'}</Button>
      </section>

      <div className='flex items-center justify-between gap-2'><div><h3 className='text-sm font-semibold text-[var(--color-text-primary)]'>导入工作流</h3><p className='mt-1 text-[11px] text-[var(--color-text-secondary)]'>支持 API JSON 或前端图 JSON（nodes/links），转换警告会显示在卡片上</p></div><Button size='sm' icon={Upload} onClick={() => void importWorkflow()} disabled={busy}>导入工作流 JSON</Button></div>
      <section aria-label='服务工作流' className='ui-list-card space-y-2 p-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-semibold'>服务中的工作流</h3>
          <span className='text-xs text-[var(--color-text-secondary)]'>服务节点：{nodeCount ?? '—'}</span>
        </div>
        <p className='text-xs text-[var(--color-text-secondary)]'>快捷生成提供三个预设模板；更多节点和模型可通过服务工作流使用。</p>
        {nodeTypes.length > 0 && <details className='text-xs'>
          <summary className='cursor-pointer text-[var(--color-text-secondary)]'>查看服务节点</summary>
          <div aria-label='服务节点列表' className='mt-2 max-h-32 overflow-auto break-words text-[var(--color-text-secondary)]'>{nodeTypes.join(' · ')}</div>
        </details>}
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' icon={RefreshCw} onClick={() => void readRemoteWorkflows()} disabled={!online || busy || remoteBusy}>读取服务工作流</Button>
          <select aria-label='服务中的工作流' className='ui-field min-w-[10rem] flex-1' value={selectedRemoteWorkflow} onChange={event => setSelectedRemoteWorkflow(event.target.value)} disabled={!online || remoteBusy}>
            <option value=''>{remoteLoaded ? '选择服务工作流' : '先读取服务工作流'}</option>
            {remoteWorkflows.map(handle => <option key={handle} value={handle}>{handle}</option>)}
          </select>
          <Button size='sm' icon={Upload} onClick={() => void importRemoteWorkflow()} disabled={!online || busy || remoteBusy || !selectedRemoteWorkflow}>导入选中工作流</Button>
        </div>
        {remoteBusy && <p role='status' className='text-xs'>正在读取服务工作流…</p>}
        {remoteLoaded && !remoteBusy && remoteWorkflows.length === 0 && <p role='status' className='text-xs text-[var(--color-text-secondary)]'>服务目录中没有工作流。</p>}
        {remoteError && <p role='alert' className='text-xs text-[var(--color-danger)]'>工作流读取失败：{remoteError}</p>}
      </section>
      {message && <div className={'ui-inline-note ui-inline-note-' + messageTone} role={messageTone === 'danger' ? 'alert' : 'status'}>{messageTone === 'success' ? <Check size={15} aria-hidden='true' /> : <CircleAlert size={15} aria-hidden='true' />}<span>{message}</span></div>}
      {workflows.length === 0 ? <EmptyState icon={Upload} title='尚未导入工作流' description='导入 ComfyUI API JSON 后，可在这里编辑绑定字段并提交任务' /> : <div className='space-y-2'>{workflows.map(workflow => <WorkflowCard key={workflow.id} workflow={workflow} values={workflowValues[workflow.id] || defaultWorkflowValues(workflow.bindings, workflow.defaults, quickForm.prompt)} busy={busy} onChange={(key, value) => updateWorkflowValue(workflow.id, key, value)} onSubmit={() => void createWorkflowTask(workflow)} onDelete={() => void deleteWorkflow(workflow)} />)}</div>}
      </div>}
    </div>
  )
}

function WorkflowCard({ workflow, values, busy, onChange, onSubmit, onDelete }: { workflow: WorkflowItem; values: Record<string, unknown>; busy: boolean; onChange: (key: string, value: unknown) => void; onSubmit: () => void; onDelete: () => void }) {
  // Deleting a workflow throws away the user's field bindings, so it takes a second click on the same control
  // rather than a browser confirm() (which blocks the whole renderer).
  const [confirming, setConfirming] = useState(false)
  const canSubmit = workflow.bindings.some(binding => binding.key === 'prompt')
  return <article aria-label={'工作流 ' + workflow.name} className='ui-list-card p-3'><div className='flex flex-wrap items-start justify-between gap-2'><div className='min-w-[8rem] flex-1'><div className='truncate text-sm font-medium text-[var(--color-text-primary)]'>{workflow.name}</div><div className='mt-2 flex flex-wrap gap-1.5'><Badge>{workflow.analysis?.nodeCount || 0} 个节点</Badge><Badge>{workflow.bindings.length} 个可映射字段</Badge></div></div><div className='flex shrink-0 items-center gap-1'><Button size='sm' icon={ImagePlus} onClick={onSubmit} disabled={busy || !canSubmit}>加入队列</Button><Button size='sm' variant={confirming ? 'primary' : 'ghost'} onClick={() => { if (confirming) onDelete(); else setConfirming(true) }} disabled={busy}>{confirming ? '确认删除' : '删除'}</Button></div></div>{workflow.bindings.length > 0 && <div className='mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr))]'>{workflow.bindings.map(binding => <BindingField key={`${binding.key}-${binding.nodeId}-${binding.field}`} binding={binding} value={values[binding.key]} onChange={value => onChange(binding.key, value)} />)}</div>}{workflow.analysis?.warnings?.map(warning => <div key={warning} className='ui-inline-note ui-inline-note-warning mt-3 text-xs' role='status'><AlertTriangle size={14} aria-hidden='true' /><span>{warning}</span></div>)}</article>
}

function BindingField({ binding, value, onChange }: { binding: ComfyBinding; value: unknown; onChange: (value: unknown) => void }) {
  const label = `${binding.label} · ${binding.nodeId}.${binding.field}`
  if (binding.key === 'prompt' || binding.key === 'negativePrompt') return <Field label={label}><textarea value={String(value ?? '')} onChange={event => onChange(event.target.value)} className='ui-field min-h-16 resize-y' /></Field>
  if (binding.valueType === 'integer' || binding.valueType === 'number') return <NumberField label={label} value={typeof value === 'number' ? value : undefined} step={binding.valueType === 'integer' ? 1 : 0.1} onChange={onChange} />
  return <Field label={label}><input value={String(value ?? '')} onChange={event => onChange(event.target.value)} className='ui-field' /></Field>
}

function defaultWorkflowValues(bindings: ComfyBinding[], defaults: Record<string, unknown>, prompt: string): Record<string, unknown> {
  const values: Record<string, unknown> = { ...defaults }
  for (const binding of bindings) {
    if (binding.key === 'prompt' && (prompt.trim() || defaults[binding.key] === undefined)) values[binding.key] = prompt
  }
  return values
}

function splitPrompt(text: string): { prompt: string; negative: string } {
  const marker = '\n--neg '
  const index = text.indexOf(marker)
  if (index < 0) return { prompt: text, negative: '' }
  return { prompt: text.slice(0, index), negative: text.slice(index + marker.length) }
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className='ui-list-card p-2'><strong className='block text-sm text-[var(--color-text-primary)]'>{value}</strong><span className='text-[var(--color-text-secondary)]'>{label}</span></div>
}

function historyStatusLabel(history: ComfyHistoryResult): string {
  if (history.status === 'done') return `已完成 · ${history.images?.length ?? 0} 张图片`
  if (history.status === 'error') return '失败'
  return '运行中'
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className='block min-w-0'><span className='mb-1 block truncate text-[11px] text-[var(--color-text-secondary)]' title={label}>{label}</span>{children}</label>
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number | undefined; min?: number; max?: number; step?: number; onChange: (value: number | undefined) => void }) {
  return <Field label={label}><input type='number' value={value ?? ''} min={min} max={max} step={step} onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} className='ui-field' /></Field>
}
