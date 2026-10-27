import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../source/src/renderer/i18n/resolver'
import { OPEN_MAIN_ROUTE_EVENT } from '../../source/src/renderer/services/mainWindowNavigation'
import { toast } from '../../source/src/renderer/services/toast'
import type { DataRequest, DataResponse } from '../../source/src/shared/data/api/types'
import type { IpcResult } from '../../source/src/shared/ipc/errors/IpcError'

const externalParams = vi.hoisted(() => ({ taskId: undefined as string | undefined }))
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...await importOriginal<typeof import('./shims/tanstack-router')>(),
  // Parent-owned parameter seam only. TasksSettings has no parameter prop; this
  // supplies exactly what source useParams reads, without changing its queries.
  // It is NOT evidence that the current production router already handles taskId.
  useParams: () => ({ taskId: externalParams.taskId })
}))

import { CompatTasksSettings } from './CompatTasksSettings'

// Real source TasksSettings, useTasks/useQuery and native UI are imported. There
// are no task/agent rows or fake scheduling responses. Only the low-level preload
// transport refuses. The source's error toast is spied, not replaced by an error UI.
const originalApi = window.api
const dataRequest = vi.fn<(request: DataRequest) => Promise<DataResponse<unknown>>>()
const ipcRequest = vi.fn<(route: string, input?: unknown) => Promise<IpcResult<unknown>>>()

function dataRefusal(request: DataRequest): DataResponse<unknown> {
  return {
    id: request.id,
    status: 404,
    error: { code: 'NOT_BRIDGED', status: 404, message: 'TASK_READ_UNAVAILABLE: ' + request.path }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function mount(children: ReactNode) {
  const cache = new Map()
  return render(children, {
    wrapper: ({ children }) => <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  })
}

beforeEach(() => {
  externalParams.taskId = undefined
  dataRequest.mockReset().mockImplementation(async request => dataRefusal(request))
  ipcRequest.mockReset().mockImplementation(async route => ({
    ok: false,
    error: { code: 'NOT_IMPLEMENTED', message: 'TASK_COMMAND_UNAVAILABLE: ' + route }
  }))
  vi.spyOn(toast, 'error')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ...originalApi,
      ipcApi: { ...originalApi.ipcApi, request: ipcRequest },
      dataApi: { ...originalApi.dataApi, request: dataRequest }
    }
  })
  window.history.replaceState(null, '', '#/settings/scheduled-tasks')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
})

function expectReadOnlyTransport() {
  expect(dataRequest.mock.calls.every(([request]) => request.method === 'GET')).toBe(true)
  expect(ipcRequest.mock.calls.filter(([route]) => route.startsWith('ai.agent.task.'))).toEqual([])
}

