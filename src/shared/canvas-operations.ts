import type { CanvasDocument, CanvasNode, CanvasPoint } from './canvas-types'

export type CanvasAlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type CanvasDistributeMode = 'horizontal' | 'vertical'
export interface CanvasRect { left: number; top: number; right: number; bottom: number }
export interface CanvasSnapGuides { x?: number; y?: number }
export interface CanvasSnapResult { nodes: CanvasNode[]; guides: CanvasSnapGuides }

export function normalizeRect(a: CanvasPoint, b: CanvasPoint): CanvasRect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
}

export function selectNodesInRect(nodes: CanvasNode[], rect: CanvasRect): string[] {
  return nodes.filter(node => node.position.x < rect.right && node.position.x + node.width > rect.left && node.position.y < rect.bottom && node.position.y + node.height > rect.top).map(node => node.id)
}

export function expandGroupedSelection(nodes: CanvasNode[], selectedIds: Iterable<string>): Set<string> {
  const selected = new Set(selectedIds)
  const groupIds = new Set(nodes.filter(node => selected.has(node.id) && node.groupId).map(node => node.groupId!))
  for (const node of nodes) if (node.groupId && groupIds.has(node.groupId)) selected.add(node.id)
  return selected
}

export function moveSelectedNodes(nodes: CanvasNode[], selectedIds: Iterable<string>, dx: number, dy: number): CanvasNode[] {
  const selected = expandGroupedSelection(nodes, selectedIds)
  return nodes.map(node => selected.has(node.id) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node)
}

export function moveSelectedNodesWithGuides(nodes: CanvasNode[], selectedIds: Iterable<string>, dx: number, dy: number, threshold = 8): CanvasSnapResult {
  const selected = expandGroupedSelection(nodes, selectedIds)
  const moving = nodes.filter(node => selected.has(node.id))
  const stationary = nodes.filter(node => !selected.has(node.id))
  if (!moving.length || !stationary.length) return { nodes: moveSelectedNodes(nodes, selected, dx, dy), guides: {} }
  const movedBounds = nodeBounds(moving.map(node => ({ ...node, position: { x: node.position.x + dx, y: node.position.y + dy } })))
  const movingX = [movedBounds.left, (movedBounds.left + movedBounds.right) / 2, movedBounds.right]
  const movingY = [movedBounds.top, (movedBounds.top + movedBounds.bottom) / 2, movedBounds.bottom]
  const targetX = stationary.flatMap(node => [node.position.x, node.position.x + node.width / 2, node.position.x + node.width])
  const targetY = stationary.flatMap(node => [node.position.y, node.position.y + node.height / 2, node.position.y + node.height])
  const snapX = closestSnap(movingX, targetX, threshold)
  const snapY = closestSnap(movingY, targetY, threshold)
  return {
    nodes: moveSelectedNodes(nodes, selected, dx + (snapX?.offset || 0), dy + (snapY?.offset || 0)),
    guides: { x: snapX?.target, y: snapY?.target },
  }
}

export function resizeCanvasNode(nodes: CanvasNode[], nodeId: string, width: number, height: number): CanvasNode[] {
  const nextWidth = Math.max(120, Math.min(4000, width))
  const nextHeight = Math.max(80, Math.min(4000, height))
  return nodes.map(node => node.id === nodeId ? { ...node, width: nextWidth, height: nextHeight } : node)
}

export function deleteCanvasConnection(document: CanvasDocument, connectionId: string): CanvasDocument {
  return { ...document, connections: document.connections.filter(connection => connection.id !== connectionId) }
}

export function deleteCanvasConnections(document: CanvasDocument, connectionIds: ReadonlySet<string>): CanvasDocument {
  if (connectionIds.size === 0) return document
  return { ...document, connections: document.connections.filter(connection => !connectionIds.has(connection.id)) }
}

export function renameCanvasGroup(document: CanvasDocument, groupId: string, title: string): CanvasDocument {
  const nextTitle = title.trim().slice(0, 200)
  if (!nextTitle) return document
  return { ...document, groups: (document.groups || []).map(group => group.id === groupId ? { ...group, title: nextTitle } : group) }
}

