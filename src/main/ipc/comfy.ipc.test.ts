import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  queue: vi.fn(),
  history: vi.fn(),
  status: vi.fn(),
  models: vi.fn(),
  objectInfo: vi.fn(),
  remoteWorkflows: vi.fn(),
  readRemoteWorkflow: vi.fn(),
  showOpenDialog: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  listWorkflows: vi.fn(() => []),
  getWorkflow: vi.fn(),
  importWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  parseWorkflow: vi.fn(),
  parseFrontend: vi.fn(),
  isFrontend: vi.fn(),
  buildSchemas: vi.fn(),
  createTask: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}))
vi.mock('fs', () => ({ default: { readFileSync: mocks.readFileSync, statSync: mocks.statSync }, readFileSync: mocks.readFileSync, statSync: mocks.statSync }))
vi.mock('../services/comfy-client', () => ({
  comfyUIClient: { queue: mocks.queue, history: mocks.history, status: mocks.status, models: mocks.models, objectInfo: mocks.objectInfo, remoteWorkflows: mocks.remoteWorkflows, readRemoteWorkflow: mocks.readRemoteWorkflow },
}))
vi.mock('../services/comfy-workflow.service', () => ({
  listComfyWorkflows: mocks.listWorkflows,
  getComfyWorkflow: mocks.getWorkflow,
  importComfyWorkflow: mocks.importWorkflow,
  deleteComfyWorkflow: mocks.deleteWorkflow,
}))
vi.mock('../services/comfy-workflow.core', () => ({
  parseComfyWorkflow: mocks.parseWorkflow,
  parseComfyFrontendWorkflow: mocks.parseFrontend,
  isComfyFrontendWorkflow: mocks.isFrontend,
  buildComfyWidgetSchemas: mocks.buildSchemas,
}))
vi.mock('../services/task-repository', () => ({ createPersistedTask: mocks.createTask }))

import { registerComfyIPC } from './comfy.ipc'

type Handler = (event: unknown, value?: unknown) => Promise<unknown>

function handler(channel: string): Handler {
  const entry = mocks.handle.mock.calls.find(([registered]) => registered === channel)
  if (!entry) throw new Error('Missing handler ' + channel)
  return entry[1] as Handler
}

function call(channel: string, value?: unknown): Promise<unknown> {
  return handler(channel)({}, value)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isFrontend.mockReturnValue(false)
  mocks.statSync.mockReturnValue({ size: 1024, isFile: () => true })
  mocks.objectInfo.mockResolvedValue({})
  mocks.buildSchemas.mockReturnValue({})
  mocks.parseWorkflow.mockImplementation(value => value)
  mocks.parseFrontend.mockReturnValue({ workflow: { '1': { class_type: 'KSampler', inputs: {} } }, warnings: [] })
  mocks.importWorkflow.mockImplementation((name: string, _workflow: unknown, source: string) => storedWorkflow(name, source))
  registerComfyIPC()
})

function storedWorkflow(name = 'demo', source = 'imported') {
  return {
    id: 'w1',
    name,
    raw_json: '{"1":{"class_type":"KSampler","inputs":{}}}',
    analysis_json: '{"nodeCount":1,"bindings":[],"unknownNodeTypes":[],"warnings":[]}',
    bindings_json: '[]',
    source,
    created_at: 'now',
    updated_at: 'now',
  }
}

