import { describe, expect, it, vi } from 'vitest'
import { CherryFileTreeError } from '../services/cherry-file-tree.service'
import { createCherryFileTreeRouteHandler } from './cherry-file-tree.ipc'

function sender() { return { isDestroyed: () => false, send: vi.fn() } as never }

describe('Cherry file tree IPC adapter', () => {
  it('validates and preserves source create/activate/dispose envelopes', async () => {
    const owner = sender(), service = {
      create: vi.fn(async () => ({ treeId: 'tree-1', revision: 0, snapshot: { kind: 'directory' as const, path: 'C:/workspace', basename: 'workspace', children: {} } })),
      activate: vi.fn(() => true),
      dispose: vi.fn(async () => true),
      disposeAll: vi.fn(async () => undefined)
    }
    const handle = createCherryFileTreeRouteHandler(service)
    expect(await handle('file.tree.create', { rootPath: 'C:/workspace', options: { maxDepth: 1 } }, owner)).toMatchObject({ ok: true, data: { treeId: 'tree-1', revision: 0 } })
    expect(service.create).toHaveBeenCalledWith(owner, 'C:/workspace', { maxDepth: 1 })
    expect(await handle('file.tree.activate', { treeId: 'tree-1', revision: 0 }, owner)).toEqual({ ok: true, data: true })
    expect(await handle('file.tree.dispose', { treeId: 'tree-1' }, owner)).toEqual({ ok: true, data: undefined })
    expect(service.activate).toHaveBeenCalledWith(owner, 'tree-1', 0)
    expect(service.dispose).toHaveBeenCalledWith(owner, 'tree-1')
  })
  it('rejects unknown fields and never exposes filesystem errors', async () => {
    const owner = sender(), handle = createCherryFileTreeRouteHandler({ create: vi.fn(), activate: vi.fn(), dispose: vi.fn(), disposeAll: vi.fn() })
    expect(await handle('file.tree.create', { rootPath: 'C:/workspace', secret: 'x' }, owner)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    const service = { create: vi.fn(async () => { throw new CherryFileTreeError('ROOT_UNAVAILABLE', 'C:/private/path') }), activate: vi.fn(), dispose: vi.fn(), disposeAll: vi.fn() }
    expect(await createCherryFileTreeRouteHandler(service)('file.tree.create', { rootPath: 'C:/workspace' }, owner)).toMatchObject({ ok: false, error: { code: 'ROOT_UNAVAILABLE' } })
    expect(JSON.stringify(await createCherryFileTreeRouteHandler(service)('file.tree.create', { rootPath: 'C:/workspace' }, owner))).not.toContain('C:/private/path')
  })
  it('rejects unavailable owners and malformed activation before reaching the service', async () => {
    const service = { create: vi.fn(), activate: vi.fn(), dispose: vi.fn(), disposeAll: vi.fn() }
    const handle = createCherryFileTreeRouteHandler(service)
    expect(await handle('file.tree.create', { rootPath: 'C:/workspace' }, null)).toMatchObject({ ok: false, error: { code: 'OWNER_UNAVAILABLE' } })
    for (const revision of [-1, 0.5, NaN, Infinity, '0']) {
      expect(await handle('file.tree.activate', { treeId: 'tree-1', revision }, sender())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
    expect(await handle('file.tree.dispose', { treeId: '' }, sender())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(service.create).not.toHaveBeenCalled()
    expect(service.activate).not.toHaveBeenCalled()
    expect(service.dispose).not.toHaveBeenCalled()
  })

  it('refuses rename rather than claiming a mutation', async () => {
    const handle = createCherryFileTreeRouteHandler({ create: vi.fn(), activate: vi.fn(), dispose: vi.fn(), disposeAll: vi.fn() })
    expect(await handle('file.tree.rename', { treeId: 'tree-1', oldPath: 'C:/workspace/a', newName: 'b' }, sender())).toMatchObject({ ok: false, error: { code: 'RENAME_UNSUPPORTED' } })
  })
})
