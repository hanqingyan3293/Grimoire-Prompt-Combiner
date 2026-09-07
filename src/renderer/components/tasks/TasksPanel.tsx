import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, ClipboardList, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import type { TaskRecord, TaskStatus } from '../../../shared/task-types'
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
  const [actionTaskId, setActionTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const replaceFromPromptText = usePromptsStore(state => state.replaceFromPromptText)
  const tags = useTagsStore(state => state.tags)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTasks(await window.api.tasks.list() as TaskRecord[])
      setError(null)
    } catch (cause) {
      console.error('Failed to load tasks:', cause)
      setError('任务队列加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return window.api.tasks.onUpdated(() => void load())
  }, [load])

  const runTaskAction = async (id: string, action: 'cancel' | 'retry') => {
    setActionTaskId(id)
    try {
      if (action === 'cancel') await window.api.tasks.cancel(id)
      else await window.api.tasks.retry(id)
      await load()
    } catch (cause) {
      console.error(`Failed to ${action} task:`, cause)
      window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message: action === 'cancel' ? '取消任务失败' : '重试任务失败', type: 'error' } }))
    } finally {
      setActionTaskId(null)
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
                return (
                  <>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm font-medium text-[var(--color-text-primary)]'>{task.kind.toUpperCase()}</span>
                    <StatusBadge tone={STATUS_TONES[task.status]}>{STATUS_LABELS[task.status]}</StatusBadge>
                    {task.retry_count > 0 && <Badge tone='warning'>已重试 {task.retry_count}/{task.max_retries}</Badge>}
                  </div>
                  <div className='mt-1 truncate text-[11px] text-[var(--color-text-secondary)]'>{task.id}</div>
                </div>
                <div className='flex shrink-0 gap-1'>
                  {['queued', 'running', 'paused'].includes(task.status) && <Button size='sm' variant='ghost' icon={Ban} onClick={() => void runTaskAction(task.id, 'cancel')} disabled={actionTaskId === task.id}>取消</Button>}
                  {task.status === 'failed' && <Button size='sm' icon={RotateCcw} onClick={() => void runTaskAction(task.id, 'retry')} disabled={actionTaskId === task.id}>重试</Button>}
                </div>
              </div>
              <div className='mt-3 flex items-center gap-2'>
                <div className='flex-1'><ProgressBar value={task.progress} label={`${task.kind} 任务进度`} /></div>
                <span className='w-9 text-right text-[10px] tabular-nums text-[var(--color-text-secondary)]'>{Math.round(Math.min(1, Math.max(0, task.progress)) * 100)}%</span>
              </div>
              {task.error_message && <div className='ui-inline-alert mt-3 text-xs' role='alert'><AlertTriangle size={14} className='shrink-0' aria-hidden='true' /><span>{task.error_message}</span></div>}
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
