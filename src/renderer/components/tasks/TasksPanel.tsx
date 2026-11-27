import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ban, Check, ClipboardList, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import type { ComfyTaskImageResult, TaskRecord, TaskStatus } from '../../../shared/task-types'
import { getTaskRetryMode } from '../../../shared/task-policy'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, ProgressBar, StatusBadge } from '../ui/Feedback'

const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '排队中', running: '运行中', paused: '已暂停', cancelling: '取消中',
  succeeded: '已完成', failed: '失败', cancelled: '已取消',
}

const STATUS_TONES: Record<TaskStatus, 'neutral' | 'accent' | 'success' | 'danger' | 'warning'> = {
  queued: 'neutral', running: 'accent', paused: 'warning', cancelling: 'warning',
  succeeded: 'success', failed: 'danger', cancelled: 'neutral',
}

type WD14Group = 'general' | 'character' | 'rating' | 'quality'
type WD14Tag = { name: string; confidence: number }
type WD14Output = Record<WD14Group, WD14Tag[]>

const WD14_GROUP_LABELS: Record<WD14Group, string> = {
  general: '通用', character: '角色', rating: '评级', quality: '质量',
}

export function formatTaskError(input: { kind: TaskRecord['kind']; errorCode: string | null; errorMessage: string; retryable?: boolean; nextAttemptAt?: string | null }): string {
  if (input.nextAttemptAt && !input.errorMessage) return '下次重试：' + input.nextAttemptAt
  const prefix = input.errorCode ? input.errorCode + '：' : ''
  const hint = input.retryable === true ? '（将自动重试）' : ''
  const deadline = input.retryable === true && input.nextAttemptAt ? '；下次重试：' + input.nextAttemptAt : ''
  return prefix + input.errorMessage + hint + deadline
}

export function formatCancelOutcome(value: TaskRecord['execution']): string | null {
  const outcome = value?.cancelOutcome
  if (!outcome || outcome === 'none') return null
  if (outcome === 'remote-confirmed') return '远端已确认取消'
  if (outcome === 'local-only') return '仅本地停止，远端未确认'
  return '远端取消请求失败'
}

