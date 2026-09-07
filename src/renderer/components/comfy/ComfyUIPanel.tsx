import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleAlert, CloudCog, ImagePlus, Link2, LoaderCircle, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react'
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
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8188')
  const [baseUrlDraft, setBaseUrlDraft] = useState('http://127.0.0.1:8188')
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [workflowValues, setWorkflowValues] = useState<Record<string, Record<string, unknown>>>({})
  const [quickForm, setQuickForm] = useState<QuickForm>(() => {
    const current = splitPrompt(usePromptsStore.getState().getFullPrompt('en'))
    return { ...DEFAULT_QUICK_FORM, prompt: current.prompt, negative: current.negative }
  })
  const [selectedLora, setSelectedLora] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickBusy, setQuickBusy] = useState(false)
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'danger'>('info')

  const modelOptions = quickForm.family === 'sdxl' ? models.checkpoints : models.unets
  const promptCount = usePromptsStore(state => state.positive.length + state.negative.length)
  const showMessage = (value: string, tone: 'info' | 'success' | 'danger' = 'info') => {
    setMessageTone(tone)
    setMessage(value)
  }

  useEffect(() => {
    if (!quickForm.model && modelOptions[0]) setQuickForm(form => ({ ...form, model: modelOptions[0] }))
  }, [quickForm.family, quickForm.model, modelOptions])

  const refresh = async () => {
    setBusy(true); setMessage('')
    try {
      const settings = await window.api.settings.getAll()
      const configuredUrl = typeof settings.comfyui_base_url === 'string' ? settings.comfyui_base_url : 'http://127.0.0.1:8188'
      setBaseUrl(configuredUrl); setBaseUrlDraft(configuredUrl)
      const status = await window.api.comfy.status()
      setOnline(status.online); setVersion(status.comfyui_version)
      if (status.online) setModels(await window.api.comfy.models())
      setWorkflows(await window.api.comfy.workflows())
    } catch (error) { showMessage(error instanceof Error ? error.message : 'ComfyUI 读取失败', 'danger') }
    finally { setBusy(false) }
  }

  useEffect(() => { void refresh() }, [])

  const saveBaseUrl = async () => {
    try {
      await window.api.settings.set('comfyui_base_url', baseUrlDraft.trim())
      setBaseUrl(baseUrlDraft.trim())
      showMessage('ComfyUI 地址已保存', 'success')
      await refresh()
    } catch (error) { showMessage(error instanceof Error ? error.message : 'ComfyUI 地址保存失败', 'danger') }
  }

  const importWorkflow = async () => {
    setBusy(true); setMessage('')
    try {
      const workflow = await window.api.comfy.importWorkflow()
      if (workflow) { showMessage('工作流已导入', 'success'); await refresh() }
    } catch (error) { showMessage(error instanceof Error ? error.message : '工作流导入失败', 'danger') }
    finally { setBusy(false) }
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
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader icon={CloudCog} title='ComfyUI 工作台' description='连接本地服务，编辑工作流并提交生成任务' actions={<div className='flex items-center gap-2'><StatusBadge tone={online ? 'success' : 'danger'}>{online ? `已连接${version ? ` · v${version}` : ''}` : '未连接'}</StatusBadge><IconButton icon={RefreshCw} label='刷新 ComfyUI 状态' onClick={() => void refresh()} disabled={busy} className={busy ? 'ui-spin-icon' : ''} /></div>} />
      <section className='ui-list-card p-3'>
        <Field label='ComfyUI 地址'>
          <div className='flex gap-2'>
            <input value={baseUrlDraft} onChange={event => setBaseUrlDraft(event.target.value)} className='ui-field min-w-0 flex-1' placeholder='http://127.0.0.1:8188' />
            <Button size='sm' icon={Save} onClick={() => void saveBaseUrl()} disabled={busy || baseUrlDraft.trim() === baseUrl}>保存并连接</Button>
          </div>
        </Field>
      </section>

      <div className='grid grid-cols-3 gap-2 text-center text-xs'>
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
        <div className='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4'>
          <NumberField label='Seed' value={quickForm.seed} min={-1} max={4294967295} onChange={value => value !== undefined && updateQuick('seed', value)} />
          <NumberField label='Steps' value={quickForm.steps} min={1} max={200} onChange={value => value !== undefined && updateQuick('steps', value)} />
          <NumberField label='CFG' value={quickForm.cfg} min={0} max={50} step={0.1} onChange={value => value !== undefined && updateQuick('cfg', value)} />
          <NumberField label='Batch' value={quickForm.batch} min={1} max={16} onChange={value => value !== undefined && updateQuick('batch', value)} />
        </div>
        <div className='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4'>
          <Field label='采样器'><select value={quickForm.sampler} onChange={event => updateQuick('sampler', event.target.value)} className='ui-field'>{SAMPLERS.map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label='调度器'><select value={quickForm.scheduler} onChange={event => updateQuick('scheduler', event.target.value)} className='ui-field'>{SCHEDULERS.map(value => <option key={value}>{value}</option>)}</select></Field>
          <NumberField label='宽度' value={quickForm.width} min={64} max={4096} onChange={value => value !== undefined && updateQuick('width', value)} />
          <NumberField label='高度' value={quickForm.height} min={64} max={4096} onChange={value => value !== undefined && updateQuick('height', value)} />
        </div>
        <div className='mt-2'><Field label='LoRA'><div className='flex gap-2'><select value={selectedLora} onChange={event => setSelectedLora(event.target.value)} className='ui-field min-w-0 flex-1'><option value=''>选择 LoRA</option>{models.loras.filter(name => !quickLoraSet.has(name)).map(name => <option key={name} value={name}>{name}</option>)}</select><Button size='sm' icon={Plus} onClick={addLora} disabled={!selectedLora}>添加</Button></div>{quickForm.loras.length > 0 && <div className='mt-2 flex flex-wrap gap-1.5'>{quickForm.loras.map(name => <span key={name} className='ui-prompt-chip ui-prompt-chip-positive gap-1 px-2 text-[11px]'><span className='max-w-48 truncate'>{name}</span><IconButton icon={X} label={`移除 LoRA ${name}`} onClick={() => updateQuick('loras', quickForm.loras.filter(item => item !== name))} className='h-5 w-5 flex-none' /></span>)}</div>}</Field></div>
        <Button variant='primary' icon={ImagePlus} onClick={() => void createQuickTask()} disabled={quickBusy || !online || !quickForm.model} className='mt-3 w-full'>{quickBusy ? '加入中...' : '加入快捷生成队列'}</Button>
      </section>

      <div className='flex items-center justify-between gap-2'><div><h3 className='text-sm font-semibold text-[var(--color-text-primary)]'>导入工作流</h3><p className='mt-1 text-[11px] text-[var(--color-text-secondary)]'>保留原始节点，仅编辑已识别的绑定字段</p></div><Button size='sm' icon={Upload} onClick={() => void importWorkflow()} disabled={busy}>导入 API JSON</Button></div>
      {message && <div className={'ui-inline-note ui-inline-note-' + messageTone} role={messageTone === 'danger' ? 'alert' : 'status'}>{messageTone === 'success' ? <Check size={15} aria-hidden='true' /> : <CircleAlert size={15} aria-hidden='true' />}<span>{message}</span></div>}
      {workflows.length === 0 ? <EmptyState icon={Upload} title='尚未导入工作流' description='导入 ComfyUI API JSON 后，可在这里编辑绑定字段并提交任务' /> : <div className='space-y-2'>{workflows.map(workflow => <WorkflowCard key={workflow.id} workflow={workflow} values={workflowValues[workflow.id] || defaultWorkflowValues(workflow.bindings, workflow.defaults, quickForm.prompt)} busy={busy} onChange={(key, value) => updateWorkflowValue(workflow.id, key, value)} onSubmit={() => void createWorkflowTask(workflow)} />)}</div>}
    </div>
  )
}

