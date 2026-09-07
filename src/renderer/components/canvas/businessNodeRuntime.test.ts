import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../../../shared/canvas-types'
import type { TaskRecord } from '../../../shared/task-types'
import { executeComfyBusinessNode, executePromptAssetBusinessNode, executeWD14BusinessNode, extractTaskImageIds, extractWD14TagNames, reconcileBusinessTaskNode } from './businessNodeRuntime'

const base = { id: 'node', title: 'Node', content: '', position: { x: 0, y: 0 }, width: 320, height: 230, status: 'idle' as const }
const capabilities = (kind: CanvasNode['kind'], capability: string) => (kind === 'wd14' && capability === 'wd14.createTask') || (kind === 'comfyui' && capability === 'comfyui.createTask')
const task = (patch: Partial<TaskRecord>): TaskRecord => ({ id: 'task', kind: 'wd14', status: 'queued', input_json: '{}', output_json: null, error_code: null, error_message: null, progress: 0, retry_count: 0, max_retries: 2, created_at: '', started_at: null, finished_at: null, updated_at: '', ...patch })

describe('canvas business node runtime', () => {
  it('applies prompt assets through the granted prompt capability', () => {
    const node: CanvasNode = { ...base, kind: 'prompt-asset', content: 'long hair, unknown' }
    const success = executePromptAssetBusinessNode(node, { hasCapability: (kind, capability) => kind === 'prompt-asset' && capability === 'prompt.apply', applyPromptText: vi.fn().mockReturnValue({ matched: 1, unknown: ['unknown'] }) })
    expect(success).toMatchObject({ ok: true, patch: { status: 'success' } })
    expect(success.message).toContain('1 项未匹配')
    const noMatch = executePromptAssetBusinessNode(node, { hasCapability: () => true, applyPromptText: () => ({ matched: 0, unknown: ['long hair'] }) })
    expect(noMatch).toMatchObject({ ok: false, patch: { status: 'error' } })
  })

  it('rejects prompt asset application without capability', () => {
    const result = executePromptAssetBusinessNode({ ...base, kind: 'prompt-asset', content: 'long hair' }, { hasCapability: () => false, applyPromptText: vi.fn() })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('未授权能力')
  })

  it('creates a WD14 task with bounded node configuration', async () => {
    const createWD14Task = vi.fn().mockResolvedValue({ id: 'wd-task' })
    const node: CanvasNode = { ...base, kind: 'wd14', config: { imageId: 12, modelId: 'model', threshold: 0.42 } }
    const result = await executeWD14BusinessNode(node, { hasCapability: capabilities, createWD14Task, createComfyTask: vi.fn() })
    expect(createWD14Task).toHaveBeenCalledWith({ imageId: 12, modelId: 'model', threshold: 0.42 })
    expect(result).toMatchObject({ ok: true, patch: { refId: 'wd-task', status: 'running' } })
  })

  it('keeps WD14 configuration retryable after backend failure', async () => {
    const node: CanvasNode = { ...base, kind: 'wd14', config: { imageId: 12, threshold: 0.35 } }
    const result = await executeWD14BusinessNode(node, { hasCapability: capabilities, createWD14Task: vi.fn().mockRejectedValue(new Error('Worker unavailable')), createComfyTask: vi.fn() })
    expect(result).toMatchObject({ ok: false, patch: { status: 'error', content: 'Worker unavailable' } })
    expect(node.config).toEqual({ imageId: 12, threshold: 0.35 })
  })

  it('submits ComfyUI defaults with the node prompt and rejects missing prompt bindings', async () => {
    const createComfyTask = vi.fn().mockResolvedValue({ id: 'comfy-task' })
    const node: CanvasNode = { ...base, kind: 'comfyui', content: '1girl', config: { workflowId: 'wf' } }
    const deps = { hasCapability: capabilities, createWD14Task: vi.fn(), createComfyTask }
    const ok = await executeComfyBusinessNode(node, [{ id: 'wf', name: 'Workflow', defaults: { steps: 20 }, bindings: [{ key: 'prompt' }] }], deps)
    expect(createComfyTask).toHaveBeenCalledWith('wf', { steps: 20, prompt: '1girl' })
    expect(ok).toMatchObject({ ok: true, patch: { refId: 'comfy-task', status: 'running' } })
    const blocked = await executeComfyBusinessNode(node, [{ id: 'wf', name: 'Workflow', defaults: {}, bindings: [{ key: 'seed' }] }], deps)
    expect(blocked).toMatchObject({ ok: false, patch: { status: 'error' } })
  })

  it('rejects execution when the node capability is not granted', async () => {
    const result = await executeWD14BusinessNode({ ...base, kind: 'text' }, { hasCapability: () => false, createWD14Task: vi.fn(), createComfyTask: vi.fn() })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('未授权能力')
  })

  it('reconciles task states without overwriting a ComfyUI prompt', () => {
    const node: CanvasNode = { ...base, kind: 'comfyui', content: 'keep prompt', refId: 'task' }
    expect(reconcileBusinessTaskNode(node, task({ kind: 'comfyui', status: 'succeeded', output_json: JSON.stringify({ imageIds: [4] }) }))).toEqual({ title: 'ComfyUI 生成', status: 'success' })
    expect(node.content).toBe('keep prompt')
    expect(reconcileBusinessTaskNode({ ...base, kind: 'wd14' }, task({ status: 'failed', error_message: '模型加载失败' }))).toEqual({ title: 'WD14 反推', status: 'error', content: '模型加载失败' })
  })

  it('extracts deduplicated image ids and WD14 tags from persisted outputs', () => {
    expect(extractTaskImageIds(task({ output_json: JSON.stringify({ imageIds: [2, 2, -1, '3'] }) }))).toEqual([2])
    expect(extractWD14TagNames(task({ output_json: JSON.stringify({ general: [{ name: 'solo' }], character: [{ name: 'alice' }], rating: [{ name: 'safe' }] }) }))).toEqual(['solo', 'alice'])
  })
})
