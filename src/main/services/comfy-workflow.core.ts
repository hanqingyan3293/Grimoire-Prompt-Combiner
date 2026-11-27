import { getComfyWorkflowSource, convertComfyUiWorkflow, applyComfySourceSeed } from '../../integrations/cherry/comfy-workflow-adapter'
import { isComfyRecord as isRecord, validateComfyApiWorkflow } from './comfy-workflow-validation'
import type { ComfyNode, ComfyValue, ComfyWorkflow, ParseComfyFrontendOptions, ComfyFrontendParseResult } from '../../shared/comfy-workflow-types'
export type { ComfyNode, ComfyValue, ComfyWorkflow, ComfyFrontendWidgetSchema, ComfyFrontendWidgetSchemas, ParseComfyFrontendOptions, ComfyFrontendParseResult } from '../../shared/comfy-workflow-types'
export type ComfyBindingKey = 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'sampler' | 'scheduler' | 'width' | 'height' | 'batch' | 'model' | 'loras'
export interface ComfyBinding { key: ComfyBindingKey; nodeId: string; field: string; label: string; valueType: 'string' | 'number' | 'integer' | 'json'; confidence: 'high' | 'medium' | 'low' }
export interface ComfyWorkflowAnalysis { nodeCount: number; bindings: ComfyBinding[]; unknownNodeTypes: string[]; warnings: string[] }
const KNOWN_NODE_TYPES = new Set([
  'CLIPTextEncode', 'KSampler', 'KSamplerAdvanced', 'EmptyLatentImage', 'CheckpointLoaderSimple',
  'UNETLoader', 'LoraLoader', 'LoraLoaderModelOnly', 'VAEDecode', 'VAELoader', 'CLIPLoader', 'SaveImage', 'PreviewImage',
])

export function parseComfyWorkflow(input: unknown): ComfyWorkflow { return validateComfyApiWorkflow(input) }

function addBinding(bindings: ComfyBinding[], binding: ComfyBinding): void {
  if (!bindings.some(item => item.key === binding.key)) bindings.push(binding)
}

function textBinding(workflow: ComfyWorkflow, negative: boolean): { nodeId: string; input: string; samplerId: string } | undefined {
  const source = getComfyWorkflowSource()
  const target = source.findPromptTarget(workflow)
  if (!negative || !target) return target
  const originalSampler = workflow[target.samplerId]
  const originalScope = source.isReference(originalSampler.inputs.guider) ? workflow[originalSampler.inputs.guider[0]]?.inputs : originalSampler.inputs
  if (!originalScope || !source.isReference(originalScope.negative)) {
    const input = ['negative_prompt', 'negativePrompt'].find(name => typeof originalSampler.inputs[name] === 'string')
    return input ? { nodeId: target.samplerId, samplerId: target.samplerId, input } : undefined
  }
  const projection = structuredClone(workflow)
  const negativeStart = originalScope.negative
  // The source traverses conditioning inputs. Project dual output1 through
  // the declared negative stream before asking that same traversal to locate
  // its text; preserve the original graph and every authored reference.
  const queue: Array<[string, number]> = [negativeStart]
  const seen = new Set<string>()
  const selectedOutputs = new Map<string, number>()
  while (queue.length) {
    const ref = queue.shift()!
    const key = ref[0] + ':' + ref[1]
    if (seen.has(key)) continue
    seen.add(key)
    const original = workflow[ref[0]]
    const node = projection[ref[0]]
    if (!original || !node) continue
    if (source.isReference(original.inputs.positive) && source.isReference(original.inputs.negative)) {
      const previous = selectedOutputs.get(ref[0])
      if (previous !== undefined && previous !== ref[1]) return undefined
      selectedOutputs.set(ref[0], ref[1])
      node.inputs.positive = ref[1] === 1 ? original.inputs.negative : original.inputs.positive
      delete node.inputs.negative
    }
    const selectedBranch = typeof node.inputs.switch === 'boolean' ? node.inputs.switch ? 'on_true' : 'on_false' : undefined
    if (selectedBranch && Object.hasOwn(node.inputs, selectedBranch)) {
      const value = node.inputs[selectedBranch]
      if (source.isReference(value)) queue.push(value)
    } else {
      for (const [name, value] of Object.entries(node.inputs)) if (name !== 'negative' && source.isReference(value)) queue.push(value)
    }
  }
  for (const [id, node] of Object.entries(projection)) {
    if (id === target.samplerId) continue
    if ('seed' in node.inputs || 'noise_seed' in node.inputs || 'latent_image' in node.inputs || source.isReference(node.inputs.guider)) {
      delete node.inputs.positive; delete node.inputs.guider
    }
  }
  projection[target.samplerId] = { class_type: 'KSampler', inputs: { seed: 0, positive: negativeStart }, _meta: { title: 'negative target projection' } }
  return source.findPromptTarget(projection)
}