function WorkflowCard({ workflow, values, busy, onChange, onSubmit }: { workflow: WorkflowItem; values: Record<string, unknown>; busy: boolean; onChange: (key: string, value: unknown) => void; onSubmit: () => void }) {
  const canSubmit = workflow.bindings.some(binding => binding.key === 'prompt')
  return <article className='ui-list-card p-3'><div className='flex items-start justify-between gap-2'><div className='min-w-0'><div className='truncate text-sm font-medium text-[var(--color-text-primary)]'>{workflow.name}</div><div className='mt-2 flex flex-wrap gap-1.5'><Badge>{workflow.analysis?.nodeCount || 0} 个节点</Badge><Badge>{workflow.bindings.length} 个可映射字段</Badge></div></div><Button size='sm' icon={ImagePlus} onClick={onSubmit} disabled={busy || !canSubmit}>加入队列</Button></div>{workflow.bindings.length > 0 && <div className='mt-3 grid gap-2 sm:grid-cols-2'>{workflow.bindings.map(binding => <BindingField key={`${binding.key}-${binding.nodeId}-${binding.field}`} binding={binding} value={values[binding.key]} onChange={value => onChange(binding.key, value)} />)}</div>}{workflow.analysis?.warnings?.map(warning => <div key={warning} className='ui-inline-note ui-inline-note-warning mt-3 text-xs' role='status'><AlertTriangle size={14} aria-hidden='true' /><span>{warning}</span></div>)}</article>
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
    if (binding.key === 'prompt') values[binding.key] = prompt
  }
  return values
}

function splitPrompt(text: string): { prompt: string; negative: string } {
  const marker = '\n--neg '
  const index = text.indexOf(marker)
  if (index < 0) return { prompt: text, negative: '' }
  return { prompt: text.slice(0, index), negative: text.slice(index + marker.length) }
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className='ui-list-card p-2'><strong className='block text-sm text-[var(--color-text-primary)]'>{value}</strong><span className='text-[var(--color-text-secondary)]'>{label}</span></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className='block min-w-0'><span className='mb-1 block truncate text-[11px] text-[var(--color-text-secondary)]' title={label}>{label}</span>{children}</label>
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number | undefined; min?: number; max?: number; step?: number; onChange: (value: number | undefined) => void }) {
  return <Field label={label}><input type='number' value={value ?? ''} min={min} max={max} step={step} onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} className='ui-field' /></Field>
}