export function alignSelectedNodes(nodes: CanvasNode[], selectedIds: Iterable<string>, mode: CanvasAlignMode): CanvasNode[] {
  const ids = new Set(selectedIds)
  const selected = nodes.filter(node => ids.has(node.id))
  if (selected.length < 2) return nodes
  const bounds = nodeBounds(selected)
  return nodes.map(node => {
    if (!ids.has(node.id)) return node
    const position = { ...node.position }
    if (mode === 'left') position.x = bounds.left
    if (mode === 'center') position.x = (bounds.left + bounds.right - node.width) / 2
    if (mode === 'right') position.x = bounds.right - node.width
    if (mode === 'top') position.y = bounds.top
    if (mode === 'middle') position.y = (bounds.top + bounds.bottom - node.height) / 2
    if (mode === 'bottom') position.y = bounds.bottom - node.height
    return { ...node, position }
  })
}

export function distributeSelectedNodes(nodes: CanvasNode[], selectedIds: Iterable<string>, mode: CanvasDistributeMode): CanvasNode[] {
  const ids = new Set(selectedIds)
  const selected = nodes.filter(node => ids.has(node.id)).sort((a, b) => mode === 'horizontal' ? a.position.x - b.position.x : a.position.y - b.position.y)
  if (selected.length < 3) return nodes
  const first = selected[0]
  const last = selected[selected.length - 1]
  const firstCenter = mode === 'horizontal' ? first.position.x + first.width / 2 : first.position.y + first.height / 2
  const lastCenter = mode === 'horizontal' ? last.position.x + last.width / 2 : last.position.y + last.height / 2
  const step = (lastCenter - firstCenter) / (selected.length - 1)
  const centers = new Map(selected.map((node, index) => [node.id, firstCenter + step * index]))
  return nodes.map(node => {
    const center = centers.get(node.id)
    if (center === undefined) return node
    return mode === 'horizontal' ? { ...node, position: { ...node.position, x: center - node.width / 2 } } : { ...node, position: { ...node.position, y: center - node.height / 2 } }
  })
}

export function snapSelectedNodes(nodes: CanvasNode[], selectedIds: Iterable<string>, gridSize = 24): CanvasNode[] {
  const ids = new Set(selectedIds)
  return nodes.map(node => ids.has(node.id) ? { ...node, position: { x: Math.round(node.position.x / gridSize) * gridSize, y: Math.round(node.position.y / gridSize) * gridSize } } : node)
}

export function groupSelectedNodes(document: CanvasDocument, selectedIds: Iterable<string>, groupId: string, title = '分组'): CanvasDocument {
  const ids = new Set(selectedIds)
  if (ids.size < 2) return document
  return { ...document, groups: [...(document.groups || []), { id: groupId, title }], nodes: document.nodes.map(node => ids.has(node.id) ? { ...node, groupId } : node) }
}

export function ungroupSelectedNodes(document: CanvasDocument, selectedIds: Iterable<string>): CanvasDocument {
  const ids = new Set(selectedIds)
  const groupIds = new Set(document.nodes.filter(node => ids.has(node.id) && node.groupId).map(node => node.groupId!))
  if (!groupIds.size) return document
  return { ...document, groups: (document.groups || []).filter(group => !groupIds.has(group.id)), nodes: document.nodes.map(node => node.groupId && groupIds.has(node.groupId) ? { ...node, groupId: undefined } : node) }
}

export function groupBounds(nodes: CanvasNode[], groupId: string, padding = 24): CanvasRect | null {
  const members = nodes.filter(node => node.groupId === groupId)
  if (!members.length) return null
  const bounds = nodeBounds(members)
  return { left: bounds.left - padding, top: bounds.top - padding - 24, right: bounds.right + padding, bottom: bounds.bottom + padding }
}

function nodeBounds(nodes: CanvasNode[]): CanvasRect {
  return { left: Math.min(...nodes.map(node => node.position.x)), top: Math.min(...nodes.map(node => node.position.y)), right: Math.max(...nodes.map(node => node.position.x + node.width)), bottom: Math.max(...nodes.map(node => node.position.y + node.height)) }
}

function closestSnap(source: number[], targets: number[], threshold: number): { offset: number; target: number } | null {
  let best: { offset: number; target: number } | null = null
  for (const value of source) for (const target of targets) {
    const offset = target - value
    if (Math.abs(offset) > threshold || (best && Math.abs(best.offset) <= Math.abs(offset))) continue
    best = { offset, target }
  }
  return best
}
