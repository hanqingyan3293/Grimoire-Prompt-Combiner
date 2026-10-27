import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemSkillDialog } from '../../source/src/renderer/components/resourceCatalog/dialogs/skill/SystemSkillDialog'
import i18n from '../../source/src/renderer/i18n/resolver'
import type { DataRequest, DataResponse } from '../../source/src/shared/data/api/types'
import type { IpcResult } from '../../source/src/shared/ipc/errors/IpcError'
import { CompatSkillDetails, CompatSkillsSettings } from './CompatSkillsSettings'

// Real source pages, ResourceCatalogView/ResourceGrid, query hooks, IPC facade,
// native UI and SkillLauncherProvider are imported. Only the external preload
// transports are doubles; every catalog/discovery/detail response is a REFUSAL.
// No TabsProvider, catalog fixture, file path or successful service is supplied.
const originalApi = window.api
const ipcRequest = vi.fn<(route: string, input?: unknown) => Promise<IpcResult<unknown>>>()
const dataRequest = vi.fn<(request: DataRequest) => Promise<DataResponse<unknown>>>()

function ipcRefusal(route: string): IpcResult<unknown> {
  return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'SKILL_SERVICE_UNAVAILABLE: ' + route } }
}

function dataRefusal(request: DataRequest): DataResponse<unknown> {
  return {
    id: request.id,
    status: 404,
    error: { code: 'NOT_BRIDGED', status: 404, message: 'SKILL_READ_UNAVAILABLE: ' + request.path }
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
  ipcRequest.mockReset().mockImplementation(async route => ipcRefusal(route))
  dataRequest.mockReset().mockImplementation(async request => dataRefusal(request))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ...originalApi,
      ipcApi: { ...originalApi.ipcApi, request: ipcRequest },
      dataApi: { ...originalApi.dataApi, request: dataRequest }
    }
  })
  window.history.replaceState(null, '', '#/settings/skills')
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
})

function expectNoSkillCommands() {
  // The source catalog automatically attempts reconciliation on mount. That
  // request is refused too; allowing the ATTEMPT is not executing a service.
  const allowedRefusedReads = new Set(['skill.list_catalog', 'skill.discover_system', 'skill.folder.resolve', 'skill.reconcile'])
  expect(ipcRequest.mock.calls.filter(([route]) => !allowedRefusedReads.has(route))).toEqual([])
  expect(dataRequest.mock.calls.every(([request]) => request.method === 'GET')).toBe(true)
}

