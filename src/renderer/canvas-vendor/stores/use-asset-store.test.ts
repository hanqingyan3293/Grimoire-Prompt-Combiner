// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset } from './use-asset-store'

const asset: Asset = { id: 'image:1', kind: 'image', title: 'fixture image', coverUrl: 'data:image/png;base64,fixture', tags: [], createdAt: '', updatedAt: '', data: { dataUrl: 'data:image/png;base64,fixture', width: 1, height: 1, bytes: 69, mimeType: 'image/png' } }
const api = {
  images: { list: vi.fn(async () => []), readData: vi.fn(async () => 'data:image/png;base64,fixture'), delete: vi.fn(async () => true) },
  promptAssets: { list: vi.fn(async () => ({ items: [], total: 0 })), delete: vi.fn(async () => true) },
  tags: { getAll: vi.fn(async () => ({ tags: [] })), assetLinks: { list: vi.fn(async () => []) } },
}
let store: typeof import('./use-asset-store').useAssetStore
let settle: ((result: boolean) => void) | undefined
beforeAll(async () => {
  Object.assign(window, { api })
  store = (await import('./use-asset-store')).useAssetStore
  await vi.waitFor(() => expect(store.getState().hydrated).toBe(true))
})
beforeEach(() => {
  vi.clearAllMocks()
  api.images.delete.mockResolvedValue(true)
  api.promptAssets.delete.mockResolvedValue(true)
  store.setState({ assets: [asset], hydrated: true })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(async () => { settle?.(true); settle = undefined; await store.getState().refresh(); vi.restoreAllMocks() })

describe('canvas asset deletion adapter', () => {
  it('preserves the asset and returns the main reference failure to its caller', async () => {
    api.images.delete.mockRejectedValueOnce(new Error('ASSET_IN_USE: image is referenced by two versions'))
    await expect(Promise.resolve(store.getState().removeAsset('image:1'))).rejects.toThrow(/ASSET_IN_USE/)
    expect(store.getState().assets.map(item => item.id)).toEqual(['image:1'])
  })

  it('keeps a pending asset visible until the main deletion actually succeeds', async () => {
    api.images.delete.mockImplementationOnce(() => new Promise<boolean>(resolve => { settle = resolve }))
    const completion = store.getState().removeAsset('image:1')
    try { expect(store.getState().assets.map(item => item.id)).toEqual(['image:1']) }
    finally { settle?.(true); await Promise.resolve(completion) }
    expect(store.getState().assets).toEqual([])
  })

  it('does not treat a false backend result as completed deletion', async () => {
    api.images.delete.mockResolvedValueOnce(false)
    await expect(Promise.resolve(store.getState().removeAsset('image:1'))).rejects.toThrow()
    expect(store.getState().assets.map(item => item.id)).toEqual(['image:1'])
  })

  it('also preserves a prompt asset after its main deletion fails', async () => {
    store.setState({ assets: [{ id: 'prompt:asset-1', kind: 'text', title: 'prompt fixture', coverUrl: '', tags: [], createdAt: '', updatedAt: '', data: { content: 'portrait' } }] })
    api.promptAssets.delete.mockRejectedValueOnce(new Error('prompt deletion failed'))
    await expect(Promise.resolve(store.getState().removeAsset('prompt:asset-1'))).rejects.toThrow(/prompt deletion failed/)
    expect(store.getState().assets.map(item => item.id)).toEqual(['prompt:asset-1'])
  })

  it('removes an unlinked local entry without deleting another library entity', async () => {
    store.setState({ assets: [{ ...asset, id: 'local-entry' }] })
    await Promise.resolve(store.getState().removeAsset('local-entry'))
    expect(store.getState().assets).toEqual([])
    expect(api.images.delete).not.toHaveBeenCalled()
    expect(api.promptAssets.delete).not.toHaveBeenCalled()
  })
})
