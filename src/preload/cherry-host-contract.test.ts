import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { GrimoireAPI } from '../renderer/global'
import type { ActualPreloadApi } from './index'
import type { CherryCacheSyncMessage, CherryDataApiDataChangeEffect, CherryDataApiRequest } from '../shared/cherry-preload-types'

const mocks = vi.hoisted(() => ({
  expose: vi.fn<(name: string, api: unknown) => void>(),
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
  on: vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>(),
  remove: vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove },
  webUtils: {}
}))
import './index'

const exposed = mocks.expose.mock.calls.find(([name]) => name === 'api')?.[1]
if (!exposed || typeof exposed !== 'object') throw new Error('Preload did not expose api')
const api = exposed as ActualPreloadApi

type ClosedMembers = 'application' | 'shortcut' | 'providers' | 'dataApi' | 'cache'
beforeEach(() => { mocks.invoke.mockReset(); mocks.on.mockClear(); mocks.remove.mockClear() })

describe('actual source-facing preload contract', () => {
  it('keeps the declared bounded members assignable from the actual implementation', () => {
    expectTypeOf<Pick<ActualPreloadApi, ClosedMembers>>().toExtend<Pick<GrimoireAPI, ClosedMembers>>()
    expect(Object.keys(api.application)).toEqual(['relaunch'])
    expect(Object.keys(api.shortcut)).toEqual(['onRegistrationConflict'])
    expect(Object.keys(api.settings)).toEqual(['getAll', 'set'])
    expect(Object.keys(api.providers)).toEqual(['list', 'save', 'delete', 'setActive', 'fetchModels', 'test', 'fetchModelsForProvider', 'testProvider'])
  })

  it('passes typed DataApi envelopes through the actual preload and unsubscribes exactly its listener', async () => {
    const request: CherryDataApiRequest = { id: 'r1', method: 'GET', path: '/agents', params: { limit: 5 } }
    const response = { id: 'r1', status: 200, data: { items: [] } }
    mocks.invoke.mockResolvedValueOnce(response)
    await expect(api.dataApi.request(request)).resolves.toBe(response)
    expect(mocks.invoke).toHaveBeenCalledWith('cherry:dataApi:request', request)
    const callback = vi.fn<(effects: CherryDataApiDataChangeEffect[]) => void>()
    const stop = api.dataApi.onDataChanged(callback)
    const [channel, listener] = mocks.on.mock.calls[0]
    const effects: CherryDataApiDataChangeEffect[] = [{ endpoint: '/agents', kind: 'projection', entityIds: ['a1'] }]
    listener({ secret: 'main-only' }, effects)
    expect(callback).toHaveBeenCalledExactlyOnceWith(effects)
    stop()
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(channel, listener)
  })

  it('delivers typed cache sync payloads without exposing Electron events', () => {
    const message: CherryCacheSyncMessage = { type: 'shared', key: 'mcp.status.s1', value: 'connected' }
    const callback = vi.fn<(payload: CherryCacheSyncMessage) => void>()
    const stop = api.cache.onSync(callback)
    const [channel, listener] = mocks.on.mock.calls[0]
    expect(channel).toBe('cache:sync')
    listener({ sender: 'main-only' }, message)
    expect(callback).toHaveBeenCalledExactlyOnceWith(message)
    stop()
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(channel, listener)
  })

  it('routes relaunch to its existing handler, not to a fabricated application API', async () => {
    mocks.invoke.mockResolvedValueOnce(true)
    await expect(api.application.relaunch()).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('cherry:app:relaunch')
  })

  it('does not expose blocked source capabilities', () => {
    for (const member of ['backup', 'nutstore', 'copilot', 'preference']) expect(api).not.toHaveProperty(member)
    for (const member of ['select', 'readExternal', 'saveImage', 'getPhysicalPath', 'createInternalEntry', 'move', 'rename', 'mkdir']) expect(api.file).not.toHaveProperty(member)
  })
})
