import { describe, expect, it, vi } from 'vitest'
import type { CanvasDocument, CanvasNode, CanvasNodeKind } from '../../../shared/canvas-types'
import type { TaskRecord } from '../../../shared/task-types'
import { canvasNodeHasCapability } from './nodeRegistry'
import { createTypedCanvasConnection, patchCanvasNode, synchronizeCanvasConnection } from '../../../shared/canvas-dataflow'
import { executeComfyBusinessNode, executePromptAssetBusinessNode, executeWD14BusinessNode, extractTaskImageIds, extractWD14TagNames, reconcileBusinessTaskNode } from './businessNodeRuntime'
import { decodeStoredZip, encodeStoredZip, remapImportedCanvasNodes } from '../../../main/services/project-package.service'
import { validateCanvasDocument } from '../../../shared/canvas-validation'

const node = (id: string, kind: CanvasNodeKind, patch: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind, title: id, content: '', position: { x: 0, y: 0 }, width: 320, height: 220, status: 'idle', ...patch })
const task = (patch: Partial<TaskRecord>): TaskRecord => ({ id: 'task', kind: 'wd14', status: 'queued', input_json: '{}', output_json: null, error_code: null, error_message: null, progress: 0, retry_count: 0, max_retries: 2, created_at: '', started_at: null, finished_at: null, updated_at: '', ...patch })

function addConnection(document: CanvasDocument, from: string, to: string, id: string): CanvasDocument {
  const result = createTypedCanvasConnection(document, from, to, id)
  if (!result.connection) throw new Error(result.error)
  return { ...document, connections: [...document.connections, result.connection] }
}

