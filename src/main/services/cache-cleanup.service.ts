import fs from 'fs'
import os from 'os'
import path from 'path'
import { logEvent, getActiveLogPath } from './logger.service'
import { imageReferencesAtPath } from './image-asset.service'

/**
 * Cache cleanup for the source `app.cache_cleanup.*` routes.
 *
 * The source `CacheCleanupService` exposes five groups
 * (`normal_cache | site_data | orphaned_data | logs | legacy_v1`), each reporting a size
 * with an explicit `accuracy` and `completeness`, and each returning one of
 * `cleared | not_found | partial | skipped | failed` when run.
 *
 * Grimoire implements the groups whose targets actually exist here, and answers the
 * others as `skipped` — never as a fabricated "cleared". The distinction matters: the
 * source UI renders "已清理" for `cleared` and a distinct state for `skipped`, so
 * reporting a clean-up that did not happen would be a fake success state.
 *
 * Group mapping (Grimoire-side):
 *  - `normal_cache`   → the OS temp directories Grimoire creates for transient work
 *                       (image import, package extraction, ComfyUI tasks, OpenCode
 *                       config). These ARE regenerable by construction and — verified in
 *                       the tree — were never removed anywhere, so they accumulate.
 *  - `logs`           → `logger.service`'s rotated log files, keeping the active file.
 *  - `site_data`      → not implemented: Grimoire has no webview/site storage of its own.
 *  - `orphaned_data`  → not implemented: deciding an asset row is orphaned needs a
 *                       referential audit across every domain table, and deleting the
 *                       wrong row destroys user media. Deliberately left alone.
 *  - `legacy_v1`      → not implemented: there is no Cherry v1 data in a Grimoire
 *                       install (the compat window never wrote one).
 */

export type CacheCleanupGroup = 'normal_cache' | 'site_data' | 'orphaned_data' | 'logs' | 'legacy_v1'
export type CacheCleanupSizeAccuracy = 'exact' | 'estimated' | 'unavailable'
export type CacheCleanupSizeCompleteness = 'complete' | 'partial'
export type CacheCleanupResultStatus = 'cleared' | 'not_found' | 'partial' | 'skipped' | 'failed'

export const CACHE_CLEANUP_GROUPS: readonly CacheCleanupGroup[] = [
  'normal_cache', 'site_data', 'orphaned_data', 'logs', 'legacy_v1'
]

/** Temp-directory prefixes Grimoire creates. Verified: none is removed after use. */
const GRIMOIRE_TEMP_PREFIXES = [
  'grimoire-api-image-',
  'grimoire-image-import-',
  'grimoire-package-',
  'grimoire-comfy-',
  'grimoire-opencode-'
]

function isCacheCleanupGroup(value: unknown): value is CacheCleanupGroup {
  return typeof value === 'string' && (CACHE_CLEANUP_GROUPS as readonly string[]).includes(value)
}

/** Normalizes a renderer-supplied group list: valid entries only, de-duplicated. */
export function normalizeCleanupGroups(groups: unknown): CacheCleanupGroup[] {
  if (!Array.isArray(groups)) return []
  const seen = new Set<CacheCleanupGroup>()
  for (const value of groups) {
    if (isCacheCleanupGroup(value)) seen.add(value)
  }
  return [...seen]
}

/** Directories the `normal_cache` group owns, skipping any that does not exist. */
function tempTargets(): string[] {
  const root = os.tmpdir()
  let entries: string[] = []
  try {
    entries = fs.readdirSync(root)
  } catch {
    return []
  }
  return entries
    .filter(name => GRIMOIRE_TEMP_PREFIXES.some(prefix => name.startsWith(prefix)))
    .map(name => path.join(root, name))
}

/**
 * Log directory the `logs` group owns, derived from the logger's own active-file path
 * so the two cannot disagree about which directory is in play.
 */
function logsDirectory(): string {
  return path.dirname(getActiveLogPath())
}

/**
 * Total bytes under a path, or `null` when unreadable. A directory that vanished
 * between listing and measuring answers 0 rather than throwing.
 */
