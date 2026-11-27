import { loadComfySourceBundle } from './comfy-source-loader'
import { createComfyHttpFetch } from '../../main/services/comfy-http.transport'
import { ComfyUIError, readComfyAbortError } from '../../main/services/comfy-error'
import { assertComfyJsonBudget, COMFY_MAX_NODES, isComfyRecord, validateComfyApiWorkflow, workflowInvalid } from '../../main/services/comfy-workflow-validation'
import type { ComfyFrontendParseResult, ComfyObjectInfo, ComfyWorkflow, ComfyWorkflowSource, ParseComfyFrontendOptions } from '../../shared/comfy-workflow-types'

export function getComfyWorkflowSource(): ComfyWorkflowSource {
  const source = loadComfySourceBundle<ComfyWorkflowSource>()
  if (typeof source.convertUiWorkflowToPrompt !== 'function' || typeof source.findPromptTarget !== 'function') throw workflowInvalid('Cherry 工作流源bundle缺失，请重新构建')
  return source
}
const FRONTEND_TYPES = new Set(['Reroute', 'PrimitiveNode', 'Note', 'MarkdownNote'])
type JsonRecord = Record<string, unknown>
type Graph = { nodes: JsonRecord[]; links: JsonRecord[]; inputNode?: JsonRecord; outputNode?: JsonRecord; inputs?: JsonRecord[]; outputs?: JsonRecord[]; id?: string }
function integer(value: unknown, label: string, minimum = 0): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum) throw workflowInvalid(label + ' 无效')
  return number
}
function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || value.some(item => !isComfyRecord(item))) throw workflowInvalid(label + ' 格式无效')
  return value as JsonRecord[]
}
function validateGraph(raw: JsonRecord, label: string): Graph {
  const nodes = records(raw.nodes, label + '节点')
  if (nodes.length > COMFY_MAX_NODES) throw workflowInvalid('工作流节点数量超过5000')
  const nodesById = new Map<number, JsonRecord>()
  for (const node of nodes) {
    node.id = integer(node.id, '节点 ID')
    const id = node.id as number
    if (nodesById.has(id)) throw workflowInvalid('节点 ID 重复：' + id)
    nodesById.set(id, node)
    if (typeof node.type !== 'string' || !node.type || node.type.length > 200) throw workflowInvalid('工作流节点类型无效')
    if (node.mode !== undefined && (typeof node.mode !== 'number' || ![0, 2, 4].includes(node.mode))) throw workflowInvalid('节点模式不受支持')
    if (node.inputs !== undefined) {
      const inputs = records(node.inputs, '节点输入')
      const names = new Set<string>()
      const widgetNames = new Set<string>()
      for (const input of inputs) {
        if (typeof input.name !== 'string' || (!input.name && node.type !== 'Reroute') || names.has(input.name)) throw workflowInvalid('节点输入名称无效或重复')
        names.add(input.name)
        if (input.link !== undefined && input.link !== null) input.link = integer(input.link, '输入连线 ID')
        if (input.widget !== undefined) {
          if (!isComfyRecord(input.widget) || typeof input.widget.name !== 'string' || !input.widget.name || widgetNames.has(input.widget.name)) throw workflowInvalid('节点 widget 名称无效或重复')
          widgetNames.add(input.widget.name)
        }
      }
    }
    if (node.outputs !== undefined) records(node.outputs, '节点输出')
    if (node.widgets_values !== undefined && !Array.isArray(node.widgets_values) && !isComfyRecord(node.widgets_values)) throw workflowInvalid('节点 widget 值无效')
    if (node.widgets_values_named !== undefined && !isComfyRecord(node.widgets_values_named)) throw workflowInvalid('节点命名 widget 值无效')
  }
  if (raw.links !== undefined && !Array.isArray(raw.links)) throw workflowInvalid('工作流连线列表无效')
  const links = (Array.isArray(raw.links) ? raw.links : []).map(item => {
    if (Array.isArray(item)) {
      if (item.length < 5) throw workflowInvalid('连线格式无效')
      item = { id: item[0], origin_id: item[1], origin_slot: item[2], target_id: item[3], target_slot: item[4] }
    }
    if (!isComfyRecord(item)) throw workflowInvalid('连线格式无效')
    return { id: integer(item.id, '连线 ID'), origin_id: integer(item.origin_id, '来源节点 ID', Number.MIN_SAFE_INTEGER), origin_slot: integer(item.origin_slot, '来源输出槽位'), target_id: integer(item.target_id, '目标节点 ID', Number.MIN_SAFE_INTEGER), target_slot: integer(item.target_slot, '目标输入槽位') }
  })
  const inputNode = isComfyRecord(raw.inputNode) ? raw.inputNode : undefined
  const outputNode = isComfyRecord(raw.outputNode) ? raw.outputNode : undefined
  const graphInputs = raw.inputs === undefined ? undefined : records(raw.inputs, '子图输入')
  const graphOutputs = raw.outputs === undefined ? undefined : records(raw.outputs, '子图输出')
  const linksById = new Map<number, typeof links[number]>()
  const destinations = new Set<string>()
  for (const link of links) {
    if (linksById.has(link.id)) throw workflowInvalid('连线 ID 重复')
    linksById.set(link.id, link)
    const origin = nodesById.get(link.origin_id)
    if (!origin && link.origin_id !== inputNode?.id) throw workflowInvalid('连线来源节点不存在：' + link.origin_id)
    if (origin && Array.isArray(origin.outputs) && link.origin_slot >= origin.outputs.length) throw workflowInvalid('来源输出槽位无效')
    if (!origin && graphInputs && link.origin_slot >= graphInputs.length) throw workflowInvalid('子图来源输出槽位无效')
    const target = nodesById.get(link.target_id)
    if (!target && link.target_id !== outputNode?.id) throw workflowInvalid('连线目标节点不存在：' + link.target_id)
    if (target) {
      if (!Array.isArray(target.inputs) || link.target_slot >= target.inputs.length) throw workflowInvalid('目标输入槽位无效')
      const input = target.inputs[link.target_slot] as JsonRecord
      if (input.link !== link.id) throw workflowInvalid('连线与目标输入声明不一致')
    } else if (graphOutputs && link.target_slot >= graphOutputs.length) throw workflowInvalid('子图目标输入槽位无效')
    const destination = link.target_id + ':' + link.target_slot
    if (destinations.has(destination)) throw workflowInvalid('多个连线指向同一输入槽位')
    destinations.add(destination)
  }
  for (const node of nodes) {
    if (!Array.isArray(node.inputs)) continue
    node.inputs.forEach((rawInput, slot) => {
      const input = rawInput as JsonRecord
      if (input.link === undefined || input.link === null) return
      const link = linksById.get(input.link as number)
      if (!link) throw workflowInvalid('输入引用了不存在的连线')
      if (link.target_id !== node.id || link.target_slot !== slot) throw workflowInvalid('连线与目标输入声明不一致')
    })
  }
  // Feed the complete validated graph to the source; only normalize link tuples.
  raw.links = links
  return { nodes, links, inputNode, outputNode, inputs: graphInputs, outputs: graphOutputs, id: typeof raw.id === 'string' ? raw.id : undefined }
}
function validateUiWorkflow(input: unknown): { raw: JsonRecord; graphs: Graph[] } {
  if (!isComfyRecord(input)) throw workflowInvalid('ComfyUI 前端工作流必须是对象')
  assertComfyJsonBudget(input)
  const raw = structuredClone(input)
  const root = validateGraph(raw, '工作流')
  if (!root.nodes.length) throw workflowInvalid('工作流节点数量无效')
  const definitions = isComfyRecord(raw.definitions) ? raw.definitions : undefined
  const subgraphs = definitions?.subgraphs === undefined ? [] : records(definitions.subgraphs, '子图')
  const byId = new Map<string, Graph>()
  for (const definition of subgraphs) {
    if (typeof definition.id !== 'string' || !definition.id || byId.has(definition.id)) throw workflowInvalid('子图 ID 无效或重复')
    byId.set(definition.id, validateGraph(definition, '子图'))
  }
  if ([root, ...byId.values()].reduce((sum, graph) => sum + graph.nodes.length, 0) > COMFY_MAX_NODES) throw workflowInvalid('工作流节点数量超过5000')
  const cache = new Map<string, { count: number; depth: number }>()
  function countGraph(graph: Graph, visiting: Set<string>): { count: number; depth: number } {
    if (visiting.size > 32) throw workflowInvalid('子图嵌套深度超过32层')
    let count = 0; let depth = 0
    for (const node of graph.nodes) {
      const childId = String(node.type)
      const child = byId.get(childId)
      if (!child || node.mode === 2 || node.mode === 4) {
        count++
        if (count > COMFY_MAX_NODES) throw workflowInvalid('工作流展开后节点数量超过5000')
        continue
      }
      if (visiting.has(childId)) throw workflowInvalid('子图定义包含 recursive 循环')
      let size = cache.get(childId)
      if (!size) { const next = new Set(visiting); next.add(childId); size = countGraph(child, next); cache.set(childId, size) }
      count += size.count; depth = Math.max(depth, size.depth + 1)
      if (count > COMFY_MAX_NODES) throw workflowInvalid('工作流展开后节点数量超过5000')
      if (depth > 32) throw workflowInvalid('子图嵌套深度超过32层')
    }
    return { count, depth }
  }
  for (const [id, graph] of byId) if (!cache.has(id)) cache.set(id, countGraph(graph, new Set([id])))
  countGraph(root, new Set())
  return { raw, graphs: [root, ...byId.values()] }
}
function inferredWidgetType(value: unknown): string {
  return typeof value === 'number' ? 'FLOAT' : typeof value === 'boolean' ? 'BOOLEAN' : 'STRING'
}
function infoForLegacySchemas(graphs: Graph[], options: ParseComfyFrontendOptions): ComfyObjectInfo {
  const info: ComfyObjectInfo = {}
  for (const graph of graphs) for (const node of graph.nodes) {
    const className = String(node.type)
    if (FRONTEND_TYPES.has(className)) continue
    const schema = options.schemas?.[className]
    const required: Record<string, unknown> = {}
    if (schema) {
      let previous: string | undefined
      for (const position of schema.positions) {
        if (position === null) {
          if (previous) (required[previous] as [unknown, Record<string, unknown>])[1].control_after_generate = true
        } else { required[position] = ['STRING', {}]; previous = position }
      }
    }
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
    const inputs = Array.isArray(node.inputs) ? node.inputs as JsonRecord[] : []
    const explicit = inputs.filter(slot => isComfyRecord(slot.widget))
    explicit.forEach((slot, index) => {
      const name = (slot.widget as JsonRecord).name as string
      if (!(name in required)) required[name] = [inferredWidgetType(values[index]), {}]
    })
    const named = isComfyRecord(node.widgets_values_named) ? node.widgets_values_named : isComfyRecord(node.widgets_values) ? node.widgets_values : undefined
    for (const [name, value] of Object.entries(named || {})) if (!(name in required)) required[name] = [inferredWidgetType(value), {}]
    if (schema || explicit.length || named) info[className] = { input: { required } }
  }
  return info
}
/** Complete source conversion; Grimoire owns budgets and refuses uncertain mappings. */
export function convertComfyUiWorkflow(input: unknown, options: ParseComfyFrontendOptions = {}): ComfyFrontendParseResult {
  const { raw, graphs } = validateUiWorkflow(input)
  let objectInfo: ComfyObjectInfo
  if (options.objectInfo !== undefined) {
    if (!isComfyRecord(options.objectInfo)) throw workflowInvalid('ComfyUI object_info 节点定义无效')
    assertComfyJsonBudget(options.objectInfo, '节点定义 JSON')
    objectInfo = options.objectInfo as ComfyObjectInfo
  } else objectInfo = infoForLegacySchemas(graphs, options)
  const subgraphIds = new Set(graphs.map(graph => graph.id).filter(Boolean))
  for (const graph of graphs) for (const node of graph.nodes) {
    if (node.mode === 2 || node.mode === 4 || FRONTEND_TYPES.has(String(node.type)) || subgraphIds.has(String(node.type))) continue
    if (!objectInfo[String(node.type)] && (options.objectInfo !== undefined || Array.isArray(node.widgets_values) && node.widgets_values.length || isComfyRecord(node.widgets_values) || isComfyRecord(node.widgets_values_named))) throw workflowInvalid('object_info 缺少节点定义，不能确定 widget 值映射：' + node.type)
  }
  const converted = getComfyWorkflowSource().convertUiWorkflowToPrompt(raw, objectInfo)
  const fatal = converted.warnings.filter(warning => /dangling|outside its scope|circular|unresolved|no input to pass|no value for promoted|does not end at the output|widget values for/.test(warning))
  if (fatal.length) throw workflowInvalid('工作流语义或 widget 值数量/映射不能确定：' + fatal.join('; '))
  const warnings = [...converted.warnings]
  for (const node of Object.values(converted.prompt)) {
    const required = objectInfo[node.class_type]?.input?.required
    for (const name of Object.keys(required || {})) {
      if (!Object.hasOwn(node.inputs, name) || node.inputs[name] === undefined) throw workflowInvalid('工作流缺少必需输入：' + node.class_type + '.' + name)
    }
  }
  for (const graph of graphs) for (const node of graph.nodes) {
    if (node.type === 'Note' || node.type === 'MarkdownNote') warnings.push('已忽略前端注释节点：' + node.type + ' ' + node.id)
    if (Array.isArray(node.widgets_values) && isComfyRecord(node.widgets_values_named)) warnings.push('节点 ' + node.id + ' 使用了命名 widget 值')
  }
  return { workflow: validateComfyApiWorkflow(converted.prompt), warnings: [...new Set(warnings)] }
}


