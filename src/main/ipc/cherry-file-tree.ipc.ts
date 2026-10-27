import { app, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { CherryFileTreeError, CherryFileTreeService } from '../services/cherry-file-tree.service'

/** ADAPTER of Cherry shared/ipc/schemas/file.ts and handlers/file.ts.
 * Registered trusted-main-frame admission remains in the existing dispatcher.
 * Trees and mutations belong only to the requesting WebContents; no broadcast.
 */
type Result = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }
type TreePort = Pick<CherryFileTreeService, 'create' | 'activate' | 'dispose' | 'disposeAll'>
function failure(code: string): Result { return { ok: false, error: { code, message: `CHERRY_FILE_TREE_${code}` } } }
function object(input: unknown, fields: readonly string[]): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => fields.includes(key))
}
function treeId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value) }

export function createCherryFileTreeRouteHandler(service: TreePort) {
  return async (route: string, input: unknown, sender: WebContents | null): Promise<Result> => {
    if (!sender || sender.isDestroyed()) return failure('OWNER_UNAVAILABLE')
    try {
      if (route === 'file.tree.create') {
        if (!object(input, ['rootPath', 'options']) || typeof input.rootPath !== 'string') return failure('INVALID_INPUT')
        return { ok: true, data: await service.create(sender, input.rootPath, input.options) }
      }
      if (route === 'file.tree.activate') {
        if (!object(input, ['treeId', 'revision']) || !treeId(input.treeId) || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) return failure('INVALID_INPUT')
        return { ok: true, data: service.activate(sender, input.treeId, input.revision) }
      }
      if (route === 'file.tree.dispose') {
        if (!object(input, ['treeId']) || !treeId(input.treeId)) return failure('INVALID_INPUT')
        await service.dispose(sender, input.treeId)
        return { ok: true, data: undefined } // Source void, not the internal boolean.
      }
      if (route === 'file.tree.rename') return failure('RENAME_UNSUPPORTED')
      return failure('NOT_IMPLEMENTED')
    } catch (error) {
      // Do not return raw filesystem errors (they can contain unrelated paths).
      return failure(error instanceof CherryFileTreeError ? error.code : 'INTERNAL')
    }
  }
}

let service: CherryFileTreeService | undefined
let handler: ReturnType<typeof createCherryFileTreeRouteHandler> | undefined
export function handleCherryFileTreeRoute(route: string, input: unknown, sender: WebContents | null): Promise<Result> {
  if (!service) {
    service = new CherryFileTreeService({ emit: (owner, payload) => {
      if (!owner.isDestroyed()) owner.send(IPC_CHANNELS.CHERRY_FILE_TREE_MUTATION, payload)
    } })
    handler = createCherryFileTreeRouteHandler(service)
    app.once('will-quit', () => { void service?.disposeAll().catch(() => {}) })
  }
  return handler!(route, input, sender)
}