function measureBytes(target: string): number | null {
  let total = 0
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()!
    let stat: fs.Stats
    try {
      stat = fs.statSync(current)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      let children: string[] = []
      try {
        children = fs.readdirSync(current)
      } catch {
        return null
      }
      for (const child of children) stack.push(path.join(current, child))
    } else {
      total += stat.size
    }
  }
  return total
}

type GroupSize = { bytes: number | null; accuracy: CacheCleanupSizeAccuracy; completeness: CacheCleanupSizeCompleteness }

/**
 * The log files the `logs` group would remove: everything in the log directory except
 * the file currently being appended to. Delegates the "which file is active" decision
 * to the logger so the two cannot disagree.
 */
export function rotatableLogFiles(): string[] {
  const directory = logsDirectory()
  let entries: string[] = []
  try {
    entries = fs.readdirSync(directory)
  } catch {
    return []
  }
  const active = path.resolve(getActiveLogPath())
  return entries
    .map(name => path.join(directory, name))
    .filter(candidate => path.resolve(candidate) !== active)
    .filter(candidate => {
      try {
        return fs.statSync(candidate).isFile()
      } catch {
        return false
      }
    })
}

/** Measures one group. */
export function inspectGroup(group: CacheCleanupGroup): GroupSize {
  if (group === 'normal_cache') {
    const targets = tempTargets()
    // `unavailable` when nothing was found: there is no size to report, and claiming
    // "0 bytes, exact" would suggest the sweep ran and found an empty cache.
    if (!targets.length) return { bytes: null, accuracy: 'unavailable', completeness: 'complete' }
    let total = 0
    for (const target of targets) {
      const bytes = measureBytes(target)
      if (bytes === null) return { bytes: null, accuracy: 'unavailable', completeness: 'partial' }
      total += bytes
    }
    return { bytes: total, accuracy: 'exact', completeness: 'complete' }
  }
  if (group === 'logs') {
    const files = rotatableLogFiles()
    if (!files.length) return { bytes: null, accuracy: 'unavailable', completeness: 'complete' }
    let total = 0
    for (const file of files) {
      const bytes = measureBytes(file)
      if (bytes === null) return { bytes: null, accuracy: 'unavailable', completeness: 'partial' }
      total += bytes
    }
    return { bytes: total, accuracy: 'exact', completeness: 'complete' }
  }
  // Groups with no Grimoire target report `unavailable`, not a zero.
  return { bytes: null, accuracy: 'unavailable', completeness: 'complete' }
}

/** Removes a path recursively; reports whether it is gone afterwards. */
function removePath(target: string): boolean {
  try {
    if (imageReferencesAtPath(target, { directory: true }).length) {
      logEvent('warn', 'cache-cleanup', '缓存仍被图片库引用，已保留', { errorCode: 'CACHE_IN_USE', retryable: false })
      return false
    }
    fs.rmSync(target, { recursive: true, force: true })
    return !fs.existsSync(target)
  } catch (error) {
    logEvent('warn', 'cache-cleanup', '缓存清理项删除失败', {
      context: (error instanceof Error ? error.message : String(error)) + ' :: ' + target
    })
    return false
  }
}

/**
 * Runs one group.
 *
 * `not_found` means there was nothing to remove; `skipped` means the group has no
 * Grimoire target at all (a different statement — the source UI distinguishes them);
 * `partial` means some targets failed and some succeeded.
 */
export function runGroup(group: CacheCleanupGroup): CacheCleanupResultStatus {
  if (group === 'normal_cache') {
    const targets = tempTargets()
    if (!targets.length) return 'not_found'
    let removed = 0
    for (const target of targets) {
      if (removePath(target)) removed += 1
    }
    if (removed === targets.length) return 'cleared'
    return removed === 0 ? 'failed' : 'partial'
  }
  if (group === 'logs') {
    const files = rotatableLogFiles()
    if (!files.length) return 'not_found'
    let removed = 0
    for (const file of files) {
      if (removePath(file)) removed += 1
    }
    if (removed === files.length) return 'cleared'
    return removed === 0 ? 'failed' : 'partial'
  }
  // No Grimoire target: the honest answer is "not applicable here", which is exactly
  // what `skipped` means. Reporting `cleared` would be a fabricated success.
  return 'skipped'
}
