import fs from 'node:fs'
import path from 'node:path'
import type { WebContents } from 'electron'
import { createDirectoryTree } from '../../integrations/cherry/file-tree/builder'
import { DirectoryTreeManager } from '../../integrations/cherry/file-tree/manager'
import type { TreeBoundary } from '../../integrations/cherry/file-tree/scanner'
import { DirectoryTreeOptionsSchema, type CreateTreeIpcResult, type DirectoryTreeOptions, type SerializedTreeNode, type TreeMutationPushPayload } from '../../integrations/cherry/file-tree/tree'
import type { createDirectoryWatcher } from '../../integrations/cherry/file-tree/watcher'
import { listAgentWorkspacesInternal } from './agent-workspace.service'

/** Main-only, read-only actual UI file.tree seam; coordinator wires IPC later.
 * Source partial extractions have hashes/change descriptions in file-tree/*.ts.
 * No recursive/ripgrep/search parity claimed. No mkdir, rename, DB writes or downloads.
 */
export const CHERRY_FILE_TREE_LIMITS = Object.freeze({ nodes: 2000, depth: 1, pendingMutations: 1000, consumersPerOwner: 16, owners: 64 })
export type CherryFileTreeErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_OPTIONS' | 'UNSUPPORTED_DEPTH' | 'WATCH_MISSING_ROOT_UNSUPPORTED' | 'RENAME_UNSUPPORTED' | 'ROOT_NOT_AUTHORIZED' | 'ROOT_UNAVAILABLE' | 'UNSAFE_PATH' | 'OWNER_UNAVAILABLE' | 'OWNER_MISMATCH' | 'CONSUMER_LIMIT' | 'OWNER_LIMIT' | 'STOPPED'
export class CherryFileTreeError extends Error {
  constructor(readonly code: CherryFileTreeErrorCode, message: string = code) { super(message); this.name = 'CherryFileTreeError' }
}
function fail(code: CherryFileTreeErrorCode): never { throw new CherryFileTreeError(code) }
type WorkspaceRoot = { readonly id: string; readonly path: string; readonly type: 'user' | 'system' }
export interface CherryFileTreeDependencies {
  /** MAIN-owned repository only; never accept root registration from renderer arguments. */
  listWorkspaceRoots?: () => readonly WorkspaceRoot[]
  /** Coordinator sends to this sender only, on file.tree.mutation. */
  emit: (sender: WebContents, payload: TreeMutationPushPayload) => void
  onError?: (rootPath: string, error: unknown) => void
  /** MAIN-only tests; production uses extracted source chokidar watcher. */
  createWatcher?: typeof createDirectoryWatcher
  beforeScan?: () => Promise<void>
}
function absolute(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value)) fail('INVALID_INPUT')
  if (process.platform === 'win32') {
    if (!/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(value) || /^[\\/]{2}[?.]/.test(value)) fail('INVALID_INPUT')
    const parts = value.slice(path.parse(value).root.length).split(/[\\/]/).filter(Boolean)
    if (parts.some(p => p !== '.' && p !== '..' && (/[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) fail('INVALID_INPUT')
  }
  return path.resolve(value)
}
function key(p: string): string { return process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p) }
function inside(parent: string, child: string): boolean {
  const rel = path.relative(key(parent), key(child))
  return !rel || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}
/** Fail closed on symlink/junction components, not only the final leaf. */
function components(target: string, allowMissingLeaf = false): void {
  const root = path.parse(target).root
  let current = root
  const parts = target.slice(root.length).split(path.sep).filter(Boolean)
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i])
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('UNSAFE_PATH') }
    catch (error) {
      if (allowMissingLeaf && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}
function options(input: unknown): DirectoryTreeOptions {
  const parsed = DirectoryTreeOptionsSchema.safeParse(input === undefined ? {} : input)
  if (!parsed.success) fail('UNSUPPORTED_OPTIONS')
  const o = parsed.data
  if (o.watchMissingRoot) fail('WATCH_MISSING_ROOT_UNSUPPORTED')
  if (o.maxDepth !== undefined && o.maxDepth !== 1) fail('UNSUPPORTED_DEPTH')
  if (o.extensions && (o.extensions.length > 64 || o.extensions.some(e => !/^\.?[a-zA-Z0-9_-]{1,32}$/.test(e)))) fail('UNSUPPORTED_OPTIONS')
  // Deliberate bounded shallow default, not upstream's unlimited default.
  return { extensions: [...new Set((o.extensions ?? []).map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))].sort(), respectGitignore: o.respectGitignore ?? true, includeHidden: o.includeHidden ?? false, withStats: o.withStats ?? false, maxDepth: 1, watchMissingRoot: false }
}
interface RootGrant { root: string; workspace: WorkspaceRoot; real: string; dev: number; ino: number }
interface OwnerState { sender: WebContents; generation: number; pending: number; dead: boolean; ids: Set<string>; detach: () => void }
interface Consumer { owner: OwnerState; grant: RootGrant }