type ComfyOutput = { kind: 'invalid' } | { kind: 'legacy'; imageIds: number[]; warnings: string[] } | { kind: 'results'; imageIds: number[]; warnings: string[]; images: ComfyTaskImageResult[] }
function isImageResult(value: unknown): value is ComfyTaskImageResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.filename === 'string' && typeof item.subfolder === 'string' && typeof item.type === 'string'
    && typeof item.status === 'string' && ['imported', 'pending', 'failed'].includes(item.status)
    && (item.imageId === null || (typeof item.imageId === 'number' && Number.isInteger(item.imageId) && item.imageId > 0))
    && (item.status !== 'imported' || item.imageId !== null)
    && (item.errorCode == null || typeof item.errorCode === 'string') && (item.errorMessage == null || typeof item.errorMessage === 'string')
}
function parseComfyOutput(task: TaskRecord): ComfyOutput | null {
  if (task.kind !== 'comfyui' || !task.output_json) return null
  try {
    const raw: unknown = JSON.parse(task.output_json)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid' }
    const value = raw as Record<string, unknown>
    if (value.version !== undefined && value.version !== 1) return { kind: 'invalid' }
    const imageIds = value.imageIds === undefined ? [] : value.imageIds
    const warnings = value.importWarnings === undefined ? [] : value.importWarnings
    if (!Array.isArray(imageIds) || !imageIds.every(id => typeof id === 'number' && Number.isInteger(id) && id > 0)
      || !Array.isArray(warnings) || !warnings.every(text => typeof text === 'string')) return { kind: 'invalid' }
    if (value.imageResults === undefined) return { kind: 'legacy', imageIds, warnings }
    if (!Array.isArray(value.imageResults) || !value.imageResults.every(isImageResult)) return { kind: 'invalid' }
    return { kind: 'results', imageIds, warnings, images: value.imageResults }
  } catch (cause) {
    console.warn('Invalid Comfy task result:', task.id, cause instanceof Error ? cause.name : 'unknown')
    return { kind: 'invalid' }
  }
}
const IMAGE_STATUS = { imported: '已导入', pending: '未完成', failed: '导入失败' } as const
function ComfyResult({ output }: { output: ComfyOutput }) {
  if (output.kind === 'invalid') return <div className='ui-inline-alert mt-3 text-xs' role='alert'>图片结果记录格式异常</div>
  return <section aria-label='ComfyUI 图片导入结果' className='mt-3 min-w-0 border-t border-[var(--color-border)] pt-3'>
    <h3 className='text-xs font-medium text-[var(--color-text-primary)]'>图片结果</h3>
    {output.kind === 'legacy' ? <>
      <p className='mt-1 text-xs text-[var(--color-text-secondary)]'>旧结果未记录逐图导入状态</p>
      <div className='mt-2 flex flex-wrap gap-2'>{output.imageIds.map(id => <Badge key={id}>图库引用 #{id}</Badge>)}</div>
    </> : <>
      <p className='mt-1 text-xs text-[var(--color-text-secondary)]' role='status' aria-live='polite'>已导入 {output.images.filter(item => item.status === 'imported').length} · 未完成 {output.images.filter(item => item.status === 'pending').length} · 失败 {output.images.filter(item => item.status === 'failed').length}</p>
      <ul className='mt-2 divide-y divide-[var(--color-border)]'>
        {output.images.map((item, index) => <li key={JSON.stringify([item.type, item.subfolder, item.filename, index])} className='min-w-0 py-2'>
          <div className='flex flex-wrap items-center gap-2'><StatusBadge tone={item.status === 'imported' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'}>{IMAGE_STATUS[item.status]}</StatusBadge>{item.imageId !== null && <Badge>图库 #{item.imageId}</Badge>}</div>
          <p className='mt-1 text-xs text-[var(--color-text-primary)] [overflow-wrap:anywhere]'>{item.subfolder ? item.subfolder + '/' : ''}{item.filename}</p>
          <p className='mt-1 text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]'>输出类型：{item.type}</p>
          {(item.errorCode || item.errorMessage) && <p className='mt-1 text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]'>{item.errorCode ? item.errorCode + '：' : ''}{item.errorMessage}</p>}
        </li>)}
      </ul>
    </>}
    {output.warnings.length > 0 && <ul aria-label='图片导入提示' className='mt-2 space-y-2'>{output.warnings.map((warning, index) => <li key={index} className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={14} aria-hidden='true' className='shrink-0' /><span className='min-w-0 [overflow-wrap:anywhere]'>{warning}</span></li>)}</ul>}
  </section>
}

function parseWD14Output(task: TaskRecord): WD14Output | null {
  if (task.kind !== 'wd14' || task.status !== 'succeeded' || !task.output_json) return null
  try {
    const raw = JSON.parse(task.output_json) as Record<string, unknown>
    const result = {} as WD14Output
    for (const group of Object.keys(WD14_GROUP_LABELS) as WD14Group[]) {
      const values = Array.isArray(raw[group]) ? raw[group] : []
      result[group] = values
        .filter(value => value && typeof value === 'object')
        .map(value => value as Record<string, unknown>)
        .filter(value => typeof value.name === 'string' && typeof value.confidence === 'number')
        .map(value => ({ name: String(value.name), confidence: Number(value.confidence) }))
    }
    return result
  } catch {
    return null
  }
}

function flattenWD14Tags(output: WD14Output): string {
  return (Object.keys(WD14_GROUP_LABELS) as WD14Group[])
    .flatMap(group => output[group].map(tag => tag.name))
    .join(', ')
}

function WD14Result({ output, onApply }: { output: WD14Output; onApply: () => void }) {
  const groups = (Object.keys(WD14_GROUP_LABELS) as WD14Group[]).filter(group => output[group].length > 0)
  const total = groups.reduce((count, group) => count + output[group].length, 0)
  return <div className='mt-3 border-t border-[var(--color-border)] pt-3'>
    <div className='mb-2 flex items-center justify-between gap-2'>
      <span className='text-xs font-medium text-[var(--color-text-primary)]'>反推结果 · {total} 个标签</span>
      <Button size='sm' variant='secondary' icon={Check} onClick={onApply}>应用匹配标签</Button>
    </div>
    <div className='space-y-2'>
      {groups.map(group => <div key={group}>
        <div className='mb-1 text-[10px] font-medium text-[var(--color-text-secondary)]'>{WD14_GROUP_LABELS[group]}</div>
        <div className='flex flex-wrap gap-1'>
          {output[group].map(tag => <Badge key={`${group}-${tag.name}`} className='font-normal' title={`置信度 ${(tag.confidence * 100).toFixed(1)}%`}>{tag.name} <span className='text-[var(--color-accent-text)]'>{Math.round(tag.confidence * 100)}%</span></Badge>)}
        </div>
      </div>)}
    </div>
  </div>
}

export function TasksPanel() {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set())
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const pendingRef = useRef(new Set<string>())
  const mounted = useRef(true)
  const loadSequence = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const replaceFromPromptText = usePromptsStore(state => state.replaceFromPromptText)
  const tags = useTagsStore(state => state.tags)

  const load = useCallback(async () => {
    if (!mounted.current) return
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const loaded = await window.api.tasks.list() as TaskRecord[]
      if (!mounted.current || sequence !== loadSequence.current) return
      setTasks(loaded)
      setError(null)
    } catch (cause) {
      console.error('Failed to load tasks:', cause)
      if (mounted.current && sequence === loadSequence.current) setError('任务队列加载失败，请重试')
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const unsubscribe = window.api.tasks.onUpdated(() => void load())
    return () => { mounted.current = false; loadSequence.current++; unsubscribe() }
  }, [load])

  const runTaskAction = async (id: string, action: 'cancel' | 'retry') => {
    if (!mounted.current || pendingRef.current.has(id)) return
    pendingRef.current.add(id)
    setPendingActions(new Set(pendingRef.current))
    setActionErrors(current => { const next = { ...current }; delete next[id]; return next })
    try {
      if (action === 'cancel') await window.api.tasks.cancel(id)
      else await window.api.tasks.retry(id)
      // Refresh may be superseded or remain pending; only the mutation RPC
      // owns this task's action fence.
      void load()
    } catch (cause) {
      console.error(`Failed to ${action} task:`, cause)
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mounted.current) {
        setActionErrors(current => ({ ...current, [id]: message }))
        window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message: (action === 'cancel' ? '取消任务失败：' : '重试任务失败：') + message, type: 'error' } }))
      }
    } finally {
      pendingRef.current.delete(id)
      if (mounted.current) setPendingActions(new Set(pendingRef.current))
    }
  }
  const applyWD14Tags = (output: WD14Output) => {
    const result = replaceFromPromptText(flattenWD14Tags(output), tags)
    window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: {
      message: result.matched
        ? `已应用 ${result.matched} 个标签${result.unknown.length ? `，${result.unknown.length} 个未匹配` : ''}`
        : '没有匹配到当前标签库中的 WD14 标签',
      type: result.matched ? 'success' : 'info',
    }}))
  }

  return (
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader icon={ClipboardList} title='任务队列' description='反推和生成任务会在后台持久化运行' actions={<IconButton icon={RefreshCw} label='刷新任务队列' onClick={() => void load()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />} />
      {error && <div className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={15} className='mt-0.5 shrink-0' aria-hidden='true' /><span className='flex-1'>{error}</span><Button size='sm' variant='ghost' onClick={() => void load()}>重试</Button></div>}
      {loading && tasks.length === 0 ? (
        <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载任务</div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={ClipboardList} title='暂无任务' description='图片反推或 ComfyUI 生成任务提交后会显示在这里' />
      ) : (
        <div className='space-y-2'>
          {tasks.map(task => (
            <div key={task.id} className='ui-list-card p-3'>
              {(() => {
                const wd14Output = parseWD14Output(task)
                const comfyOutput = parseComfyOutput(task)
                const retryMode = getTaskRetryMode(task)
                const retryScheduled = task.status === 'queued' && !!task.next_attempt_at
                return (
                  <>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm font-medium text-[var(--color-text-primary)]'>{task.kind.toUpperCase()}</span>
                    <StatusBadge tone={STATUS_TONES[task.status]}>{STATUS_LABELS[task.status]}</StatusBadge>
                    {task.retry_count > 0 && <Badge tone='warning'>已重试 {task.retry_count}/{task.max_retries}</Badge>}
                    {formatCancelOutcome(task.execution) && <Badge tone={task.execution?.cancelOutcome === 'remote-confirmed' ? 'success' : task.execution?.cancelOutcome === 'failed' ? 'danger' : 'warning'}>{formatCancelOutcome(task.execution)}</Badge>}
                  </div>
                  <div className='mt-1 truncate text-[11px] text-[var(--color-text-secondary)]'>{task.id}</div>
                </div>
                <div className='flex shrink-0 gap-1'>
                  {['queued', 'running', 'paused'].includes(task.status) && <Button size='sm' variant='ghost' icon={Ban} onClick={() => void runTaskAction(task.id, 'cancel')} disabled={pendingActions.has(task.id)}>取消</Button>}
                  {task.status === 'failed' && <Button size='sm' icon={RotateCcw} onClick={() => void runTaskAction(task.id, 'retry')} disabled={pendingActions.has(task.id) || retryMode === 'none'}>{retryMode === 'read' ? '续读原任务' : '重试'}</Button>}
                </div>
              </div>
              <div className='mt-3 flex items-center gap-2'>
                <div className='flex-1'><ProgressBar value={task.progress} label={`${task.kind} 任务进度`} /></div>
                <span className='w-9 text-right text-[10px] tabular-nums text-[var(--color-text-secondary)]'>{Math.round(Math.min(1, Math.max(0, task.progress)) * 100)}%</span>
              </div>
              {task.error_message && <div className='ui-inline-alert mt-3 text-xs' role='alert'><AlertTriangle size={14} className='shrink-0' aria-hidden='true' /><span>{formatTaskError({ kind: task.kind, errorCode: task.error_code, errorMessage: task.error_message, nextAttemptAt: task.next_attempt_at, retryable: retryScheduled })}</span></div>}
              {task.execution_error && <div className='ui-inline-alert mt-3 text-xs' role='alert'><AlertTriangle size={14} className='shrink-0' aria-hidden='true' /><span>{formatTaskError({ kind: task.kind, errorCode: 'COMFY_EXECUTION_INVALID', errorMessage: task.execution_error, retryable: false })}</span></div>}
              {retryScheduled && !task.error_message && <p className='mt-2 text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]'>下次重试：{task.next_attempt_at}</p>}
              {task.status === 'failed' && retryMode === 'none' && <p className='mt-2 text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]'>{task.execution_error ? '执行身份记录异常，重试已暂停' : task.retry_count >= task.max_retries ? '重试次数已用尽' : '原任务缺少可核实的提交身份，未重新提交'}</p>}
              {actionErrors[task.id] && <div className='ui-inline-alert mt-3 text-xs' role='alert'><AlertTriangle size={14} className='shrink-0' aria-hidden='true' /><span className='min-w-0 [overflow-wrap:anywhere]'>{actionErrors[task.id]}</span></div>}
              {comfyOutput && <ComfyResult output={comfyOutput} />}
              {wd14Output && <WD14Result output={wd14Output} onApply={() => applyWD14Tags(wd14Output)} />}
                  </>
                )
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
