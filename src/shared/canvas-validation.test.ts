import { describe, expect, it } from 'vitest'
import { validateCanvasDocument } from './canvas-validation'

describe('canvas document validation', () => {
  const node = { id: 'a', kind: 'text' as const, title: 'A', content: '', position: { x: 0, y: 0 }, width: 260, height: 150 }
  it('accepts valid documents and clamps dimensions', () => {
    const result = validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 10 }, nodes: [{ ...node, width: 20 }], connections: [] })
    expect(result.viewport.scale).toBe(5)
    expect(result.nodes[0].width).toBe(120)
  })
  it('rejects duplicate nodes and invalid connection endpoints', () => {
    expect(() => validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [node, node], connections: [] })).toThrow('重复')
    expect(() => validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [node], connections: [{ id: 'c', fromNodeId: 'a', toNodeId: 'missing' }] })).toThrow('端点')
  })
  it('keeps valid groups and drops missing group references', () => {
    const result = validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [{ ...node, groupId: 'g1' }, { ...node, id: 'b', groupId: 'missing' }], connections: [], groups: [{ id: 'g1', title: '构图' }] })
    expect(result.nodes[0].groupId).toBe('g1')
    expect(result.nodes[1].groupId).toBeUndefined()
    expect(result.groups).toEqual([{ id: 'g1', title: '构图' }])
  })
  it('sanitizes static plugin node configuration', () => {
    const result = validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [
      { ...node, kind: 'wd14', config: { imageId: 5, threshold: 2, workflowId: 'ignored' } },
      { ...node, id: 'b', kind: 'comfyui', config: { workflowId: 'wf_1', assetId: 'ignored' } },
    ], connections: [] })
    expect(result.nodes[0].config).toEqual({ imageId: 5, threshold: 0.35 })
    expect(result.nodes[1].config).toEqual({ workflowId: 'wf_1' })
  })
  it('accepts legacy links but rejects invalid typed ports and typed cycles', () => {
    const prompt = { ...node, kind: 'prompt' as const }
    const comfy = { ...node, id: 'b', kind: 'comfyui' as const }
    expect(validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [prompt, comfy], connections: [{ id: 'legacy', fromNodeId: 'a', toNodeId: 'b' }] }).connections[0].dataType).toBeUndefined()
    expect(() => validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [prompt, comfy], connections: [{ id: 'bad', fromNodeId: 'a', toNodeId: 'b', fromPort: 'prompt', toPort: 'prompt', dataType: 'image' }] })).toThrow('端口')
    const reverse = { id: 'legacy-reverse', fromNodeId: 'b', toNodeId: 'a' }
    expect(() => validateCanvasDocument({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [prompt, comfy], connections: [reverse, { id: 'typed', fromNodeId: 'a', toNodeId: 'b', fromPort: 'prompt', toPort: 'prompt', dataType: 'prompt' }] })).toThrow('循环')
  })
})
