export type ComfyValue = string | number | boolean | null | ComfyValue[] | { [key: string]: ComfyValue }
export type ComfyNode = { class_type: string; inputs: Record<string, ComfyValue>; _meta?: Record<string, ComfyValue> }
export type ComfyWorkflow = Record<string, ComfyNode>
export type ComfyBindingKey = 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'sampler' | 'scheduler' | 'width' | 'height' | 'batch' | 'model' | 'loras'
export interface ComfyBinding { key: ComfyBindingKey; nodeId: string; field: string; label: string; valueType: 'string' | 'number' | 'integer' | 'json'; confidence: 'high' | 'medium' | 'low' }
export interface ComfyWorkflowAnalysis { nodeCount: number; bindings: ComfyBinding[]; unknownNodeTypes: string[]; warnings: string[] }
const MAX_NODES = 2000
const MAX_JSON_LENGTH = 10 * 1024 * 1024

export function parseComfyWorkflow(input: unknown): ComfyWorkflow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ComfyUI 工作流必须是对象')
  const rawWorkflow = input as Record<string, unknown>
  const ids = Object.keys(rawWorkflow)
  if (ids.length === 0 || ids.length > MAX_NODES) throw new Error('ComfyUI 工作流节点数量无效')
  const workflow: ComfyWorkflow = {}
  for (const id of ids) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error('工作流节点 ID 无效')
    const rawNode = rawWorkflow[id]
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) throw new Error('工作流节点格式无效')
    const node = rawNode as Record<string, unknown>
    if (typeof node.class_type !== 'string' || !node.class_type || node.class_type.length > 200) throw new Error('工作流节点类型无效')
    if (!node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) throw new Error('工作流节点输入无效')
    workflow[id] = { class_type: node.class_type, inputs: node.inputs as Record<string, ComfyValue>, _meta: node._meta as Record<string, ComfyValue> | undefined }
  }
  if (JSON.stringify(workflow).length > MAX_JSON_LENGTH) throw new Error('工作流 JSON 过大')
  return workflow
}

function addBinding(bindings: ComfyBinding[], binding: ComfyBinding): void {
  if (!bindings.some(item => item.key === binding.key)) bindings.push(binding)
}

export function analyzeComfyWorkflow(input: unknown): ComfyWorkflowAnalysis {
  const workflow = parseComfyWorkflow(input)
  const bindings: ComfyBinding[] = []
  const unknownNodeTypes = new Set<string>()
  for (const [nodeId, node] of Object.entries(workflow)) {
    const fields = node.inputs
    if (node.class_type === 'CLIPTextEncode' && typeof fields.text === 'string') {
      const title = typeof node._meta?.title === 'string' ? node._meta.title : ''
      const negative = /negative|neg/i.test(title)
      addBinding(bindings, { key: negative ? 'negativePrompt' : 'prompt', nodeId, field: 'text', label: negative ? '负面提示词' : '正面提示词', valueType: 'string', confidence: negative ? 'medium' : 'high' })
    }
    if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
      const samplerFields: Array<[string, ComfyBindingKey, string, 'string' | 'number' | 'integer']> = [['seed', 'seed', '种子', 'integer'], ['steps', 'steps', '步数', 'integer'], ['cfg', 'cfg', 'CFG', 'number'], ['sampler_name', 'sampler', '采样器', 'string'], ['scheduler', 'scheduler', '调度器', 'string']]
      for (const [field, key, label, valueType] of samplerFields) if (fields[field] !== undefined && typeof fields[field] !== 'object') addBinding(bindings, { key, nodeId, field, label, valueType, confidence: 'high' })
    }
    if (node.class_type === 'EmptyLatentImage') {
      const sizeFields: Array<[string, ComfyBindingKey, string]> = [['width', 'width', '宽度'], ['height', 'height', '高度'], ['batch_size', 'batch', '批量']]
      for (const [field, key, label] of sizeFields) if (fields[field] !== undefined) addBinding(bindings, { key, nodeId, field, label, valueType: 'integer', confidence: 'high' })
    }
    if (node.class_type === 'CheckpointLoaderSimple' && typeof fields.ckpt_name === 'string') addBinding(bindings, { key: 'model', nodeId, field: 'ckpt_name', label: 'Checkpoint 模型', valueType: 'string', confidence: 'high' })
    if (node.class_type === 'UNETLoader' && typeof fields.unet_name === 'string') addBinding(bindings, { key: 'model', nodeId, field: 'unet_name', label: 'UNet 模型', valueType: 'string', confidence: 'high' })
    if ((node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly') && typeof fields.lora_name === 'string') addBinding(bindings, { key: 'loras', nodeId, field: 'lora_name', label: 'LoRA', valueType: 'json', confidence: 'medium' })
    if (!['CLIPTextEncode', 'KSampler', 'KSamplerAdvanced', 'EmptyLatentImage', 'CheckpointLoaderSimple', 'UNETLoader', 'LoraLoader', 'LoraLoaderModelOnly', 'VAEDecode', 'VAELoader', 'CLIPLoader', 'SaveImage', 'PreviewImage'].includes(node.class_type)) unknownNodeTypes.add(node.class_type)
  }
  const warnings: string[] = []
  if (unknownNodeTypes.size) warnings.push('存在未识别节点，原始节点会保留但不会自动映射')
  if (!bindings.some(binding => binding.key === 'prompt')) warnings.push('未识别到正面提示词字段')
  return { nodeCount: Object.keys(workflow).length, bindings, unknownNodeTypes: [...unknownNodeTypes].sort(), warnings }
}

export function applyComfyBindings(input: unknown, values: Partial<Record<ComfyBindingKey, ComfyValue>>): ComfyWorkflow {
  const workflow = JSON.parse(JSON.stringify(parseComfyWorkflow(input))) as ComfyWorkflow
  for (const binding of analyzeComfyWorkflow(workflow).bindings) {
    const value = values[binding.key]
    if (value === undefined) continue
    if (binding.valueType === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) throw new Error(binding.key + ' 必须是整数')
    if (binding.valueType === 'number' && typeof value !== 'number') throw new Error(binding.key + ' 必须是数字')
    if (binding.valueType === 'string' && typeof value !== 'string') throw new Error(binding.key + ' 必须是文本')
    workflow[binding.nodeId].inputs[binding.field] = value
  }
  return workflow
}
