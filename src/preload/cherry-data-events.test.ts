import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  expose: vi.fn<(name: string, api: unknown) => void>(),
  on: vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>(),
  removeListener: vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: vi.fn(), on: mocks.on, removeListener: mocks.removeListener },
  webUtils: {}
}))

import './index'

// Capture the actual exposed preload at module initialization, before clearMocks.
const exposed = mocks.expose.mock.calls.find(([name]) => name === 'api')?.[1]
function dataEvents(api: unknown): { onDataChanged: (callback: (effects: unknown) => void) => () => void } {
  if (!api || typeof api !== 'object' || !('dataApi' in api)) throw new Error('Missing preload DataApi')
  const dataApi = api.dataApi
  if (!dataApi || typeof dataApi !== 'object' || !('onDataChanged' in dataApi) || typeof dataApi.onDataChanged !== 'function') {
    throw new Error('Missing preload data-change subscription')
  }
  return dataApi as { onDataChanged: (callback: (effects: unknown) => void) => () => void }
}
const api = dataEvents(exposed)

beforeEach(() => {
  mocks.on.mockClear()
  mocks.removeListener.mockClear()
})

describe('source DataApi preload change events', () => {
  it('maps source navigation events to the same actual channel the main adapter sends', () => {
    if (!exposed || typeof exposed !== 'object' || !('ipcApi' in exposed)) throw new Error('Missing preload IPC')
    const ipc = exposed.ipcApi
    if (!ipc || typeof ipc !== 'object' || !('on' in ipc) || typeof ipc.on !== 'function') throw new Error('Missing IPC events')
    const callback = vi.fn<(payload: unknown) => void>()
    const stop = ipc.on('navigation.open_route_requested', callback)
    expect(mocks.on).toHaveBeenCalledOnce()
    const [channel, listener] = mocks.on.mock.calls[0]
    expect(channel).toBe('cherry:navigation:openRouteRequested')
    listener({ sender: 'main-event' }, { to: '/app/launchpad' })
    expect(callback).toHaveBeenCalledExactlyOnceWith({ to: '/app/launchpad' })
    stop()
    expect(mocks.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener)
  })

  it('maps source file-tree mutations to the dedicated owner push channel', () => {
    if (!exposed || typeof exposed !== 'object' || !('ipcApi' in exposed)) throw new Error('Missing preload IPC')
    const ipc = exposed.ipcApi
    if (!ipc || typeof ipc !== 'object' || !('on' in ipc) || typeof ipc.on !== 'function') throw new Error('Missing IPC events')
    const callback = vi.fn<(payload: unknown) => void>()
    const stop = ipc.on('file.tree.mutation', callback)
    expect(mocks.on).toHaveBeenCalledOnce()
    const [channel, listener] = mocks.on.mock.calls[0]
    expect(channel).toBe('cherry:file:treeMutation')
    const payload = { treeId: 'tree-1', revision: 1, changes: [] }
    listener({}, payload)
    expect(callback).toHaveBeenCalledExactlyOnceWith(payload)
    stop()
    expect(mocks.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener)
  })

  it('delivers effects without leaking the Electron event to the renderer', () => {
    const callback = vi.fn<(effects: unknown) => void>()
    api.onDataChanged(callback)
    expect(mocks.on).toHaveBeenCalledOnce()
    const [channel, listener] = mocks.on.mock.calls[0]
    expect(channel).toBe('data-api:data-changed')
    const effects = [{ endpoint: '/agents', kind: 'projection', entityIds: ['agent-1'] }]
    listener({ sender: 'main-only-event' }, effects)
    expect(callback).toHaveBeenCalledExactlyOnceWith(effects)
  })

  it('unsubscribes precisely its own listener, leaving other subscriptions intact', () => {
    const first = vi.fn<(effects: unknown) => void>()
    const second = vi.fn<(effects: unknown) => void>()
    const stopFirst = api.onDataChanged(first)
    const stopSecond = api.onDataChanged(second)
    const firstListener = mocks.on.mock.calls[0][1]
    const secondListener = mocks.on.mock.calls[1][1]
    expect(firstListener).not.toBe(secondListener)
    stopFirst()
    expect(mocks.removeListener).toHaveBeenCalledExactlyOnceWith('data-api:data-changed', firstListener)
    secondListener({}, [{ endpoint: '/agents' }])
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    stopSecond()
    expect(mocks.removeListener).toHaveBeenLastCalledWith('data-api:data-changed', secondListener)
  })
})
