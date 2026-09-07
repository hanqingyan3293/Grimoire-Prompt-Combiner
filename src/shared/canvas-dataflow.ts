import { AI_CANVAS_PLUGIN, CORE_CANVAS_PLUGIN } from './canvas-plugin'
import type { CanvasConnection, CanvasDataType, CanvasDocument, CanvasNode, CanvasNodeKind, CanvasPortDefinition } from './canvas-types'

const NODE_PORTS = new Map<string, CanvasPortDefinition>([
  ...CORE_CANVAS_PLUGIN.nodes.flatMap(node => node.ports.map(port => [`${node.kind}:${port.id}` as const, port] as const)),
  ...AI_CANVAS_PLUGIN.nodes.flatMap(node => node.ports.map(port => [`${node.kind}:${port.id}` as const, port] as const)),
] as Array<readonly [string, CanvasPortDefinition]>)

export interface CanvasConnectionResult {
  connection?: CanvasConnection
  error?: string
}

export interface CanvasSyncResult {
  document: CanvasDocument
  changed: boolean
  message: string
}

export interface CanvasPortAnchor { x: number; y: number }

export function toggleCanvasConnectionSelection(current: ReadonlySet<string>, id: string, additive: boolean): Set<string> {
  if (!additive) return new Set([id])
  const next = new Set(current)
  if (next.has(id)) next.delete(id); else next.add(id)
  return next
}

export function getCanvasPort(kind: CanvasNodeKind, portId: string): CanvasPortDefinition | undefined {
  return NODE_PORTS.get(`${kind}:${portId}`)
}

export function getCanvasNodePorts(kind: CanvasNodeKind, direction?: 'input' | 'output'): CanvasPortDefinition[] {
  const manifests = [CORE_CANVAS_PLUGIN, AI_CANVAS_PLUGIN]
  const node = manifests.flatMap(plugin => plugin.nodes).find(item => item.kind === kind)
  return (node?.ports || []).filter(port => !direction || port.direction === direction)
}

export function connectionWouldCreateCycle(document: CanvasDocument, fromNodeId: string, toNodeId: string): boolean {
  const outgoing = new Map<string, string[]>()
  for (const connection of document.connections) {
    const list = outgoing.get(connection.fromNodeId) || []
    list.push(connection.toNodeId)
    outgoing.set(connection.fromNodeId, list)
  }
  const stack = [toNodeId]
  const visited = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === fromNodeId) return true
    if (visited.has(id)) continue
    visited.add(id)
    stack.push(...(outgoing.get(id) || []))
  }
  return false
}

export function createTypedCanvasConnection(document: CanvasDocument, fromNodeId: string, toNodeId: string, id: string, fromPortId?: string, toPortId?: string): CanvasConnectionResult {
  if (fromNodeId === toNodeId) return { error: '不能连接节点自身' }
  const from = document.nodes.find(node => node.id === fromNodeId)
  const to = document.nodes.find(node => node.id === toNodeId)
  if (!from || !to) return { error: '连接端点不存在' }
  const compatible = getCanvasNodePorts(from.kind, 'output').filter(output => !fromPortId || output.id === fromPortId).flatMap(output =>
    getCanvasNodePorts(to.kind, 'input').filter(input => (!toPortId || input.id === toPortId) && input.dataType === output.dataType).map(input => ({ output, input })),
  )
  if (compatible.length === 0) return { error: `${from.title} 与 ${to.title} 没有兼容端口` }
  if (compatible.length > 1) return { error: '存在多个兼容端口，请明确选择端口' }
  const { output, input } = compatible[0]
  if (document.connections.some(connection => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId && connection.fromPort === output.id && connection.toPort === input.id)) return { error: '该端口连接已存在' }
  if (connectionWouldCreateCycle(document, fromNodeId, toNodeId)) return { error: '连接会形成循环，已拒绝' }
  return { connection: { id, fromNodeId, toNodeId, fromPort: output.id, toPort: input.id, dataType: output.dataType } }
}

