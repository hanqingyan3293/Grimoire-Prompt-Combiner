// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIPanel } from './ComfyUIPanel'

const api = {
  settings: { getAll: vi.fn(async () => ({ comfyui_base_url: 'http://127.0.0.1:8188' })), set: vi.fn(async () => true) },
  ipcApi: { request: vi.fn(async () => ({ ok: true, data: {} })) },
  comfy: {
    status: vi.fn(async () => ({ online: true, comfyui_version: '0.3.40' })),
    models: vi.fn(async () => ({ checkpoints: ['base.safetensors'], unets: [], loras: [] })),
    objectInfo: vi.fn(async () => ({ CustomGenerator: {}, CheckpointLoaderSimple: {}, KSampler: {} })),
    remoteWorkflows: vi.fn(async (): Promise<string[]> => []),
    importRemoteWorkflow: vi.fn(),
    workflows: vi.fn(async (): Promise<unknown[]> => []),
    importWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    createTask: vi.fn(),
    quickGenerate: vi.fn(),
    queue: vi.fn(),
    history: vi.fn(),
  },
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: typeof api }).api = api
})

describe('ComfyUI queue and history panel', () => {
  it('preserves an imported prompt when the current tag workbench is empty', async () => {
    api.comfy.workflows.mockResolvedValueOnce([{ id:'saved',name:'saved prompt',source:'imported',analysis:{nodeCount:1,warnings:[]},bindings:[{key:'prompt',label:'正面提示词',nodeId:'1',field:'text',valueType:'string'}],defaults:{prompt:'original workflow prompt'} }])
    api.comfy.queue.mockResolvedValue({ queue_pending:0,queue_running:0,queued:false,running:false,queue_remaining:0 })
    render(<ComfyUIPanel />)
    expect(await screen.findByLabelText('正面提示词 · 1.text')).toHaveProperty('value','original workflow prompt')
  })
  it('reads the remote directory and imports a selected nested workflow into the local list', async () => {
    const imported = { id: 'remote1', name: 'sub/嵌套', source: 'remote', analysis: { nodeCount: 3, warnings: [] }, bindings: [], defaults: {} }
    api.comfy.queue.mockResolvedValue({ queue_pending: 0, queue_running: 0, queued: false, running: false, queue_remaining: 0 })
    api.comfy.remoteWorkflows.mockResolvedValueOnce(['sub/嵌套'])
    api.comfy.importRemoteWorkflow.mockResolvedValue(imported)
    api.comfy.workflows.mockResolvedValueOnce([]).mockResolvedValueOnce([imported])
    render(<ComfyUIPanel />)
    const discover = await screen.findByRole('button', { name: '读取服务工作流' })
    await waitFor(() => expect(discover.hasAttribute('disabled')).toBe(false))
    fireEvent.click(discover)
    const select = await screen.findByLabelText('服务中的工作流')
    await waitFor(() => expect(select.querySelector('option[value="sub/嵌套"]')).toBeTruthy())
    fireEvent.change(select, { target: { value: 'sub/嵌套' } })
    fireEvent.click(screen.getByRole('button', { name: '导入选中工作流' }))
    await waitFor(() => expect(api.comfy.importRemoteWorkflow).toHaveBeenCalledWith('sub/嵌套'))
    expect(await screen.findAllByText('sub/嵌套')).toHaveLength(2)
    expect(await screen.findByText('服务节点：3')).toBeTruthy()
    fireEvent.click(screen.getByText('查看服务节点'))
    expect(screen.getByLabelText('服务节点列表').textContent).toContain('CustomGenerator')
  })

  it('shows a directory error and keeps it separate from an empty successful listing', async () => {
    api.comfy.queue.mockResolvedValue({ queue_pending: 0, queue_running: 0, queued: false, running: false, queue_remaining: 0 })
    api.comfy.remoteWorkflows.mockRejectedValueOnce(new Error('ComfyUI HTTP 503'))
    render(<ComfyUIPanel />)
    const discover = await screen.findByRole('button', { name: '读取服务工作流' })
    await waitFor(() => expect(discover.hasAttribute('disabled')).toBe(false))
    fireEvent.click(discover)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('503'))
    expect(api.comfy.importRemoteWorkflow).not.toHaveBeenCalled()
  })

  it('discards a directory response from the previous configured service', async () => {
    let release!: (value: string[]) => void
    api.comfy.remoteWorkflows.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    api.comfy.queue.mockResolvedValue({ queue_pending: 0, queue_running: 0, queued: false, running: false, queue_remaining: 0 })
    api.settings.getAll.mockResolvedValueOnce({ comfyui_base_url: 'http://127.0.0.1:8188' }).mockResolvedValueOnce({ comfyui_base_url: 'http://127.0.0.1:9000' })
    render(<ComfyUIPanel />)
    const discover = await screen.findByRole('button', { name: '读取服务工作流' })
    await waitFor(() => expect(discover.hasAttribute('disabled')).toBe(false))
    fireEvent.click(discover)
    fireEvent.change(screen.getByLabelText('ComfyUI 地址'), { target: { value: 'http://127.0.0.1:9000' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并连接' }))
    await screen.findByText('ComfyUI 地址已保存，连接成功')
    release(['old-server/workflow'])
    await waitFor(() => expect(screen.queryByText('正在读取服务工作流…')).toBeNull())
    expect(screen.getByLabelText('服务中的工作流').querySelector('option[value="old-server/workflow"]')).toBeNull()
  })
  it('opens the configured ComfyUI page in the embedded WebContentsView tab', async () => {
    api.comfy.queue.mockResolvedValue({ queue_pending: 0, queue_running: 0, queued: false, running: false, queue_remaining: 0 })
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect)
    render(<ComfyUIPanel />)

    const embeddedTab = await screen.findByRole('tab', { name: '嵌入网页' })
    expect(embeddedTab.hasAttribute('disabled')).toBe(false)
    fireEvent.click(embeddedTab)

    expect(await screen.findByLabelText('地址')).toHaveProperty('value', 'http://127.0.0.1:8188')
    await waitFor(() => expect(api.ipcApi.request).toHaveBeenCalledWith('browser.host.open', expect.objectContaining({ id: 'comfyui-web', url: 'http://127.0.0.1:8188' })))
    expect(screen.getByLabelText('网页区域')).toBeTruthy()
    bounds.mockRestore()
  })

  it('returns to the control console if the service disconnects while the web tab is active', async () => {
    api.comfy.status.mockResolvedValueOnce({ online: true, comfyui_version: '0.3.40' })
      .mockResolvedValueOnce({ online: false, comfyui_version: '' })
    render(<ComfyUIPanel />)
    fireEvent.click(await screen.findByRole('tab', { name: '嵌入网页' }))
    expect(await screen.findByLabelText('网页区域')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新 ComfyUI 状态' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '控制台' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.queryByLabelText('网页区域')).toBeNull()
    expect(screen.getByLabelText('ComfyUI 视图').textContent).toContain('控制台')
  })

  it('keeps the control console available and disables the web tab when ComfyUI is offline', async () => {
    api.comfy.status.mockResolvedValueOnce({ online: false, comfyui_version: '' })
    render(<ComfyUIPanel />)

    const embeddedTab = await screen.findByRole('tab', { name: '嵌入网页' })
    expect(embeddedTab.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('tab', { name: '控制台' })).toBeTruthy()
    expect(screen.getByLabelText('ComfyUI 地址')).toBeTruthy()
    expect(screen.getByText(/连接服务后可使用嵌入网页/)).toBeTruthy()
  })

  it('renders queue counts and refreshes them with the status action', async () => {
    api.comfy.queue
      .mockResolvedValueOnce({ queue_pending: 3, queue_running: 1, queued: false, running: false, queue_remaining: 3 })
      .mockResolvedValueOnce({ queue_pending: 5, queue_running: 2, queued: false, running: false, queue_remaining: 5 })
    render(<ComfyUIPanel />)

    const queueSection = await screen.findByRole('region', { name: 'ComfyUI 队列与历史' })
    await waitFor(() => expect(within(queueSection).getByText('1')).toBeTruthy())
    expect(within(queueSection).getByText('3')).toBeTruthy()

    const refresh = screen.getByRole('button', { name: '刷新 ComfyUI 状态' })
    await waitFor(() => expect(refresh.hasAttribute('disabled')).toBe(false))
    fireEvent.click(refresh)

    await waitFor(() => expect(api.comfy.queue).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(queueSection).getByText('2')).toBeTruthy())
    expect(within(queueSection).getByText('5')).toBeTruthy()
  })

  it('queries history for the entered prompt id and renders the result', async () => {
    api.comfy.queue.mockResolvedValue({ queue_pending: 0, queue_running: 0, queued: false, running: false, queue_remaining: 0 })
    api.comfy.history.mockResolvedValue({
      status: 'done',
      images: [{ filename: 'result.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=result.png&subfolder=&type=output' }],
    })
    render(<ComfyUIPanel />)

    await screen.findByRole('region', { name: 'ComfyUI 队列与历史' })
    fireEvent.change(screen.getByLabelText('历史任务 ID'), { target: { value: ' prompt-42 ' } })
    fireEvent.click(screen.getByRole('button', { name: '查询历史' }))

    await waitFor(() => expect(api.comfy.history).toHaveBeenCalledWith('prompt-42'))
    expect(await screen.findByText('已完成 · 1 张图片')).toBeTruthy()
  })

  it('shows conversion warnings after importing a frontend graph', async () => {
    const imported = {
      id: 'w1',
      name: 'frontend',
      source: 'imported',
      analysis: { nodeCount: 1, warnings: ['已忽略前端注释节点：Note 2', '未识别节点类型：MysteryNode（已按原类型保留）'] },
      bindings: [],
      defaults: {},
    }
    api.comfy.queue.mockResolvedValue({ queue_pending: 0, queue_running: 0, queued: false, running: false, queue_remaining: 0 })
    api.comfy.workflows.mockResolvedValueOnce([]).mockResolvedValueOnce([imported])
    api.comfy.importWorkflow.mockResolvedValue(imported)
    render(<ComfyUIPanel />)

    await screen.findByRole('region', { name: 'ComfyUI 队列与历史' })
    fireEvent.click(screen.getByRole('button', { name: '导入工作流 JSON' }))

    expect(await screen.findByText('工作流已导入，含 2 条警告')).toBeTruthy()
    expect(await screen.findByText(/未识别节点类型/)).toBeTruthy()
  })
})
