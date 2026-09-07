import type { CanvasDataType, CanvasNodeKind, CanvasPortDefinition } from './canvas-types'

export const CANVAS_PLUGIN_API_VERSION = 1 as const

export type CanvasPluginCapability =
  | 'images.read'
  | 'tasks.read'
  | 'prompt.apply'
  | 'promptAssets.read'
  | 'wd14.createTask'
  | 'wd14.applyResult'
  | 'comfyui.createTask'
  | 'comfyui.importResult'

export interface CanvasPluginNodeContribution {
  kind: CanvasNodeKind
  title: string
  description: string
  defaultSize: { width: number; height: number }
  minimapColor: string
  creatable: boolean
  capabilities: CanvasPluginCapability[]
  ports: CanvasPortDefinition[]
}

export interface CanvasPluginManifest {
  apiVersion: typeof CANVAS_PLUGIN_API_VERSION
  id: string
  name: string
  version: string
  builtin: true
  capabilities: CanvasPluginCapability[]
  nodes: CanvasPluginNodeContribution[]
}

const CAPABILITIES = new Set<CanvasPluginCapability>([
  'images.read', 'tasks.read', 'prompt.apply', 'promptAssets.read',
  'wd14.createTask', 'wd14.applyResult', 'comfyui.createTask', 'comfyui.importResult',
])

const NODE_KINDS = new Set<CanvasNodeKind>(['text', 'image', 'prompt', 'task', 'prompt-asset', 'wd14', 'comfyui'])
const DATA_TYPES = new Set<CanvasDataType>(['prompt', 'image', 'tags'])

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' 无效')
  return value.trim()
}

function capabilities(value: unknown, field: string): CanvasPluginCapability[] {
  if (!Array.isArray(value) || value.some(item => !CAPABILITIES.has(item as CanvasPluginCapability))) throw new Error(field + ' 包含未授权能力')
  return [...new Set(value as CanvasPluginCapability[])]
}

export function validateCanvasPluginManifest(value: unknown): CanvasPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('画布插件清单无效')
  const input = value as Record<string, unknown>
  if (input.apiVersion !== CANVAS_PLUGIN_API_VERSION) throw new Error('画布插件 API 版本不兼容')
  if (input.builtin !== true) throw new Error('仅允许内置静态画布插件')
  const id = text(input.id, '插件 ID', 100)
  if (!/^[a-z][a-z0-9.-]+$/.test(id)) throw new Error('插件 ID 格式无效')
  const allowed = capabilities(input.capabilities, '插件能力')
  if (!Array.isArray(input.nodes) || input.nodes.length === 0 || input.nodes.length > 50) throw new Error('插件节点列表无效')
  const kinds = new Set<CanvasNodeKind>()
  const nodes = input.nodes.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`插件节点 ${index + 1} 无效`)
    const node = raw as Record<string, unknown>
    if (!NODE_KINDS.has(node.kind as CanvasNodeKind) || kinds.has(node.kind as CanvasNodeKind)) throw new Error('插件节点类型无效或重复')
    const nodeCapabilities = capabilities(node.capabilities, '节点能力')
    if (nodeCapabilities.some(capability => !allowed.includes(capability))) throw new Error('节点申请了插件未声明的能力')
    const size = node.defaultSize as Record<string, unknown> | undefined
    const width = Number(size?.width)
    const height = Number(size?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 120 || width > 1200 || height < 80 || height > 1000) throw new Error('插件节点默认尺寸无效')
    const minimapColor = text(node.minimapColor, '小地图颜色', 20)
    if (!/^#[0-9a-f]{6}$/i.test(minimapColor)) throw new Error('小地图颜色无效')
    const kind = node.kind as CanvasNodeKind
    if (!Array.isArray(node.ports) || node.ports.length > 20) throw new Error('插件节点端口无效')
    const portIds = new Set<string>()
    const ports = node.ports.map(rawPort => {
      if (!rawPort || typeof rawPort !== 'object' || Array.isArray(rawPort)) throw new Error('插件节点端口无效')
      const port = rawPort as Record<string, unknown>
      const portId = text(port.id, '端口 ID', 100)
      if (!/^[a-z][a-z0-9.-]+$/.test(portId) || portIds.has(portId)) throw new Error('端口 ID 无效或重复')
      if (port.direction !== 'input' && port.direction !== 'output') throw new Error('端口方向无效')
      if (!DATA_TYPES.has(port.dataType as CanvasDataType)) throw new Error('端口数据类型无效')
      portIds.add(portId)
      return { id: portId, label: text(port.label, '端口名称', 100), direction: port.direction as 'input' | 'output', dataType: port.dataType as CanvasDataType }
    })
    kinds.add(kind)
    return { kind, title: text(node.title, '节点标题', 100), description: text(node.description, '节点描述', 300), defaultSize: { width, height }, minimapColor, creatable: node.creatable === true, capabilities: nodeCapabilities, ports }
  })
  return { apiVersion: CANVAS_PLUGIN_API_VERSION, id, name: text(input.name, '插件名称', 100), version: text(input.version, '插件版本', 40), builtin: true, capabilities: allowed, nodes }
}