export function reconnectTypedCanvasConnection(document: CanvasDocument, connectionId: string, toNodeId: string, toPortId?: string): CanvasConnectionResult {
  const existing = document.connections.find(connection => connection.id === connectionId)
  if (!existing?.fromPort || !existing.dataType) return { error: '旧式连接不支持端口重连' }
  const withoutExisting = { ...document, connections: document.connections.filter(connection => connection.id !== connectionId) }
  return createTypedCanvasConnection(withoutExisting, existing.fromNodeId, toNodeId, existing.id, existing.fromPort, toPortId)
}

export function getCanvasPortAnchor(node: CanvasNode, portId: string): CanvasPortAnchor | null {
  const port = getCanvasPort(node.kind, portId)
  if (!port) return null
  const ports = getCanvasNodePorts(node.kind, port.direction)
  const index = ports.findIndex(item => item.id === portId)
  if (index < 0) return null
  const usableHeight = Math.max(24, node.height - 40)
  return {
    x: node.position.x + (port.direction === 'output' ? node.width : 0),
    y: node.position.y + 32 + usableHeight * ((index + 1) / (ports.length + 1)),
  }
}

export function createCanvasConnectionPath(from: CanvasPortAnchor, to: CanvasPortAnchor): string {
  const control = Math.max(56, Math.abs(to.x - from.x) * 0.45)
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`
}

export function validateTypedCanvasConnection(connection: CanvasConnection, nodes: CanvasNode[]): boolean {
  if (!connection.fromPort && !connection.toPort && !connection.dataType) return true
  if (!connection.fromPort || !connection.toPort || !connection.dataType) return false
  const from = nodes.find(node => node.id === connection.fromNodeId)
  const to = nodes.find(node => node.id === connection.toNodeId)
  if (!from || !to) return false
  const output = getCanvasPort(from.kind, connection.fromPort)
  const input = getCanvasPort(to.kind, connection.toPort)
  return output?.direction === 'output' && input?.direction === 'input' && output.dataType === input.dataType && output.dataType === connection.dataType
}

export function patchCanvasNode(document: CanvasDocument, id: string, patch: Partial<CanvasNode>): CanvasDocument {
  return { ...document, nodes: document.nodes.map(node => node.id === id ? { ...node, ...patch } : node) }
}

export function synchronizeCanvasConnection(document: CanvasDocument, connectionId: string, resolveWD14Tags: (node: CanvasNode) => string[] = () => []): CanvasSyncResult {
  const connection = document.connections.find(item => item.id === connectionId)
  if (!connection) return { document, changed: false, message: '连接不存在' }
  if (!connection.dataType || !validateTypedCanvasConnection(connection, document.nodes)) return { document, changed: false, message: '旧式或无效连接不支持数据同步' }
  const from = document.nodes.find(node => node.id === connection.fromNodeId)!
  const to = document.nodes.find(node => node.id === connection.toNodeId)!
  if (connection.dataType === 'prompt') {
    if (!from.content.trim()) return { document, changed: false, message: '上游提示词为空' }
    return { document: patchCanvasNode(document, to.id, { content: from.content }), changed: true, message: `已同步提示词到 ${to.title}，不会自动执行` }
  }
  if (connection.dataType === 'image') {
    const imageId = Number(from.refId)
    if (!Number.isInteger(imageId) || imageId <= 0) return { document, changed: false, message: '上游图片没有有效资源 ID' }
    return { document: patchCanvasNode(document, to.id, { config: { ...to.config, imageId } }), changed: true, message: `已同步图片到 ${to.title}，不会自动执行` }
  }
  const tags = resolveWD14Tags(from)
  if (!tags.length) return { document, changed: false, message: '上游 WD14 节点没有可用标签结果' }
  return { document: patchCanvasNode(document, to.id, { content: tags.join(', '), status: 'idle' }), changed: true, message: `已同步 ${tags.length} 个标签到 ${to.title}，请手动应用` }
}