describe('authentic scheduled-task source boundaries (external params supplied by router double)', () => {
  it('renders the source spinner and performs real reads inside the disabled native fieldset', async () => {
    const list = deferred<DataResponse<unknown>>()
    let listRequest: DataRequest | undefined
    dataRequest.mockImplementation(async request => {
      if (request.path === '/agent-tasks') {
        listRequest = request
        return list.promise
      }
      return dataRefusal(request)
    })
    mount(<CompatTasksSettings />)
    await waitFor(() => expect(listRequest?.path).toBe('/agent-tasks'))
    const fieldset = screen.getByRole('group', { name: '源定时任务设置' })
    expect(within(fieldset).getByText(i18n.t('common.loading'))).toBeInTheDocument()
    expect(fieldset).toBeDisabled()
    expect(within(fieldset).queryByRole('button')).toBeNull()
    expect(fieldset).toHaveAttribute('disabled')
    expectReadOnlyTransport()

    await act(async () => { list.resolve(dataRefusal(listRequest!)) })
    expect(await screen.findByText(i18n.t('settings.scheduledTasks.noAgentsTitle'))).toBeInTheDocument()
  })

  it('keeps the real empty-after-refusal state and error toast with truthful in-page form restrictions', async () => {
    mount(<CompatTasksSettings />)
    expect(await screen.findByText(i18n.t('settings.scheduledTasks.noAgentsTitle'))).toBeInTheDocument()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18n.t('agent.tasks.error.loadFailed')))
    const note = screen.getByRole('note', { name: '定时任务设置能力边界' })
    expect(note).toHaveTextContent('不代表查询成功或确实没有任务')
    expect(note).toHaveTextContent('页内原生表单和按钮操作已统一禁用')
    expect(note).toHaveTextContent('设置侧栏导航不受影响')
    const fieldset = screen.getByRole('group', { name: '源定时任务设置' })
    expect(fieldset).toBeDisabled()
    const create = within(fieldset).getByRole('button', { name: i18n.t('settings.scheduledTasks.newTask') })
    expect(create).toBeDisabled()
    expect(create).not.toHaveAttribute('disabled')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    const openAgents = within(fieldset).getByRole('button', { name: i18n.t('settings.scheduledTasks.agentCreate') })
    expect(openAgents).toBeDisabled()
    const navigation = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, navigation)
    try {
      await userEvent.setup().click(openAgents)
      expect(navigation).not.toHaveBeenCalled()
      expect(window.location.hash).toBe('#/settings/scheduled-tasks')
    } finally {
      window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, navigation)
    }
    expectReadOnlyTransport()
  })

  it('does not promise functional search when the native family fieldset is disabled', async () => {
    mount(<CompatTasksSettings />)
    expect(await screen.findByText(i18n.t('settings.scheduledTasks.noAgentsTitle'))).toBeInTheDocument()
    const fieldset = screen.getByRole('group', { name: '源定时任务设置' })
    const user = userEvent.setup()
    const trigger = within(fieldset).getByRole('button', { name: i18n.t('settings.scheduledTasks.search') })
    expect(trigger).toBeDisabled()
    expect(trigger).not.toHaveAttribute('disabled')
    await user.click(trigger)
    expect(within(fieldset).queryByRole('searchbox')).toBeNull()
    const search = within(fieldset).getByPlaceholderText(i18n.t('settings.scheduledTasks.searchPlaceholder'))
    expect(search).toBeDisabled()
    await user.type(search, 'summary')
    expect(search).toHaveValue('')
    expect(screen.getByRole('note', { name: '定时任务设置能力边界' })).toHaveTextContent('包括搜索、筛选、历史标签和返回')
    expectReadOnlyTransport()
  })

  it('uses the external taskId for the source not-found state with disabled back and no task form', async () => {
    externalParams.taskId = 'external-task'
    // Deliberately different: this test does not substitute URL parsing for the
    // externally supplied route parameter, or claim production parameter wiring.
    window.history.replaceState(null, '', '#/settings/scheduled-tasks/different-url-id')
    mount(<CompatTasksSettings />)
    expect(await screen.findByText(i18n.t('settings.scheduledTasks.notFoundTitle'))).toBeInTheDocument()
    expect(dataRequest.mock.calls.map(([request]) => request.path)).toContain('/agent-tasks/external-task')
    expect(dataRequest.mock.calls.map(([request]) => request.path)).not.toContain('/agent-tasks/different-url-id')
    expect(toast.error).toHaveBeenCalledWith(i18n.t('agent.tasks.error.loadFailed'))
    const fieldset = screen.getByRole('group', { name: '源定时任务设置' })
    expect(fieldset).toBeDisabled()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    const back = within(fieldset).getByRole('button', { name: i18n.t('common.back') })
    expect(back).toBeDisabled()
    expect(back).not.toHaveAttribute('disabled')
    await userEvent.setup().click(back)
    expect(window.location.hash).toBe('#/settings/scheduled-tasks/different-url-id')
    expectReadOnlyTransport()
  })

  it('reads updated external task parameters on rerender instead of retaining a first-mount task query', async () => {
    externalParams.taskId = 'first-task'
    const view = mount(<CompatTasksSettings />)
    await waitFor(() => expect(dataRequest.mock.calls.map(([request]) => request.path)).toContain('/agent-tasks/first-task'))
    expect(await screen.findByText(i18n.t('settings.scheduledTasks.notFoundTitle'))).toBeInTheDocument()
    externalParams.taskId = 'second-task'
    view.rerender(<CompatTasksSettings />)
    await waitFor(() => expect(dataRequest.mock.calls.map(([request]) => request.path)).toContain('/agent-tasks/second-task'))
    expect(await screen.findByText(i18n.t('settings.scheduledTasks.notFoundTitle'))).toBeInTheDocument()
    expectReadOnlyTransport()
  })
})