function seedBinding(workflow: ComfyWorkflow, samplerId?: string): { nodeId: string; field: string } | undefined {
  const source = getComfyWorkflowSource()
  const probe = structuredClone(workflow)
  const marker = Number.MIN_SAFE_INTEGER
  applyComfySourceSeed(probe, marker, samplerId)
  for (const [nodeId, node] of Object.entries(probe)) {
    for (const field of ['seed', 'noise_seed', 'value']) {
      if (node.inputs[field] === marker && workflow[nodeId].inputs[field] !== marker) return { nodeId, field }
    }
  }
  return undefined
}

export function analyzeComfyWorkflow(input: unknown): ComfyWorkflowAnalysis {
  const workflow = parseComfyWorkflow(input)
  const bindings: ComfyBinding[] = []
  const unknownNodeTypes = new Set<string>()
  const positive = textBinding(workflow, false)
  const negativeCandidate = textBinding(workflow, true)
  const sharedText = Boolean(positive && negativeCandidate && positive.nodeId === negativeCandidate.nodeId && positive.input === negativeCandidate.input)
  const negative = sharedText ? undefined : negativeCandidate
  for (const [target, key, label] of [[positive, 'prompt', '正面提示词'], [negative, 'negativePrompt', '负面提示词']] as const) {
    if (target) addBinding(bindings, { key, nodeId: target.nodeId, field: target.input, label, valueType: 'string', confidence: 'high' })
  }
  const seed = seedBinding(workflow, positive?.samplerId)
  if (seed) addBinding(bindings, { key: 'seed', ...seed, label: '种子', valueType: 'integer', confidence: 'high' })
  for (const [nodeId, node] of Object.entries(workflow)) {
    const fields = node.inputs
    if (!positive && node.class_type === 'CLIPTextEncode' && typeof fields.text === 'string') {
      const title = typeof node._meta?.title === 'string' ? node._meta.title : ''
      const isNegative = /negative|neg/i.test(title)
      addBinding(bindings, { key: isNegative ? 'negativePrompt' : 'prompt', nodeId, field: 'text', label: isNegative ? '负面提示词' : '正面提示词', valueType: 'string', confidence: 'low' })
    }
    if (nodeId === positive?.samplerId || node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
      const samplerFields: Array<[string, ComfyBindingKey, string, 'string' | 'number' | 'integer']> = [['steps', 'steps', '步数', 'integer'], ['cfg', 'cfg', 'CFG', 'number'], ['sampler_name', 'sampler', '采样器', 'string'], ['scheduler', 'scheduler', '调度器', 'string']]
      for (const [field, key, label, valueType] of samplerFields) if (fields[field] !== undefined && typeof fields[field] !== 'object') addBinding(bindings, { key, nodeId, field, label, valueType, confidence: 'high' })
    }
    if (node.class_type === 'EmptyLatentImage') {
      const sizeFields: Array<[string, ComfyBindingKey, string]> = [['width', 'width', '宽度'], ['height', 'height', '高度'], ['batch_size', 'batch', '批量']]
      for (const [field, key, label] of sizeFields) if (fields[field] !== undefined) addBinding(bindings, { key, nodeId, field, label, valueType: 'integer', confidence: 'high' })
    }
    if (node.class_type === 'CheckpointLoaderSimple' && typeof fields.ckpt_name === 'string') addBinding(bindings, { key: 'model', nodeId, field: 'ckpt_name', label: 'Checkpoint 模型', valueType: 'string', confidence: 'high' })
    if (node.class_type === 'UNETLoader' && typeof fields.unet_name === 'string') addBinding(bindings, { key: 'model', nodeId, field: 'unet_name', label: 'UNet 模型', valueType: 'string', confidence: 'high' })
    if ((node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly') && typeof fields.lora_name === 'string') addBinding(bindings, { key: 'loras', nodeId, field: 'lora_name', label: 'LoRA', valueType: 'json', confidence: 'medium' })
    if (!KNOWN_NODE_TYPES.has(node.class_type)) unknownNodeTypes.add(node.class_type)
  }
  const warnings: string[] = []
  if (sharedText) warnings.push('正负提示词共用同一输入，负面提示词不能独立映射')
  if (unknownNodeTypes.size) warnings.push('存在未识别节点，原始节点会保留但不会自动映射')
  if (!bindings.some(binding => binding.key === 'prompt')) warnings.push('未识别到正面提示词字段')
  return { nodeCount: Object.keys(workflow).length, bindings, unknownNodeTypes: [...unknownNodeTypes].sort(), warnings }
}

export function applyComfyBindings(input: unknown, values: Partial<Record<ComfyBindingKey, ComfyValue>>): ComfyWorkflow {
  const workflow = structuredClone(parseComfyWorkflow(input))
  for (const binding of analyzeComfyWorkflow(workflow).bindings) {
    const value = values[binding.key]
    if (value === undefined) continue
    if (binding.valueType === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) throw new Error(binding.key + ' 必须是整数')
    if (binding.valueType === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(binding.key + ' 必须是数字')
    if (binding.valueType === 'string' && typeof value !== 'string') throw new Error(binding.key + ' 必须是文本')
    if (binding.key !== 'seed') workflow[binding.nodeId].inputs[binding.field] = value
  }
  if (values.seed !== undefined) {
    if (typeof values.seed !== 'number' || !Number.isSafeInteger(values.seed)) throw new Error('seed 必须是整数')
    const source = getComfyWorkflowSource()
    applyComfySourceSeed(workflow, values.seed, source.findPromptTarget(workflow)?.samplerId)
  }
  return parseComfyWorkflow(workflow)
}

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'])
const NON_SCALAR_WIDGET_TYPES = new Set(['COLOR', 'COLORS', 'RANGE'])
const UNSUPPORTED_WIDGET_TYPES = new Set(['CURVE', 'COMFY_DYNAMICCOMBO_V3'])
import type { ComfyFrontendWidgetSchema, ComfyFrontendWidgetSchemas } from '../../shared/comfy-workflow-types'
function widgetPositionsFromInfo(info: Record<string, unknown>, includeAdvanced: boolean): Array<string | null> | null {
  const input = isRecord(info.input) ? info.input : {}
  const order = isRecord(info.input_order) ? info.input_order : {}
  const positions: Array<string | null> = []
  for (const section of ['required', 'optional'] as const) {
    const spec = isRecord(input[section]) ? input[section] : {}
    const declared = Array.isArray(order[section]) ? order[section].filter((name): name is string => typeof name === 'string' && name in spec) : []
    const names = declared.length > 0 ? declared : Object.keys(spec)
    for (const name of names) {
      const entry = spec[name]
      if (!Array.isArray(entry) || entry.length === 0) continue
      const type = entry[0]
      const config = entry.length > 1 && isRecord(entry[1]) ? entry[1] : {}
      if (config.advanced === true && !includeAdvanced) continue
      if (config.forceInput === true) continue
      const widgetType = typeof config.widgetType === 'string'
        ? config.widgetType
        : Array.isArray(type)
          ? 'COMBO'
          : typeof type === 'string' ? type : ''
      if (UNSUPPORTED_WIDGET_TYPES.has(widgetType)) return null
      const isWidget = typeof config.widgetType === 'string' || WIDGET_TYPES.has(widgetType) || NON_SCALAR_WIDGET_TYPES.has(widgetType)
      if (!isWidget) continue
      positions.push(name)
      if (config.control_after_generate === true) positions.push(null)
    }
  }
  return positions
}

/** Build positional widget schemas from a ComfyUI /object_info payload. */
export function buildComfyWidgetSchemas(objectInfo: unknown): ComfyFrontendWidgetSchemas {
  if (!isRecord(objectInfo)) throw new Error('ComfyUI 节点定义无效')
  const schemas: ComfyFrontendWidgetSchemas = {}
  for (const [className, info] of Object.entries(objectInfo)) {
    if (!isRecord(info)) continue
    const positions = widgetPositionsFromInfo(info, false)
    if (!positions) continue
    const advancedPositions = widgetPositionsFromInfo(info, true)
    const schema: ComfyFrontendWidgetSchema = { positions }
    if (advancedPositions && JSON.stringify(advancedPositions) !== JSON.stringify(positions)) schema.advancedPositions = advancedPositions
    schemas[className] = schema
  }
  return schemas
}

export function isComfyFrontendWorkflow(input: unknown): boolean {
  return isRecord(input) && Array.isArray(input.nodes)
}

/** Compatibility entry; complete raw UI graphs are passed to the actual source. */
export function parseComfyFrontendWorkflow(input: unknown, options: ParseComfyFrontendOptions = {}): ComfyFrontendParseResult {
  return convertComfyUiWorkflow(input, options)
}
