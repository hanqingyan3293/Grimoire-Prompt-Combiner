// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from './use-canvas-store'

const initial: CanvasProject = { id: 'project-1', title: 'queue fixture', createdAt: '', updatedAt: '', revision: 0, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }
let persisted = structuredClone(initial)
const save = vi.fn(async (_id: string, value: CanvasProject) => {
  if (value.revision !== persisted.revision + 1) throw new Error('revision CAS fixture')
  persisted = structuredClone(value)
  return structuredClone(persisted)
})
const api = { list: vi.fn(async () => [{ id: initial.id }]), get: vi.fn(async () => structuredClone(persisted)), save, create: vi.fn(), delete: vi.fn() }
let module: typeof import('./use-canvas-store')
beforeAll(async () => {
  Object.assign(window, { api: { canvas: { vendor: api } } })
  module = await import('./use-canvas-store')
  await vi.waitFor(() => expect(module.useCanvasStore.getState().hydrated).toBe(true))
})
beforeEach(async () => {
  await module.useCanvasStore.getState().retrySaves()
  vi.clearAllMocks()
  localStorage.clear()
  persisted = structuredClone(initial)
  module.useCanvasStore.getState().replaceProjects([])
  await module.useCanvasStore.getState().retryHydration()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(async () => { await module.useCanvasStore.getState().retrySaves(); vi.restoreAllMocks() })

describe('Canvas authoritative transfer flush', () => {
  it('coalesces queued renames without skipping the canonical CAS base', async () => {
    const store = module.useCanvasStore.getState()
    store.renameProject(initial.id, 'first rename')
    store.renameProject(initial.id, 'latest rename')
    await store.retrySaves()
    expect(persisted.title).toBe('latest rename')
    expect(module.useCanvasStore.getState().saveError).toBeNull()
  })
  it('serializes rapid edits against the previous real save ACK rather than a speculative revision', async () => {
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    save.mockImplementationOnce(async (_id, value) => { await barrier; persisted = structuredClone(value); return structuredClone(persisted) })
    const store = module.useCanvasStore.getState()
    store.updateProject(initial.id, { viewport: { x: 1, y: 0, k: 1 } })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    store.updateProject(initial.id, { viewport: { x: 2, y: 0, k: 1 } })
    store.updateProject(initial.id, { viewport: { x: 3, y: 0, k: 1 } })
    release()
    await store.retrySaves()
    expect(persisted.viewport.x).toBe(3)
    expect(module.useCanvasStore.getState().saveError).toBeNull()
  })

  it('keeps the original in-memory edits and rejects a settled-but-failed save queue', async () => {
    save.mockRejectedValueOnce(new Error('disk write fixture'))
    module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 55, y: 6, k: 1.5 } })
    await expect(module.flushCanvasSaves()).rejects.toThrow('CANVAS_SAVE_FAILED')
    expect(persisted.viewport).toEqual(initial.viewport)
    expect(module.useCanvasStore.getState().openProject(initial.id)?.viewport.x).toBe(55)
    await module.useCanvasStore.getState().retrySaves()
    await expect(module.flushCanvasSaves()).resolves.toBeUndefined()
    expect(persisted.viewport.x).toBe(55)
  })

  it('hydrates a transfer from canonical storage without preferring a newer local recovery snapshot', async () => {
    persisted = { ...structuredClone(initial), revision: 4, viewport: { x: 40, y: 4, k: 1 } }
    localStorage.setItem('grimoire.canvas.vendor.snapshot.project-1', JSON.stringify({ ...initial, revision: 99, viewport: { x: 999, y: 0, k: 1 } }))
    await expect(module.hydrateCanvasTransferProject(initial.id, 4)).resolves.toEqual(persisted)
    expect(module.useCanvasStore.getState().openProject(initial.id)?.viewport.x).toBe(40)
    await module.useCanvasStore.getState().retryHydration()
    expect(module.useCanvasStore.getState().openProject(initial.id)?.viewport.x).toBe(40)
    await expect(module.hydrateCanvasTransferProject(initial.id, 5)).rejects.toThrow('CANVAS_REVISION_NOT_READY')
  })

  it('recovers local edits without treating their speculative revision as the persisted CAS base', async () => {
    localStorage.setItem('grimoire.canvas.vendor.snapshot.project-1', JSON.stringify({ version: 1, baseRevision: 0, project: { ...initial, revision: 20, viewport: { x: 200, y: 0, k: 1 } } }))
    await module.useCanvasStore.getState().retryHydration()
    expect(module.useCanvasStore.getState().openProject(initial.id)?.viewport.x).toBe(200)
    module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 201, y: 0, k: 1 } })
    await expect(module.flushCanvasSaves()).resolves.toBeUndefined()
    expect(persisted.viewport.x).toBe(201)
  })

  it('does not attach an old owner recovery cache to a newer canonical revision', async () => {
    persisted = { ...structuredClone(initial), title: 'new owner content', revision: 4, viewport: { x: 40, y: 0, k: 1 } }
    const legacySnapshot = { ...initial, title: 'old owner content', revision: 99, viewport: { x: 999, y: 0, k: 1 } }
    localStorage.setItem('grimoire.canvas.vendor.snapshot.project-1', JSON.stringify(legacySnapshot))
    await module.useCanvasStore.getState().retryHydration()
    module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 1000, y: 0, k: 1 } })
    await expect(module.flushCanvasSaves()).rejects.toThrow('CANVAS_RECOVERY_CONFLICT')
    expect(persisted.title).toBe('new owner content')
    expect(persisted.revision).toBe(4)
    expect(localStorage.getItem('grimoire.canvas.vendor.snapshot.project-1')).toBe(JSON.stringify(legacySnapshot))
  })

  it('recovers a versioned snapshot only from its recorded canonical base', async () => {
    const recovered = { ...initial, revision: 20, viewport: { x: 200, y: 0, k: 1 } }
    localStorage.setItem('grimoire.canvas.vendor.snapshot.project-1', JSON.stringify({ version: 1, baseRevision: 0, project: recovered }))
    await module.useCanvasStore.getState().retryHydration()
    expect(module.useCanvasStore.getState().openProject(initial.id)?.viewport.x).toBe(200)
    module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 201, y: 0, k: 1 } })
    await expect(module.flushCanvasSaves()).resolves.toBeUndefined()
    expect(persisted.viewport.x).toBe(201)
  })

  it('refuses autosave and viewport writes from a stale live document base', async () => {
    persisted = { ...structuredClone(initial), revision: 4, viewport: { x: 40, y: 0, k: 1 } }
    await module.useCanvasStore.getState().retryHydration()
    expect(module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 999, y: 0, k: 1 } }, 0)).toBe(false)
    await expect(module.flushCanvasSaves()).rejects.toThrow('CANVAS_REVISION_CONFLICT')
    expect(persisted.revision).toBe(4)
    expect(persisted.viewport.x).toBe(40)
    expect(module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 41, y: 0, k: 1 } }, 4)).toBe(true)
    await expect(module.flushCanvasSaves()).resolves.toBeUndefined()
    expect(persisted.viewport.x).toBe(41)
  })

  it('replaces an unsaved queue only after an explicit remote reload succeeds', async () => {
    save.mockRejectedValueOnce(new Error('disk write fixture'))
    module.useCanvasStore.getState().updateProject(initial.id, { viewport: { x: 55, y: 0, k: 1 } })
    await expect(module.flushCanvasSaves()).rejects.toThrow('CANVAS_SAVE_FAILED')
    const cache = localStorage.getItem('grimoire.canvas.vendor.snapshot.project-1')
    api.get.mockRejectedValueOnce(new Error('remote read fixture'))
    await expect(module.hydrateCanvasTransferProject(initial.id, 0, true)).rejects.toThrow('remote read fixture')
    expect(module.useCanvasStore.getState().openProject(initial.id)?.viewport.x).toBe(55)
    expect(localStorage.getItem('grimoire.canvas.vendor.snapshot.project-1')).toBe(cache)
    await expect(module.hydrateCanvasTransferProject(initial.id, 0, true)).resolves.toEqual(initial)
    await expect(module.flushCanvasSaves()).resolves.toBeUndefined()
    expect(persisted.viewport.x).toBe(0)
  })

  it('publishes each own save ACK while a newer local document is still queued', async () => {
    let releaseA!: () => void; let releaseB!: () => void
    const a=new Promise<void>(resolve=>{releaseA=resolve}), b=new Promise<void>(resolve=>{releaseB=resolve})
    save.mockImplementationOnce(async (_id,value)=>{await a; persisted=structuredClone(value); return structuredClone(persisted)})
    save.mockImplementationOnce(async (_id,value)=>{await b; persisted=structuredClone(value); return structuredClone(persisted)})
    try {
      module.useCanvasStore.getState().updateProject(initial.id,{viewport:{x:1,y:0,k:1}},0)
      await vi.waitFor(()=>expect(save).toHaveBeenCalledTimes(1))
      module.useCanvasStore.getState().updateProject(initial.id,{viewport:{x:2,y:0,k:1}},0)
      releaseA(); await vi.waitFor(()=>expect(save).toHaveBeenCalledTimes(2))
      expect(module.useCanvasStore.getState().localSaveRevisions?.[initial.id]).toBe(1)
      expect(module.useCanvasStore.getState().updateProject(initial.id,{viewport:{x:3,y:0,k:1}},1)).toBe(true)
      releaseB(); await module.flushCanvasSaves()
      expect(persisted.viewport.x).toBe(3)
      expect(module.useCanvasStore.getState().saveError).toBeNull()
    } finally { releaseA(); releaseB(); await module.useCanvasStore.getState().retrySaves() }
  })

  it('does not let an old in-flight refresh downgrade a rename ACK', async () => {
    let release!: () => void; let captured=false
    const held=new Promise<void>(resolve=>{release=resolve})
    api.get.mockImplementationOnce(async()=>{const old=structuredClone(persisted);captured=true;await held;return old})
    const refresh=module.useCanvasStore.getState().retryHydration()
    try {
      await vi.waitFor(()=>expect(captured).toBe(true))
      module.useCanvasStore.getState().renameProject(initial.id,'acknowledged rename')
      await module.useCanvasStore.getState().retrySaves()
      release(); await refresh
      expect(module.getCommittedCanvasProjectRevision(initial.id)).toBe(1)
      expect(module.useCanvasStore.getState().openProject(initial.id)?.title).toBe('acknowledged rename')
      await expect(module.flushCanvasSaves()).resolves.toBeUndefined()
    } finally { release(); await refresh }
  })
})