describe('canvas workflow scenario', () => {
  it('runs prompt and image workflows explicitly from nodes through task results', async () => {
    let document: CanvasDocument = {
      version: 1, viewport: { x: 0, y: 0, scale: 1 }, connections: [], nodes: [
        node('asset', 'prompt-asset', { content: 'solo, long hair', config: { assetId: 'asset-1' } }),
        node('comfy', 'comfyui', { config: { workflowId: 'workflow-1' } }),
        node('generated', 'image'),
        node('source-image', 'image', { refId: '21', content: 'managed/source.png' }),
        node('wd', 'wd14', { config: { threshold: 0.35 } }),
        node('prompt', 'prompt'),
      ],
    }
    document = addConnection(document, 'asset', 'comfy', 'asset-comfy')
    document = addConnection(document, 'source-image', 'wd', 'image-wd')
    document = addConnection(document, 'wd', 'prompt', 'wd-prompt')

    const promptSync = synchronizeCanvasConnection(document, 'asset-comfy')
    document = promptSync.document
    expect(document.nodes.find(item => item.id === 'comfy')?.content).toBe('solo, long hair')
    expect(promptSync.message).toContain('不会自动执行')

    const createComfyTask = vi.fn().mockResolvedValue({ id: 'comfy-task' })
    const comfyNode = document.nodes.find(item => item.id === 'comfy')!
    const comfyStart = await executeComfyBusinessNode(comfyNode, [{ id: 'workflow-1', name: 'Generate', defaults: { steps: 20 }, bindings: [{ key: 'prompt' }] }], { hasCapability: canvasNodeHasCapability, createWD14Task: vi.fn(), createComfyTask })
    document = patchCanvasNode(document, 'comfy', comfyStart.patch)
    expect(createComfyTask).toHaveBeenCalledWith('workflow-1', { steps: 20, prompt: 'solo, long hair' })
    expect(document.nodes.find(item => item.id === 'comfy')).toMatchObject({ refId: 'comfy-task', status: 'running' })

    const comfyDone = task({ id: 'comfy-task', kind: 'comfyui', status: 'succeeded', output_json: JSON.stringify({ imageIds: [77, 77] }) })
    document = patchCanvasNode(document, 'comfy', reconcileBusinessTaskNode(document.nodes.find(item => item.id === 'comfy')!, comfyDone))
    expect(extractTaskImageIds(comfyDone)).toEqual([77])
    expect(document.nodes.find(item => item.id === 'comfy')?.status).toBe('success')

    const imageSync = synchronizeCanvasConnection(document, 'image-wd')
    document = imageSync.document
    expect(document.nodes.find(item => item.id === 'wd')?.config?.imageId).toBe(21)

    const createWD14Task = vi.fn().mockResolvedValue({ id: 'wd-task' })
    const wdStart = await executeWD14BusinessNode(document.nodes.find(item => item.id === 'wd')!, { hasCapability: canvasNodeHasCapability, createWD14Task, createComfyTask: vi.fn() })
    document = patchCanvasNode(document, 'wd', wdStart.patch)
    expect(createWD14Task).toHaveBeenCalledWith({ imageId: 21, threshold: 0.35, modelId: undefined })

    const wdDone = task({ id: 'wd-task', status: 'succeeded', output_json: JSON.stringify({ general: [{ name: 'solo' }], character: [{ name: 'alice' }], quality: [{ name: 'masterpiece' }], rating: [{ name: 'safe' }] }) })
    document = patchCanvasNode(document, 'wd', reconcileBusinessTaskNode(document.nodes.find(item => item.id === 'wd')!, wdDone))
    document = synchronizeCanvasConnection(document, 'wd-prompt', () => extractWD14TagNames(wdDone)).document
    expect(document.nodes.find(item => item.id === 'prompt')).toMatchObject({ content: 'solo, alice, masterpiece', status: 'idle' })

    const assetApply = executePromptAssetBusinessNode(document.nodes.find(item => item.id === 'asset')!, { hasCapability: canvasNodeHasCapability, applyPromptText: () => ({ matched: 2, unknown: [] }) })
    expect(assetApply.ok).toBe(true)
    expect(validateCanvasDocument(document).connections).toHaveLength(3)
  })

  it('round trips the scenario through ZIP storage and remaps external references', () => {
    let document: CanvasDocument = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, connections: [], nodes: [
      node('asset', 'prompt-asset', { content: 'solo', config: { assetId: 'asset-old' } }),
      node('comfy', 'comfyui', { content: 'solo', refId: 'task-comfy', status: 'running', config: { workflowId: 'wf-old' } }),
      node('image', 'image', { refId: '10', content: 'old.png' }),
      node('wd', 'wd14', { refId: 'task-wd', status: 'success', config: { imageId: 10, threshold: 0.4 } }),
      node('prompt', 'prompt'),
    ] }
    document = addConnection(document, 'asset', 'comfy', 'asset-comfy')
    document = addConnection(document, 'image', 'wd', 'image-wd')
    document = addConnection(document, 'wd', 'prompt', 'wd-prompt')

    const zip = encodeStoredZip(new Map([['project.json', Buffer.from(JSON.stringify({ document }), 'utf8')]]))
    const decoded = decodeStoredZip(zip)
    const restored = JSON.parse(decoded.get('project.json')!.toString('utf8')).document as CanvasDocument
    const warnings: string[] = []
    const remapped = remapImportedCanvasNodes(restored, new Map([[10, { id: 99, filePath: 'managed.png' }]]), new Map([['wf-old', 'wf-new']]), warnings)
    expect(remapped.nodes.find(item => item.id === 'asset')).toMatchObject({ content: 'solo', config: undefined })
    expect(remapped.nodes.find(item => item.id === 'comfy')).toMatchObject({ refId: undefined, status: 'idle', config: { workflowId: 'wf-new' } })
    expect(remapped.nodes.find(item => item.id === 'image')).toMatchObject({ refId: '99', content: 'managed.png' })
    expect(remapped.nodes.find(item => item.id === 'wd')).toMatchObject({ refId: undefined, config: { imageId: 99, threshold: 0.4 } })
    expect(remapped.connections.map(connection => connection.dataType)).toEqual(['prompt', 'image', 'tags'])
    expect(warnings.filter(message => message.includes('快照'))).toHaveLength(2)
  })

  it('keeps failed business nodes configured and requires an explicit successful retry', async () => {
    let document: CanvasDocument = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, connections: [], nodes: [
      node('image', 'image', { refId: '9' }),
      node('wd', 'wd14', { config: { imageId: 9, threshold: 0.35 } }),
      node('prompt', 'prompt', { content: 'unchanged' }),
    ] }
    document = addConnection(document, 'image', 'wd', 'image-wd')
    document = addConnection(document, 'wd', 'prompt', 'wd-prompt')

    const failed = await executeWD14BusinessNode(document.nodes.find(item => item.id === 'wd')!, { hasCapability: canvasNodeHasCapability, createWD14Task: vi.fn().mockRejectedValue(new Error('Worker offline')), createComfyTask: vi.fn() })
    document = patchCanvasNode(document, 'wd', failed.patch)
    expect(document.nodes.find(item => item.id === 'wd')).toMatchObject({ status: 'error', config: { imageId: 9, threshold: 0.35 } })
    const blockedSync = synchronizeCanvasConnection(document, 'wd-prompt', () => [])
    expect(blockedSync.changed).toBe(false)
    expect(document.nodes.find(item => item.id === 'prompt')?.content).toBe('unchanged')

    const retried = await executeWD14BusinessNode(document.nodes.find(item => item.id === 'wd')!, { hasCapability: canvasNodeHasCapability, createWD14Task: vi.fn().mockResolvedValue({ id: 'retry-task' }), createComfyTask: vi.fn() })
    document = patchCanvasNode(document, 'wd', retried.patch)
    expect(document.nodes.find(item => item.id === 'wd')).toMatchObject({ refId: 'retry-task', status: 'running', config: { imageId: 9, threshold: 0.35 } })
  })
})
