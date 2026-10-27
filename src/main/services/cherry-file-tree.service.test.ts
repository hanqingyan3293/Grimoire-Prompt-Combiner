import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, rename, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CherryFileTreeError, CherryFileTreeService } from './cherry-file-tree.service'
import { createDirectoryWatcher } from '../../integrations/cherry/file-tree/watcher'

type Root = { id: string; path: string; type: 'user' }
class FakeContents extends EventEmitter {
  readonly id = Math.floor(Math.random() * 100000) + 1
  private dead = false
  isDestroyed() { return this.dead }
  destroy() { this.dead = true; this.emit('destroyed') }
  navigate() { this.emit('did-start-navigation', {}, 'about:blank', false, true) }
}

describe('CherryFileTreeService', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
  async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'grimoire-tree-')); dirs.push(root)
    await mkdir(path.join(root, 'child')); await writeFile(path.join(root, 'a.txt'), 'a'); await writeFile(path.join(root, 'child', 'deep.txt'), 'deep')
    const events: unknown[] = []
    const sender = new FakeContents()
    const service = new CherryFileTreeService({ listWorkspaceRoots: () => [{ id: 'w', path: root, type: 'user' }], emit: (_sender, payload) => events.push(payload), createWatcher: (watchRoot, options) => createDirectoryWatcher(watchRoot, { ...options, usePolling: true }) })
    return { root, sender, service, events }
  }
  it('creates a real nonempty shallow snapshot, excludes grandchildren, and activates queued events', async () => {
    const { root, sender, service, events } = await fixture()
    const result = await service.create(sender as never, root, { maxDepth: 1, respectGitignore: false })
    expect(Object.keys(result.snapshot.children ?? {})).toEqual(expect.arrayContaining(['a.txt', 'child']))
    expect(JSON.stringify(result.snapshot)).not.toContain('deep.txt')
    await writeFile(path.join(root, 'new.txt'), 'new')
    await new Promise(resolve => setTimeout(resolve, 450))
    expect(events).toHaveLength(0)
    expect(service.activate(sender as never, result.treeId, result.revision)).toBe(true)
    await vi.waitFor(() => expect(events.some((event: any) => event.event?.type === 'added' && event.event.path.endsWith('/new.txt'))).toBe(true), { timeout: 5000 })
    await service.dispose(sender as never, result.treeId); await service.disposeAll()
  })
  it('returns a real empty tree for an existing empty root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'grimoire-empty-')); dirs.push(root)
    const sender = new FakeContents(); const service = new CherryFileTreeService({ listWorkspaceRoots: () => [{ id: 'w', path: root, type: 'user' }], emit: () => {}, createWatcher: (watchRoot, options) => createDirectoryWatcher(watchRoot, { ...options, usePolling: true }) })
    const result = await service.create(sender as never, root, { respectGitignore: false })
    expect(result.snapshot.children).toEqual({}); await service.disposeAll()
  })
  it('rejects missing roots, arbitrary roots, unsupported options and root symlink', async () => {
    const { root, sender, service } = await fixture()
    await expect(service.create(sender as never, path.join(root, 'missing'))).rejects.toMatchObject({ code: 'ROOT_UNAVAILABLE' })
    const outside = await mkdtemp(path.join(tmpdir(), 'grimoire-outside-')); dirs.push(outside)
    await expect(service.create(sender as never, outside)).rejects.toMatchObject({ code: 'ROOT_NOT_AUTHORIZED' })
    await expect(service.create(sender as never, root, { watchMissingRoot: true })).rejects.toMatchObject({ code: 'WATCH_MISSING_ROOT_UNSUPPORTED' })
    await expect(service.create(sender as never, root, { maxDepth: 2 })).rejects.toMatchObject({ code: 'UNSUPPORTED_DEPTH' })
    await service.disposeAll()
  })
  it('rejects wrong owner, rename, and symlink child without exposing it', async () => {
    const { root, sender, service } = await fixture(); const other = new FakeContents()
    const result = await service.create(sender as never, root, { respectGitignore: false })
    expect(() => service.activate(other as never, result.treeId, result.revision)).toThrowError(CherryFileTreeError)
    expect(() => service.rename(sender as never, result.treeId, path.join(root, 'a.txt'), 'b.txt')).toThrowError('RENAME_UNSUPPORTED')
    const target = await mkdtemp(path.join(tmpdir(), 'grimoire-link-target-')); dirs.push(target)
    try { await vi.waitFor(async () => { await writeFile(path.join(target, 'x.txt'), 'x') }, { timeout: 100 }) } catch {}
    // Windows junctions and POSIX symlinks are both refused by lstat/realpath guards.
    const link = path.join(root, 'link')
    try {
      const fs = await import('node:fs/promises'); await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
      const safeResult = await service.create(sender as never, root, { respectGitignore: false })
      expect(Object.keys(safeResult.snapshot.children ?? {})).not.toContain('link')
      await service.dispose(sender as never, safeResult.treeId)
    } catch (error: any) { if (!['EPERM', 'EACCES'].includes(error?.code)) throw error }
    await service.disposeAll()
  })
  it('closes watchers on destroy/navigation and cancels an inflight create', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'grimoire-inflight-')); dirs.push(root)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const sender = new FakeContents()
    const service = new CherryFileTreeService({
      listWorkspaceRoots: () => [{ id: 'w', path: root, type: 'user' }],
      emit: () => {},
      beforeScan: () => gate,
      createWatcher: (watchRoot, options) => createDirectoryWatcher(watchRoot, { ...options, usePolling: true })
    })
    const pending = service.create(sender as never, root, { respectGitignore: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    sender.navigate(); release()
    await expect(pending).rejects.toMatchObject({ code: 'OWNER_UNAVAILABLE' })
    await service.disposeAll()
  })
})
