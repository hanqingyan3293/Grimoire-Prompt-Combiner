import { ComfyUIError } from './comfy-error'
import type { ComfyNode, ComfyValue, ComfyWorkflow } from '../../shared/comfy-workflow-types'

export const COMFY_MAX_NODES = 5000
export const COMFY_MAX_JSON_BYTES = 10 * 1024 * 1024
export const COMFY_MAX_GRAPH_DEPTH = 32
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
export const isComfyRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export function workflowInvalid(message: string): ComfyUIError { return new ComfyUIError('COMFY_WORKFLOW_INVALID', message, false) }

export function assertComfyJsonBudget(value: unknown, label = '工作流 JSON'): void {
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) } catch { throw workflowInvalid(label + ' 包含循环或无法序列化的值') }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > COMFY_MAX_JSON_BYTES) throw workflowInvalid(label + ' 过大')
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  while (stack.length) {
    const item = stack.pop()!
    if (item.depth > COMFY_MAX_GRAPH_DEPTH) throw workflowInvalid(label + ' 嵌套超过32层')
    const current = item.value
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number' && Number.isFinite(current)) continue
    if (!Array.isArray(current) && !isComfyRecord(current)) throw workflowInvalid(label + ' 包含不支持的值')
    for (const [key, child] of Object.entries(current)) {
      if (reserved.has(key)) throw workflowInvalid(label + ' 包含不安全的字段')
      // Optional API metadata is omitted by JSON rather than persisted as a value.
      if (child === undefined && key === '_meta') continue
      stack.push({ value: child, depth: item.depth + 1 })
    }
  }
}

export function validateComfyApiWorkflow(input: unknown): ComfyWorkflow {
  if (!isComfyRecord(input)) throw workflowInvalid('ComfyUI 工作流必须是对象')
  const ids = Object.keys(input)
  if (!ids.length || ids.length > COMFY_MAX_NODES) throw workflowInvalid('ComfyUI 工作流节点数量无效')
  assertComfyJsonBudget(input)
  const workflow: ComfyWorkflow = {}
  const dependencies = new Map<string, string[]>()
  for (const id of ids) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(id) || reserved.has(id)) throw workflowInvalid('工作流节点 ID 无效')
    const raw = input[id]
    if (!isComfyRecord(raw)) throw workflowInvalid('工作流节点格式无效')
    if (typeof raw.class_type !== 'string' || !raw.class_type || raw.class_type.length > 200) throw workflowInvalid('工作流节点类型无效')
    if (!isComfyRecord(raw.inputs)) throw workflowInvalid('工作流节点输入无效')
    if (raw._meta !== undefined && !isComfyRecord(raw._meta)) throw workflowInvalid('工作流节点元数据无效')
    workflow[id] = { class_type: raw.class_type, inputs: raw.inputs as Record<string, ComfyValue>, _meta: raw._meta as ComfyNode['_meta'] }
    const incoming: string[] = []
    for (const value of Object.values(raw.inputs)) {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string') continue
      if (typeof value[1] !== 'number' || !Number.isSafeInteger(value[1]) || value[1] < 0) throw workflowInvalid('工作流 reference 输出槽位无效')
      if (!Object.hasOwn(input, value[0])) throw workflowInvalid('工作流连线来源节点不存在：' + value[0])
      incoming.push(value[0])
    }
    dependencies.set(id, incoming)
  }
  // Iterative DAG verification does not impose a call-stack limit on large graphs.
  const colors = new Map<string, 0 | 1 | 2>()
  for (const id of ids) {
    if (colors.get(id) === 2) continue
    const stack: Array<{ id: string; exit: boolean }> = [{ id, exit: false }]
    while (stack.length) {
      const current = stack.pop()!
      if (current.exit) { colors.set(current.id, 2); continue }
      const color = colors.get(current.id) || 0
      if (color === 1) throw workflowInvalid('工作流 reference 包含循环')
      if (color === 2) continue
      colors.set(current.id, 1); stack.push({ id: current.id, exit: true })
      for (const upstream of dependencies.get(current.id) || []) stack.push({ id: upstream, exit: false })
    }
  }
  return workflow
}