describe('authentic SkillsSettings/SkillDetails refusal boundaries', () => {
  it('keeps source loading and real reads while React renders a disabled family fieldset', async () => {
    const catalog = deferred<IpcResult<unknown>>()
    ipcRequest.mockImplementation(async route => route === 'skill.list_catalog' ? catalog.promise : ipcRefusal(route))
    mount(<CompatSkillsSettings />)

    expect(await screen.findByTestId('resource-grid-loading')).toBeInTheDocument()
    const fieldset = screen.getByRole('group', { name: '源技能设置' })
    expect(fieldset).toBeDisabled()
    const add = within(fieldset).getByRole('button', { name: i18n.t('library.skill_add.add') })
    expect(add).toBeDisabled()
    expect(add).not.toHaveAttribute('disabled')
    const system = within(fieldset).getByRole('tab', { name: i18n.t('settings.skills.tabs.system') })
    expect(system).toBeDisabled()
    expect(system).toHaveAttribute('aria-selected', 'false')
    expect(within(fieldset).getByRole('button', { name: i18n.t('common.layout.two_columns') })).toBeDisabled()
    const search = within(fieldset).getByRole('button', { name: i18n.t('common.search') })
    expect(search).toBeDisabled()
    await userEvent.setup().click(search)
    expect(within(fieldset).queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ipcRequest).toHaveBeenCalledWith('skill.list_catalog', {})
    expect(ipcRequest).toHaveBeenCalledWith('skill.reconcile', {})
    expect(screen.getByRole('note', { name: '技能设置能力边界' })).toHaveTextContent('包括搜索、范围标签、重试和返回')
    expectNoSkillCommands()

    await act(async () => { catalog.resolve(ipcRefusal('skill.list_catalog')) })
    expect(await screen.findByText('SKILL_SERVICE_UNAVAILABLE: skill.list_catalog')).toBeInTheDocument()
  })

  it('shows the genuine catalog error, not an empty catalog, and truthfully disables in-page retry', async () => {
    mount(<CompatSkillsSettings />)
    expect(await screen.findByText('SKILL_SERVICE_UNAVAILABLE: skill.list_catalog')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('library.empty_state.title'))).toBeNull()
    const fieldset = screen.getByRole('group', { name: '源技能设置' })
    const retry = within(fieldset).getByRole('button', { name: i18n.t('common.retry') })
    expect(fieldset).toBeDisabled()
    expect(retry).toBeDisabled()
    expect(retry).not.toHaveAttribute('disabled')
    const requestsBeforeRetry = ipcRequest.mock.calls.filter(([route]) => route === 'skill.list_catalog').length
    await userEvent.setup().click(retry)
    expect(ipcRequest.mock.calls.filter(([route]) => route === 'skill.list_catalog')).toHaveLength(requestsBeforeRetry)
    expect(await screen.findByText('SKILL_SERVICE_UNAVAILABLE: skill.list_catalog')).toBeInTheDocument()
    expect(screen.getByRole('note', { name: '技能设置能力边界' })).toHaveTextContent('不把失败当作空目录')
    expectNoSkillCommands()
  })

  it('passes the external skillId unchanged, keeps source loading/error and disables back without constructing a file browser', async () => {
    const detail = deferred<DataResponse<unknown>>()
    let detailRequest: DataRequest | undefined
    dataRequest.mockImplementation(async request => {
      if (request.path === '/skills/external-skill') {
        detailRequest = request
        return detail.promise
      }
      return dataRefusal(request)
    })
    window.history.replaceState(null, '', '#/settings/skills/different-url-id')
    const { container } = mount(<CompatSkillDetails skillId="external-skill" />)
    await waitFor(() => expect(detailRequest?.path).toBe('/skills/external-skill'))
    const fieldset = screen.getByRole('group', { name: '源技能详情' })
    expect(fieldset).toBeDisabled()
    // The source's two loading Skeletons, not a compat loading replacement.
    expect(fieldset.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
    expect(within(fieldset).queryByRole('button')).toBeNull()
    expect(ipcRequest).toHaveBeenCalledWith('skill.folder.resolve', { skillId: 'external-skill' })

    await act(async () => { detail.resolve(dataRefusal(detailRequest!)) })
    expect(await screen.findByText('SKILL_READ_UNAVAILABLE: /skills/external-skill')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.skills.notFound'))).toBeInTheDocument()
    expect(container.querySelector('[data-ui="skill-file-workspace"]')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    const back = within(fieldset).getByRole('button', { name: i18n.t('common.back') })
    expect(back).toBeDisabled()
    expect(back).not.toHaveAttribute('disabled')
    await userEvent.setup().click(back)
    expect(window.location.hash).toBe('#/settings/skills/different-url-id')
    expectNoSkillCommands()
  })

  it('reads a new external detail parameter on rerender rather than keeping a first-mount identity', async () => {
    const view = mount(<CompatSkillDetails skillId="first-skill" />)
    expect(await screen.findByText('SKILL_READ_UNAVAILABLE: /skills/first-skill')).toBeInTheDocument()
    view.rerender(<CompatSkillDetails skillId="second-skill" />)
    expect(await screen.findByText('SKILL_READ_UNAVAILABLE: /skills/second-skill')).toBeInTheDocument()
    expect(dataRequest.mock.calls.map(([request]) => request.path)).toEqual(expect.arrayContaining(['/skills/first-skill', '/skills/second-skill']))
    expect(ipcRequest).toHaveBeenCalledWith('skill.folder.resolve', { skillId: 'second-skill' })
    expectNoSkillCommands()
  })

  it('preserves the real system-discovery dialog error rather than creating directory/catalog rows', async () => {
    // Standalone hidden-source state test, not a claim that the disabled settings
    // fieldset can open this dialog. Real discovery refuses; no rows/paths are supplied.
    mount(<SystemSkillDialog mode="manage" open onOpenChange={vi.fn()} />)
    expect(await screen.findByText('SKILL_SERVICE_UNAVAILABLE: skill.discover_system')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('library.system_skill.empty_title'))).toBeNull()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(ipcRequest).toHaveBeenCalledWith('skill.discover_system', {})
    expectNoSkillCommands()
  })
})
