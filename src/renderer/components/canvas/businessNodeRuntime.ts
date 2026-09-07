import type { CanvasNode } from '../../../shared/canvas-types'
import type { TaskRecord } from '../../../shared/task-types'
import type { CanvasPluginCapability } from '../../../shared/canvas-plugin'

export interface CanvasWorkflowDefinition {
  id: string
  name: string
  bindings: Array<{ key: string }>
  defaults: Record<string, unknown>
}

export interface CanvasNodeExecutionResult {
  patch: Partial<CanvasNode>
  message: string
  ok: boolean
}

interface ExecutionDependencies {
  hasCapability: (kind: CanvasNode['kind'], capability: CanvasPluginCapability) => boolean
  createWD14Task: (input: { imageId: number; threshold: number; modelId?: string }) => Promise<{ id?: unknown }>
  createComfyTask: (workflowId: string, values: Record<string, unknown>) => Promise<{ id?: unknown }>
}

export interface PromptAssetApplyDependencies {
  hasCapability: (kind: CanvasNode['kind'], capability: CanvasPluginCapability) => boolean
  applyPromptText: (text: string) => { matched: number; unknown: string[] }
}

function requireCapability(node: CanvasNode, capability: CanvasPluginCapability, dependencies: ExecutionDependencies) {
  if (!dependencies.hasCapability(node.kind, capability)) throw new Error(`节点 ${node.title} 未授权能力：${capability}`)
}

export function executePromptAssetBusinessNode(node: CanvasNode, dependencies: PromptAssetApplyDependencies): CanvasNodeExecutionResult {
  try {
    if (!dependencies.hasCapability(node.kind, 'prompt.apply')) throw new Error(`节点 ${node.title} 未授权能力：prompt.apply`)
    if (node.kind !== 'prompt-asset') throw new Error('节点类型不是提示词资产')
    if (!node.content.trim()) throw new Error('提示词资产内容为空')
    const result = dependencies.applyPromptText(node.content)
    if (result.matched === 0) return { ok: false, patch: { status: 'error' }, message: '该提示词资产没有匹配到当前标签库' }
    return { ok: true, patch: { status: 'success' }, message: `已应用 ${result.matched} 个资产标签${result.unknown.length ? `，${result.unknown.length} 项未匹配` : ''}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : '提示词资产应用失败'
    return { ok: false, patch: { status: 'error' }, message }
  }
}

export async function executeWD14BusinessNode(node: CanvasNode, dependencies: ExecutionDependencies): Promise<CanvasNodeExecutionResult> {
  try {
    requireCapability(node, 'wd14.createTask', dependencies)
    if (node.kind !== 'wd14') throw new Error('节点类型不是 WD14')
    const imageId = node.config?.imageId
    if (!imageId) throw new Error('请先为 WD14 节点选择图片')
    const task = await dependencies.createWD14Task({ imageId, threshold: node.config?.threshold ?? 0.35, modelId: node.config?.modelId })
    if (typeof task.id !== 'string' || !task.id) throw new Error('WD14 未返回有效任务 ID')
    return { ok: true, patch: { refId: task.id, status: 'running', title: 'WD14 反推', content: '任务已加入队列' }, message: `WD14 任务已创建：${task.id}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WD14 任务创建失败'
    return { ok: false, patch: { status: 'error', content: message }, message }
  }
}

export async function executeComfyBusinessNode(node: CanvasNode, workflows: CanvasWorkflowDefinition[], dependencies: ExecutionDependencies): Promise<CanvasNodeExecutionResult> {
  try {
    requireCapability(node, 'comfyui.createTask', dependencies)
    if (node.kind !== 'comfyui') throw new Error('节点类型不是 ComfyUI')
    const workflow = workflows.find(item => item.id === node.config?.workflowId)
    if (!workflow) throw new Error('请先为 ComfyUI 节点选择工作流')
    if (!workflow.bindings.some(binding => binding.key === 'prompt')) throw new Error('该工作流没有可识别的正面提示词绑定')
    if (!node.content.trim()) throw new Error('ComfyUI 节点提示词不能为空')
    const task = await dependencies.createComfyTask(workflow.id, { ...workflow.defaults, prompt: node.content })
    if (typeof task.id !== 'string' || !task.id) throw new Error('ComfyUI 未返回有效任务 ID')
    return { ok: true, patch: { refId: task.id, status: 'running', title: 'ComfyUI 生成' }, message: `ComfyUI 任务已创建：${task.id}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ComfyUI 任务创建失败'
    return { ok: false, patch: { status: 'error' }, message }
  }
}

export function reconcileBusinessTaskNode(node: CanvasNode, task: TaskRecord): Partial<CanvasNode> {
  const status = task.status === 'succeeded' ? 'success' : task.status === 'failed' ? 'error' : ['running', 'queued', 'cancelling'].includes(task.status) ? 'running' : 'idle'
  if (node.kind === 'comfyui') return { title: 'ComfyUI 生成', status }
  if (node.kind === 'wd14') return { title: 'WD14 反推', status, content: task.error_message || task.status }
  let imageCount = 0
  try { imageCount = extractTaskImageIds(task).length } catch { /* Keep malformed legacy output visible as a status. */ }
  return { title: task.kind.toUpperCase() + ' 任务', status, content: task.error_message || (imageCount ? `${task.status} · ${imageCount} 张图片` : task.status) }
}

export function extractTaskImageIds(task: TaskRecord): number[] {
  const output = task.output_json ? JSON.parse(task.output_json) as { imageIds?: unknown } : null
  return Array.isArray(output?.imageIds) ? [...new Set(output.imageIds.filter((value): value is number => Number.isInteger(value) && value > 0))] : []
}

export function extractWD14TagNames(task: TaskRecord): string[] {
  const output = JSON.parse(task.output_json || '{}') as Record<string, unknown>
  return ['general', 'character', 'quality'].flatMap(group => {
    const values = output[group]
    if (!Array.isArray(values)) return []
    return values.map(value => value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name : '').filter(Boolean)
  })
}
