import { describe, expect, it } from 'vitest'
import type { CanvasDocument, CanvasNode } from './canvas-types'
import { alignSelectedNodes, deleteCanvasConnection, deleteCanvasConnections, distributeSelectedNodes, groupBounds, groupSelectedNodes, moveSelectedNodes, moveSelectedNodesWithGuides, normalizeRect, renameCanvasGroup, resizeCanvasNode, selectNodesInRect, snapSelectedNodes, ungroupSelectedNodes } from './canvas-operations'

const nodes: CanvasNode[] = [
  { id: 'a', kind: 'text', title: 'A', content: '', position: { x: 13, y: 17 }, width: 100, height: 80 },
  { id: 'b', kind: 'text', title: 'B', content: '', position: { x: 180, y: 100 }, width: 120, height: 60 },
  { id: 'c', kind: 'text', title: 'C', content: '', position: { x: 420, y: 220 }, width: 80, height: 100 },
]

describe('canvas operations', () => {
  it('normalizes marquee rectangles and selects intersecting nodes', () => {
    const rect = normalizeRect({ x: 250, y: 180 }, { x: 0, y: 0 })
    expect(rect).toEqual({ left: 0, top: 0, right: 250, bottom: 180 })
    expect(selectNodesInRect(nodes, rect)).toEqual(['a', 'b'])
  })

  it('moves group members together and aligns selected nodes', () => {
    const grouped = nodes.map(node => node.id === 'a' || node.id === 'b' ? { ...node, groupId: 'g' } : node)
    const moved = moveSelectedNodes(grouped, ['a'], 10, 20)
    expect(moved.map(node => node.position)).toEqual([{ x: 23, y: 37 }, { x: 190, y: 120 }, { x: 420, y: 220 }])
    const aligned = alignSelectedNodes(nodes, ['a', 'b'], 'left')
    expect(aligned[0].position.x).toBe(13)
    expect(aligned[1].position.x).toBe(13)
  })

  it('distributes centers and snaps selected nodes to the grid', () => {
    const distributed = distributeSelectedNodes(nodes, ['a', 'b', 'c'], 'horizontal')
    const centers = distributed.map(node => node.position.x + node.width / 2)
    expect(centers[1]).toBe((centers[0] + centers[2]) / 2)
    expect(snapSelectedNodes(nodes, ['a'], 24)[0].position).toEqual({ x: 24, y: 24 })
  })

  it('groups, measures, and ungroups selected nodes', () => {
    const document: CanvasDocument = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes, connections: [] }
    const grouped = groupSelectedNodes(document, ['a', 'b'], 'group-1', '构图')
    expect(grouped.groups).toEqual([{ id: 'group-1', title: '构图' }])
    expect(groupBounds(grouped.nodes, 'group-1')).toEqual({ left: -11, top: -31, right: 324, bottom: 184 })
    const ungrouped = ungroupSelectedNodes(grouped, ['a'])
    expect(ungrouped.groups).toEqual([])
    expect(ungrouped.nodes.every(node => !node.groupId)).toBe(true)
  })

  it('snaps moved nodes to nearby node centers and reports guides', () => {
    const source = [
      { ...nodes[0], position: { x: 0, y: 0 } },
      { ...nodes[1], position: { x: 205, y: 4 }, width: 100, height: 80 },
    ]
    const result = moveSelectedNodesWithGuides(source, ['a'], 103, 2, 8)
    expect(result.nodes[0].position).toEqual({ x: 105, y: 4 })
    expect(result.guides).toEqual({ x: 205, y: 4 })
  })

  it('resizes nodes within limits, deletes connections, and renames groups', () => {
    expect(resizeCanvasNode(nodes, 'a', 50, 5000)[0]).toMatchObject({ width: 120, height: 4000 })
    const document: CanvasDocument = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes, connections: [{ id: 'edge', fromNodeId: 'a', toNodeId: 'b' }], groups: [{ id: 'g', title: '旧名' }] }
    expect(deleteCanvasConnection(document, 'edge').connections).toEqual([])
    expect(deleteCanvasConnections({ ...document, connections: [{ id: 'one', fromNodeId: 'a', toNodeId: 'b' }, { id: 'two', fromNodeId: 'b', toNodeId: 'c' }] }, new Set(['one', 'two'])).connections).toEqual([])
    expect(renameCanvasGroup(document, 'g', '  新分组  ').groups).toEqual([{ id: 'g', title: '新分组' }])
  })
})