describe('ComfyUI queue and history IPC', () => {
  it('reads queue status without requiring a prompt id', async () => {
    const queue = { queue_pending: 3, queue_running: 1, queued: false, running: false, queue_remaining: 3 }
    mocks.queue.mockResolvedValue(queue)

    await expect(call(IPC_CHANNELS.COMFY_QUEUE)).resolves.toEqual(queue)
    expect(mocks.queue).toHaveBeenCalledWith('')
  })

  it('trims and forwards a prompt id to both queue and history', async () => {
    const queue = { queue_pending: 0, queue_running: 1, queued: false, running: true, queue_remaining: 0 }
    const history = { status: 'done', images: [{ filename: 'result.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8188/view?filename=result.png&subfolder=&type=output' }] }
    mocks.queue.mockResolvedValue(queue)
    mocks.history.mockResolvedValue(history)

    await expect(call(IPC_CHANNELS.COMFY_QUEUE, ' prompt-42 ')).resolves.toEqual(queue)
    await expect(call(IPC_CHANNELS.COMFY_HISTORY, ' prompt-42 ')).resolves.toEqual(history)
    expect(mocks.queue).toHaveBeenCalledWith('prompt-42')
    expect(mocks.history).toHaveBeenCalledWith('prompt-42')
  })

  it('rejects a history request without a prompt id instead of querying the wrong entry', async () => {
    await expect(call(IPC_CHANNELS.COMFY_HISTORY)).rejects.toThrow('不能为空')
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('surfaces ComfyUI HTTP errors through IPC', async () => {
    mocks.queue.mockRejectedValue(new Error('ComfyUI HTTP 503'))

    await expect(call(IPC_CHANNELS.COMFY_QUEUE)).rejects.toThrow('ComfyUI HTTP 503')
  })
})

describe('ComfyUI workflow import IPC', () => {
  it('keeps accepting API JSON without asking for node definitions', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\workflows\\api.json'] })
    mocks.readFileSync.mockReturnValue('{"1":{"class_type":"KSampler","inputs":{}}}')
    const raw = { '1': { class_type: 'KSampler', inputs: {} } }
    mocks.parseWorkflow.mockReturnValue(raw)

    await call(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT)

    expect(mocks.parseWorkflow).toHaveBeenCalledWith(raw)
    expect(mocks.objectInfo).not.toHaveBeenCalled()
    expect(mocks.importWorkflow).toHaveBeenCalledWith('api', raw, 'imported', [])
  })

  it('converts explicit frontend graph JSON with object_info widget order and persists warnings', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\workflows\\frontend.json'] })
    mocks.readFileSync.mockReturnValue('{"nodes":[{"id":1,"type":"KSampler"}],"links":[]}')
    mocks.isFrontend.mockReturnValue(true)
    const raw = { nodes: [{ id: 1, type: 'KSampler' }], links: [] }
    const objectInfo = { KSampler: { input: { required: { seed: ['INT', {}], steps: ['INT', {}] } } } }
    mocks.objectInfo.mockResolvedValue(objectInfo)
    mocks.parseFrontend.mockReturnValue({ workflow: { '1': { class_type: 'KSampler', inputs: {} } }, warnings: ['转换警告'] })

    await call(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT)

    expect(mocks.parseFrontend).toHaveBeenCalledWith(raw, { objectInfo })
    expect(mocks.importWorkflow).toHaveBeenCalledWith('frontend', { '1': { class_type: 'KSampler', inputs: {} } }, 'imported', ['转换警告'])
  })

  it('retains the import failure when complete node definitions are unavailable', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\workflows\\offline.json'] })
    mocks.readFileSync.mockReturnValue('{"nodes":[{"id":1,"type":"CustomText","inputs":[{"name":"text","link":null,"widget":{"name":"text"}}],"widgets_values":["hello"]}],"links":[]}')
    mocks.isFrontend.mockReturnValue(true)
    mocks.objectInfo.mockRejectedValue(new Error('ComfyUI 未连接'))

    await expect(call(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT)).rejects.toThrow('未连接')
    expect(mocks.parseFrontend).not.toHaveBeenCalled()
    expect(mocks.importWorkflow).not.toHaveBeenCalled()
  })

  it('rejects a selected JSON file exceeding 10MiB before reading or storing it', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\workflows\\large.json'] })
    mocks.statSync.mockReturnValue({ size: 10 * 1024 * 1024 + 1, isFile: () => true })
    await expect(call(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT)).rejects.toMatchObject({ code: 'COMFY_WORKFLOW_INVALID', retryable: false })
    expect(mocks.readFileSync).not.toHaveBeenCalled()
    expect(mocks.importWorkflow).not.toHaveBeenCalled()
  })

  it('imports a selected remote graph through the existing database workflow service', async () => {
    const raw = { nodes: [{ id: 9, type: 'Text', widgets_values: ['remote'] }], links: [] }
    mocks.remoteWorkflows.mockResolvedValue(['sub/remote'])
    mocks.readRemoteWorkflow.mockResolvedValue(raw)
    mocks.isFrontend.mockReturnValue(true)
    await expect(call('comfy:workflows:remoteList')).resolves.toEqual(['sub/remote'])
    await call('comfy:workflows:remoteImport', 'sub/remote')
    expect(mocks.readRemoteWorkflow).toHaveBeenCalledWith('sub/remote')
    expect(mocks.parseFrontend).toHaveBeenCalledWith(raw, { objectInfo: {} })
    expect(mocks.importWorkflow).toHaveBeenCalledWith('sub/remote', expect.any(Object), 'remote', [])
  })
})
