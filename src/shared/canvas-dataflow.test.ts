import { describe, expect, it } from 'vitest'
import type { CanvasDocument, CanvasNode, CanvasNodeKind } from './canvas-types'
import { createCanvasConnectionPath, createTypedCanvasConnection, getCanvasPortAnchor, reconnectTypedCanvasConnection, synchronizeCanvasConnection, toggleCanvasConnectionSelection } from './canvas-dataflow'

const node = (id: string, kind: CanvasNodeKind, content = '', refId?: string): CanvasNode => ({ id, kind, title: id, content, refId, position: { x: 0, y: 0 }, width: 300, height: 200 })
const document = (nodes: CanvasNode[], connections: CanvasDocument['connections'] = []): CanvasDocument => ({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes, connections })

describe('canvas typed data flow', () => {
  it('creates the supported typed connections', () => {
    expect(createTypedCanvasConnection(document([node('p', 'prompt'), node('c', 'comfyui')]), 'p', 'c', 'pc').connection).toMatchObject({ fromPort: 'prompt', toPort: 'prompt', dataType: 'prompt' })
    expect(createTypedCanvasConnection(document([node('i', 'image'), node('w', 'wd14')]), 'i', 'w', 'iw').connection).toMatchObject({ dataType: 'image' })
    expect(createTypedCanvasConnection(document([node('w', 'wd14'), node('p', 'prompt')]), 'w', 'p', 'wp').connection).toMatchObject({ dataType: 'tags' })
    expect(createTypedCanvasConnection(document([node('a', 'prompt-asset'), node('c', 'comfyui')]), 'a', 'c', 'ac').connection).toMatchObject({ dataType: 'prompt' })
  })

  it('rejects incompatible, duplicate, and cyclic connections', () => {
    expect(createTypedCanvasConnection(document([node('p', 'prompt'), node('w', 'wd14')]), 'p', 'w', 'bad').error).toContain('兼容')
    const first = createTypedCanvasConnection(document([node('p', 'prompt'), node('c', 'comfyui')]), 'p', 'c', 'one').connection!
    expect(createTypedCanvasConnection(document([node('p', 'prompt'), node('c', 'comfyui')], [first]), 'p', 'c', 'two').error).toContain('存在')
    const reverse = { id: 'reverse', fromNodeId: 'c', toNodeId: 'p' }
    expect(createTypedCanvasConnection(document([node('p', 'prompt'), node('c', 'comfyui')], [reverse]), 'p', 'c', 'cycle').error).toContain('循环')
  })

  it('creates exact port links and reconnects only to compatible targets', () => {
    const nodes = [node('a', 'prompt-asset'), node('c1', 'comfyui'), node('c2', 'comfyui'), node('w', 'wd14')]
    const first = createTypedCanvasConnection(document(nodes), 'a', 'c1', 'link', 'prompt', 'prompt').connection!
    const moved = reconnectTypedCanvasConnection(document(nodes, [first]), 'link', 'c2', 'prompt')
    expect(moved.connection).toMatchObject({ id: 'link', fromNodeId: 'a', toNodeId: 'c2', fromPort: 'prompt', toPort: 'prompt' })
    expect(reconnectTypedCanvasConnection(document(nodes, [first]), 'link', 'w').error).toContain('兼容')
    expect(reconnectTypedCanvasConnection(document(nodes, [{ id: 'legacy', fromNodeId: 'a', toNodeId: 'c1' }]), 'legacy', 'c2').error).toContain('旧式')
  })

  it('calculates stable edge anchors and Bezier paths', () => {
    const source = { ...node('a', 'prompt-asset'), position: { x: 100, y: 50 }, width: 340, height: 220 }
    const target = { ...node('c', 'comfyui'), position: { x: 600, y: 100 }, width: 340, height: 250 }
    expect(getCanvasPortAnchor(source, 'prompt')).toEqual({ x: 440, y: 172 })
    expect(getCanvasPortAnchor(target, 'prompt')).toEqual({ x: 600, y: 237 })
    expect(createCanvasConnectionPath({ x: 440, y: 172 }, { x: 600, y: 237 })).toBe('M 440 172 C 512 172, 528 237, 600 237')
  })

  it('keeps connection geometry stable when a grouped node moves', () => {
    const source = { ...node('a', 'prompt-asset'), position: { x: 100, y: 50 }, width: 340, height: 220, groupId: 'g' }
    const before = getCanvasPortAnchor(source, 'prompt')!
    const after = getCanvasPortAnchor({ ...source, position: { x: 148, y: 82 } }, 'prompt')!
    expect(after).toEqual({ x: before.x + 48, y: before.y + 32 })
    expect(createCanvasConnectionPath(before, after)).not.toContain('NaN')
  })

  it('supports atomic single and additive connection selection', () => {
    expect([...toggleCanvasConnectionSelection(new Set(['a', 'b']), 'c', false)]).toEqual(['c'])
    expect([...toggleCanvasConnectionSelection(new Set(['a']), 'b', true)]).toEqual(['a', 'b'])
    expect([...toggleCanvasConnectionSelection(new Set(['a', 'b']), 'a', true)]).toEqual(['b'])
  })

  it('synchronizes prompt and image data without executing downstream nodes', () => {
    const promptDoc = document([node('a', 'prompt-asset', 'long hair'), node('c', 'comfyui')])
    const promptConnection = createTypedCanvasConnection(promptDoc, 'a', 'c', 'ac').connection!
    const promptResult = synchronizeCanvasConnection({ ...promptDoc, connections: [promptConnection] }, 'ac')
    expect(promptResult.document.nodes[1].content).toBe('long hair')
    expect(promptResult.document.nodes[1].refId).toBeUndefined()
    expect(promptResult.message).toContain('不会自动执行')

    const imageDoc = document([node('i', 'image', '', '42'), node('w', 'wd14')])
    const imageConnection = createTypedCanvasConnection(imageDoc, 'i', 'w', 'iw').connection!
    expect(synchronizeCanvasConnection({ ...imageDoc, connections: [imageConnection] }, 'iw').document.nodes[1].config?.imageId).toBe(42)
  })

  it('synchronizes WD14 tags into prompt content and rejects legacy links', () => {
    const doc = document([node('w', 'wd14'), node('p', 'prompt')])
    const connection = createTypedCanvasConnection(doc, 'w', 'p', 'wp').connection!
    const result = synchronizeCanvasConnection({ ...doc, connections: [connection] }, 'wp', () => ['solo', 'long hair'])
    expect(result.document.nodes[1]).toMatchObject({ content: 'solo, long hair', status: 'idle' })
    expect(result.message).toContain('请手动应用')
    expect(synchronizeCanvasConnection({ ...doc, connections: [{ id: 'legacy', fromNodeId: 'w', toNodeId: 'p' }] }, 'legacy').changed).toBe(false)
  })
})