export const CORE_CANVAS_PLUGIN: CanvasPluginManifest = {
  apiVersion: 1, id: 'grimoire.core', name: '魔导书核心节点', version: '1.0.0', builtin: true,
  capabilities: ['images.read', 'tasks.read', 'prompt.apply'],
  nodes: [
    { kind: 'text', title: '文本', description: '自由文本和备注', defaultSize: { width: 260, height: 150 }, minimapColor: '#64748b', creatable: true, capabilities: [], ports: [] },
    { kind: 'image', title: '图片', description: '资源库图片引用', defaultSize: { width: 280, height: 190 }, minimapColor: '#0ea5e9', creatable: true, capabilities: ['images.read'], ports: [{ id: 'image', label: '图片', direction: 'output', dataType: 'image' }] },
    { kind: 'prompt', title: '提示词', description: '可回写提示词工作区', defaultSize: { width: 320, height: 210 }, minimapColor: '#a855f7', creatable: true, capabilities: ['prompt.apply'], ports: [{ id: 'tags', label: '标签', direction: 'input', dataType: 'tags' }, { id: 'prompt', label: '提示词', direction: 'output', dataType: 'prompt' }] },
    { kind: 'task', title: '任务', description: '通用任务状态快照', defaultSize: { width: 280, height: 150 }, minimapColor: '#22c55e', creatable: true, capabilities: ['tasks.read'], ports: [] },
  ],
}

export const AI_CANVAS_PLUGIN: CanvasPluginManifest = {
  apiVersion: 1, id: 'grimoire.ai-workflows', name: '魔导书 AI 工作流节点', version: '1.0.0', builtin: true,
  capabilities: ['images.read', 'tasks.read', 'prompt.apply', 'promptAssets.read', 'wd14.createTask', 'wd14.applyResult', 'comfyui.createTask', 'comfyui.importResult'],
  nodes: [
    { kind: 'prompt-asset', title: '提示词资产', description: '绑定统一提示词资产并应用', defaultSize: { width: 340, height: 220 }, minimapColor: '#eab308', creatable: true, capabilities: ['promptAssets.read', 'prompt.apply'], ports: [{ id: 'prompt', label: '提示词', direction: 'output', dataType: 'prompt' }] },
    { kind: 'wd14', title: 'WD14 反推', description: '从图片创建本地反推任务', defaultSize: { width: 320, height: 230 }, minimapColor: '#ec4899', creatable: true, capabilities: ['images.read', 'tasks.read', 'wd14.createTask', 'wd14.applyResult'], ports: [{ id: 'image', label: '图片', direction: 'input', dataType: 'image' }, { id: 'tags', label: '标签', direction: 'output', dataType: 'tags' }] },
    { kind: 'comfyui', title: 'ComfyUI 生成', description: '从导入工作流创建生成任务', defaultSize: { width: 340, height: 250 }, minimapColor: '#f97316', creatable: true, capabilities: ['tasks.read', 'comfyui.createTask', 'comfyui.importResult'], ports: [{ id: 'prompt', label: '提示词', direction: 'input', dataType: 'prompt' }] },
  ],
}
