import type { CanvasDocument, CanvasNodeKind } from './canvas-types'
import { connectionWouldCreateCycle, validateTypedCanvasConnection } from './canvas-dataflow'

const NODE_KINDS = new Set<CanvasNodeKind>(['text', 'image', 'prompt', 'task', 'prompt-asset', 'wd14', 'comfyui'])

function sanitizeConfig(kind: CanvasNodeKind, value: unknown) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  if (kind === 'prompt-asset') return typeof config.assetId === 'string' && config.assetId.length <= 300 ? { assetId: config.assetId } : undefined
  if (kind === 'wd14') {
    const imageId = Number(config.imageId)
    const threshold = Number(config.threshold)
    return {
      ...(Number.isInteger(imageId) && imageId > 0 ? { imageId } : {}),
      ...(typeof config.modelId === 'string' && config.modelId.length <= 200 ? { modelId: config.modelId } : {}),
      ...(Number.isFinite(threshold) && threshold >= 0.01 && threshold <= 0.99 ? { threshold } : { threshold: 0.35 }),
    }
  }
  if (kind === 'comfyui') return typeof config.workflowId === 'string' && config.workflowId.length <= 200 ? { workflowId: config.workflowId } : undefined
  return undefined
}

export function validateCanvasDocument(document: CanvasDocument): CanvasDocument {
  if (!document || document.version !== 1 || !document.viewport || !Array.isArray(document.nodes) || !Array.isArray(document.connections)) throw new Error('画布文档格式无效')
  if (document.nodes.length > 2000 || document.connections.length > 5000) throw new Error('画布对象数量超过限制')
  const nodeIds = new Set<string>()
  const groupIds = new Set<string>()
  const groups = (Array.isArray(document.groups) ? document.groups : []).map(group => {
    if (!group || typeof group.id !== 'string' || !group.id || groupIds.has(group.id)) throw new Error('画布分组 ID 无效或重复')
    groupIds.add(group.id)
    return { id: group.id, title: String(group.title || '分组').slice(0, 200) }
  })
  const nodes = document.nodes.map(node => {
    if (!node || typeof node.id !== 'string' || !node.id || nodeIds.has(node.id)) throw new Error('画布节点 ID 无效或重复')
    if (!NODE_KINDS.has(node.kind)) throw new Error('画布节点类型无效')
    nodeIds.add(node.id)
    return {
      ...node,
      title: String(node.title || '').slice(0, 500),
      content: String(node.content || '').slice(0, 200_000),
      width: Math.max(120, Math.min(4000, Number(node.width) || 340)),
      height: Math.max(80, Math.min(4000, Number(node.height) || 240)),
      position: { x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0 },
      groupId: node.groupId && groupIds.has(node.groupId) ? node.groupId : undefined,
      config: sanitizeConfig(node.kind, node.config),
    }
  })
  const connectionIds = new Set<string>()
  const acceptedConnections: typeof document.connections = []
  const connections = document.connections.map(connection => {
    if (!connection || typeof connection.id !== 'string' || !connection.id || connectionIds.has(connection.id)) throw new Error('画布连接 ID 无效或重复')
    if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId) || connection.fromNodeId === connection.toNodeId) throw new Error('画布连接端点无效')
    if (!validateTypedCanvasConnection(connection, nodes)) throw new Error('画布连接端口或数据类型无效')
    if (connection.dataType && connectionWouldCreateCycle({ ...document, nodes, connections: acceptedConnections }, connection.fromNodeId, connection.toNodeId)) throw new Error('画布连接不能形成循环')
    connectionIds.add(connection.id)
    const accepted = { id: connection.id, fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId, fromPort: connection.fromPort, toPort: connection.toPort, dataType: connection.dataType }
    acceptedConnections.push(accepted)
    return accepted
  })
  return { version: 1, viewport: { x: Number(document.viewport.x) || 0, y: Number(document.viewport.y) || 0, scale: Math.max(0.05, Math.min(5, Number(document.viewport.scale) || 1)) }, nodes, connections, groups }
}
