import fs from 'node:fs'
import { assertManagedResourcePath, imageReferencesAtPath, type ManagedResourceArea } from './image-asset.service'

export type OwnedCopy = { id: string; filePath: string; retained?: boolean }
export type OwnedCopyCleanupResult = {
  status: 'completed'|'partial'|'failed'
  phase?: 'file-cleanup'|'database-finalization'
  removedIds: string[]
  retainedIds: string[]
  missingIds: string[]
  pendingIds: string[]
  failures: Array<{ id: string; message: string }>
}

/** Main-owned copy paths only; callers keep their DB index until this operation completes. */
export function cleanupOwnedCopies(copies: readonly OwnedCopy[], area: ManagedResourceArea, operation: 'unlink'|'rm'): OwnedCopyCleanupResult {
  const result: OwnedCopyCleanupResult = { status: 'completed', removedIds: [], retainedIds: [], missingIds: [], pendingIds: [], failures: [] }
  const grouped = new Map<string, OwnedCopy[]>()
  for (const copy of copies) grouped.set(copy.filePath, [...(grouped.get(copy.filePath) || []), copy])
  const groups = [...grouped.entries()]
  for (const [index, [filePath, entries]] of groups.entries()) {
    const ids = entries.map(entry => entry.id)
    try {
      if (!filePath || !fs.existsSync(filePath)) { result.missingIds.push(...ids); continue }
      if (entries.some(entry => entry.retained) || imageReferencesAtPath(filePath).length) { result.retainedIds.push(...ids); continue }
      assertManagedResourcePath(filePath, area)
      if (operation === 'unlink') fs.unlinkSync(filePath)
      else fs.rmSync(filePath, { force: true })
      result.removedIds.push(...ids)
    } catch (error) {
      result.failures.push(...ids.map(id => ({ id, message: error instanceof Error ? error.message : String(error) })))
      result.pendingIds.push(...groups.slice(index + 1).flatMap(([, remaining]) => remaining.map(entry => entry.id)))
      result.status = result.removedIds.length ? 'partial' : 'failed'
      break
    }
  }
  return result
}

export function copyFinalizationFailure(result: OwnedCopyCleanupResult, error: unknown, identity: string): OwnedCopyCleanupResult {
  const ids = [...new Set([...result.removedIds, ...result.retainedIds, ...result.missingIds, ...result.pendingIds])]
  return { ...result, phase: 'database-finalization', status: result.removedIds.length ? 'partial' : 'failed', failures: (ids.length ? ids : [identity]).map(id => ({ id, message: error instanceof Error ? error.message : String(error) })) }
}

/** Legacy boolean IPC calls retain their shape; the message carries counts across Electron serialization. */
export class OwnedCopyCleanupError extends Error {
  constructor(readonly code: 'AI_ATTACHMENT_CLEANUP_FAILED'|'WD14_HISTORY_CLEANUP_FAILED'|'AI_ATTACHMENT_DELETE_DB_FAILED'|'WD14_HISTORY_DELETE_DB_FAILED', readonly result: OwnedCopyCleanupResult) {
    super(code + ': ' + result.status + '; removed=' + result.removedIds.length + '; retained=' + result.retainedIds.length + '; pending=' + result.pendingIds.length + '; ' + (result.failures[0]?.message || 'copy cleanup failed'))
    this.name = 'OwnedCopyCleanupError'
  }
}