/** Keep every authored seed link while using the source's actual seed selector. */
export function applyComfySourceSeed(graph: ComfyWorkflow, seed: number | undefined, samplerId?: string): void {
  const source = getComfyWorkflowSource()
  const projection = structuredClone(graph)
  for (const node of Object.values(projection)) for (const field of ['seed', 'noise_seed']) {
    let current = node.inputs[field]
    const seen = new Set<string>()
    while (source.isReference(current) && !seen.has(current[0])) {
      seen.add(current[0])
      const producer = graph[current[0]]
      if (!producer) break
      const sourceField = 'seed' in producer.inputs ? 'seed' : 'noise_seed' in producer.inputs ? 'noise_seed' : 'value' in producer.inputs ? 'value' : undefined
      if (!sourceField) break
      const value = producer.inputs[sourceField]
      if (!source.isReference(value)) { node.inputs[field] = current; break }
      current = value
    }
  }
  source.applySeed(projection, seed, samplerId)
  // Source chooses the same terminal scalar on the projected links. Only copy
  // scalar writes back; no authored reference is replaced by the projection.
  for (const [id, node] of Object.entries(projection)) for (const field of ['seed', 'noise_seed', 'value']) {
    if (typeof node.inputs[field] === 'number' && !source.isReference(graph[id].inputs[field]) && node.inputs[field] !== graph[id].inputs[field]) graph[id].inputs[field] = node.inputs[field]
  }
}
export function requireComfyWorkflowHandle(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || value !== value.trim()
    || /[\\%?#:\u0000-\u001f\u007f]/.test(value) || value.startsWith('/')
    || value.split('/').some(part => !part || part === '.' || part === '..')) throw workflowInvalid('远端工作流路径无效或包含路径穿越')
  return value
}