export class CherryFileTreeService {
  private readonly manager: DirectoryTreeManager
  private readonly owners = new Map<WebContents, OwnerState>()
  private readonly consumers = new Map<string, Consumer>()
  private readonly work = new Set<Promise<unknown>>()
  private stopped = false
  constructor(private readonly dependencies: CherryFileTreeDependencies) {
    this.manager = new DirectoryTreeManager(async (root, opts) => {
      const grant = this.authorize(root)
      const boundary: TreeBoundary = {
        maxNodes: CHERRY_FILE_TREE_LIMITS.nodes,
        allowPath: p => this.allow(grant, p),
        checkIgnoreFile: async p => {
          const file = path.join(p, '.gitignore')
          if (!this.allow(grant, file)) fail('UNSAFE_PATH')
          try { const stat = await fs.promises.lstat(file); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) fail('UNSAFE_PATH') }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        },
        onError: error => this.dependencies.onError?.(root, error),
        createWatcher: dependencies.createWatcher,
        beforeScan: dependencies.beforeScan
      }
      return createDirectoryTree(root, opts, boundary)
    }, (sender, payload) => {
      const consumer = this.consumers.get(payload.treeId)
      if (!consumer || consumer.owner.dead || sender.isDestroyed() || !this.allow(consumer.grant, consumer.grant.root)) {
        if (consumer) this.track(this.drop(payload.treeId, consumer.owner))
        return
      }
      try { dependencies.emit(sender, payload) }
      catch (error) { dependencies.onError?.(consumer.grant.root, error); this.track(this.drop(payload.treeId, consumer.owner)) }
    }, treeId => this.forget(treeId))
  }
  private authorize(input: unknown): RootGrant {
    const root = absolute(input)
    const workspace = (this.dependencies.listWorkspaceRoots ?? listAgentWorkspacesInternal)().filter(row => inside(row.path, root)).sort((a, b) => b.path.length - a.path.length)[0]
    if (!workspace) fail('ROOT_NOT_AUTHORIZED')
    try {
      components(root)
      components(workspace.path)
      const stat = fs.lstatSync(root)
      if (!stat.isDirectory()) fail('UNSAFE_PATH')
      const real = fs.realpathSync.native(root), realWorkspace = fs.realpathSync.native(workspace.path)
      if (!inside(realWorkspace, real)) fail('UNSAFE_PATH')
      fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK)
      return { root, workspace, real, dev: stat.dev, ino: stat.ino }
    } catch (error) {
      if (error instanceof CherryFileTreeError) throw error
      return fail('ROOT_UNAVAILABLE')
    }
  }
  private allow(grant: RootGrant, target: string): boolean {
    try {
      const current = this.authorize(grant.root)
      if (current.workspace.id !== grant.workspace.id || current.dev !== grant.dev || current.ino !== grant.ino || key(current.real) !== key(grant.real)) return false
      const normalized = absolute(target)
      if (!inside(grant.root, normalized)) return false
      const rel = path.relative(grant.root, normalized)
      if (rel.split(path.sep).filter(Boolean).length > 1) return false
      components(normalized, true)
      try { return inside(grant.real, fs.realpathSync.native(normalized)) }
      catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
    } catch { return false }
  }
  private owner(sender: WebContents): OwnerState {
    if (this.stopped) fail('STOPPED')
    if (!sender || sender.isDestroyed()) fail('OWNER_UNAVAILABLE')
    const existing = this.owners.get(sender)
    if (existing) return existing
    if (this.owners.size >= CHERRY_FILE_TREE_LIMITS.owners) fail('OWNER_LIMIT')
    const state: OwnerState = { sender, generation: 0, pending: 0, dead: false, ids: new Set(), detach: () => {} }
    const dead = () => this.invalidate(state, true)
    const navigated = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) this.invalidate(state, false) }
    sender.on('destroyed', dead)
    sender.on('render-process-gone', dead)
    sender.on('did-start-navigation', navigated)
    state.detach = () => {
      sender.removeListener('destroyed', dead)
      sender.removeListener('render-process-gone', dead)
      sender.removeListener('did-start-navigation', navigated)
    }
    this.owners.set(sender, state)
    return state
  }
  private releaseOwner(state: OwnerState): void {
    if (state.ids.size || state.pending) return
    state.detach()
    if (this.owners.get(state.sender) === state) this.owners.delete(state.sender)
  }
  private forget(treeId: string): void {
    const consumer = this.consumers.get(treeId)
    if (!consumer) return
    this.consumers.delete(treeId)
    consumer.owner.ids.delete(treeId)
    this.releaseOwner(consumer.owner)
  }
  private invalidate(state: OwnerState, dead: boolean): void {
    state.generation++
    state.dead ||= dead
    for (const id of [...state.ids]) this.forget(id)
    this.track(this.manager.disposeWindowAndWait(state.sender.id))
    this.releaseOwner(state)
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.work.add(promise)
    void promise.finally(() => this.work.delete(promise)).catch(() => {})
    return promise
  }
  private async drop(treeId: string, owner: OwnerState): Promise<boolean> {
    this.forget(treeId)
    return this.manager.disposeAndWait(treeId, owner.sender.id)
  }
  create(sender: WebContents, rootPath: unknown, inputOptions?: unknown): Promise<CreateTreeIpcResult> {
    return this.track(this.createImpl(sender, rootPath, inputOptions))
  }
  private async createImpl(sender: WebContents, rootPath: unknown, inputOptions?: unknown): Promise<CreateTreeIpcResult> {
    if (this.stopped) fail('STOPPED')
    const opts = options(inputOptions), grant = this.authorize(rootPath)
    const owner = this.owner(sender), generation = owner.generation
    if (owner.ids.size + owner.pending >= CHERRY_FILE_TREE_LIMITS.consumersPerOwner) fail('CONSUMER_LIMIT')
    owner.pending++
    let result: CreateTreeIpcResult | undefined
    try {
      result = await this.manager.create({ windowId: sender.id, webContents: sender }, grant.root, opts)
      if (this.stopped || owner.dead || sender.isDestroyed() || owner.generation !== generation) fail('OWNER_UNAVAILABLE')
      if (!this.allow(grant, grant.root)) fail('ROOT_UNAVAILABLE')
      this.consumers.set(result.treeId, { owner, grant })
      owner.ids.add(result.treeId)
      return result
    } catch (error) {
      if (result) await this.manager.disposeAndWait(result.treeId, sender.id)
      // Source manager reconciles destroyed senders itself; force the idle close
      // after its reconciliation too, so no 500ms watcher survives the rejection.
      if (owner.dead || sender.isDestroyed() || owner.generation !== generation || this.stopped) {
        await this.manager.disposeWindowAndWait(sender.id)
        fail(this.stopped ? 'STOPPED' : 'OWNER_UNAVAILABLE')
      }
      throw error
    } finally {
      owner.pending--
      this.releaseOwner(owner)
    }
  }
  private owned(sender: WebContents, treeId: string): Consumer | undefined {
    const consumer = this.consumers.get(treeId)
    if (consumer && consumer.owner.sender !== sender) fail('OWNER_MISMATCH')
    return consumer
  }
  activate(sender: WebContents, treeId: string, revision: number): boolean {
    const consumer = this.owned(sender, treeId)
    if (!consumer) return false
    if (!Number.isSafeInteger(revision) || revision < 0) fail('INVALID_INPUT')
    if (consumer.owner.dead || sender.isDestroyed() || !this.allow(consumer.grant, consumer.grant.root)) {
      this.track(this.drop(treeId, consumer.owner))
      return false
    }
    return this.manager.activateTree(treeId, revision, sender.id)
  }
  dispose(sender: WebContents, treeId: string): Promise<boolean> {
    const consumer = this.owned(sender, treeId)
    return consumer ? this.track(this.drop(treeId, consumer.owner)) : Promise.resolve(false)
  }
  rename(_sender: WebContents, _treeId: string, _oldPath: string, _newName: string): never { return fail('RENAME_UNSUPPORTED') }
  async disposeAll(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true
      for (const owner of [...this.owners.values()]) this.invalidate(owner, true)
    }
    await this.manager.disposeAll()
    await Promise.allSettled([...this.work])
    for (const owner of [...this.owners.values()]) { owner.detach(); this.owners.delete(owner.sender) }
    this.consumers.clear()
  }
  /** Optional main-only shallow expansion: creates a real short-lived tree,
   * obtains its snapshot and awaits watcher closure. No renderer IO or writes.
   */
  async listDirectoryEntries(sender: WebContents, rootPath: unknown, inputOptions?: unknown): Promise<SerializedTreeNode[]> {
    const result = await this.create(sender, rootPath, inputOptions)
    try { return Object.values(result.snapshot.children ?? {}) }
    finally { await this.dispose(sender, result.treeId) }
  }
}