function validateWorkflowListing(value: unknown): void {
  if (!Array.isArray(value)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 远端目录响应必须是列表', false)
  for (const entry of value) {
    if (!isComfyRecord(entry) || typeof entry.name !== 'string' || !entry.name || typeof entry.type !== 'string'
      || (entry.path !== undefined && typeof entry.path !== 'string')) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 远端目录条目无效', false)
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      let file = entry.name
      if (typeof entry.path === 'string') {
        const relative = entry.path.replace(/^\/+/, '')
        if (!relative.startsWith('workflows/')) throw workflowInvalid('工作流不在远端workflows目录')
        file = relative.slice('workflows/'.length)
      } else if (file.includes('/')) throw workflowInvalid('工作流name不是文件名')
      if (!file.endsWith('.json')) throw workflowInvalid('工作流扩展名无效')
      requireComfyWorkflowHandle(file.slice(0, -'.json'.length))
    } catch { throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 远端目录包含无效或越界的工作流路径', false) }
  }
}

/** Direct source discovery with main-owned C2 fetch and stricter path/shape admission. */
export async function discoverComfyWorkflows(endpoint: string, signal?: AbortSignal): Promise<string[]> {
  const fetch = createComfyHttpFetch(endpoint)
  const guardedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (!response.ok) throw new ComfyUIError('COMFY_HTTP_' + response.status, 'ComfyUI 远端目录 HTTP ' + response.status, response.status === 429 || response.status >= 500, response.status)
    validateWorkflowListing(await response.clone().json())
    return response
  }
  try {
    const handles = await getComfyWorkflowSource().listWorkflows(endpoint, signal, { fetch: guardedFetch })
    return [...new Set(handles.map(requireComfyWorkflowHandle))]
  } catch (error) {
    if (signal?.aborted) throw readComfyAbortError()
    if (error instanceof ComfyUIError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ComfyUIError(message.includes('request_timeout') ? 'COMFY_TIMEOUT' : 'COMFY_BAD_RESPONSE', message, message.includes('request_timeout'))
  }
}
