/**
 * Grimoire's explicit shallow FS adapter for the extracted Cherry builder.
 * PARTIAL_EXTRACTION boundary, NOT source ripgrep/fuzzy-search parity.
 * Source search.ts enumerates directories with readdir/Dirent classification;
 * builder.ts already consumes an injected absolute-path list and does its own
 * extension/hidden/gitignore filtering, sorting, classification and tree insertion.
 * This bounded adapter also enumerates regular files with Dirent/lstat, allowing
 * the real UI shallow listing without shell execution or downloading ripgrep.
 * No recursive/search mode, ancestor ignore discovery or ripgrep behavior claimed.
 * Parser and watcher are the actual extracted source algorithms (see their hashes).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { createDirectoryWatcher } from './watcher'

export interface TreeBoundary {
  readonly maxNodes: number
  /** Path containment + lstat/realpath guard, including nonexistent unlink leaves. */
  allowPath(path: string): boolean
  checkIgnoreFile(rootPath: string): Promise<void>
  onError(error: unknown): void
  readonly createWatcher?: typeof createDirectoryWatcher
  /** Main-only deterministic async test seam; default is the actual scanner below. */
  readonly beforeScan?: () => Promise<void>
}

export async function listDirectory(
  rootPath: string,
  options: { recursive: boolean; maxDepth: number; includeHidden: boolean; includeFiles: boolean; includeDirectories: boolean; maxEntries: number },
  boundary: TreeBoundary
): Promise<string[]> {
  await boundary.beforeScan?.()
  if (options.maxDepth !== 1) throw new Error('DIRECTORY_TREE_UNSUPPORTED_DEPTH')
  if (!boundary.allowPath(rootPath)) throw new Error('DIRECTORY_TREE_ROOT_UNAVAILABLE')
  const root = await fs.promises.lstat(rootPath)
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('DIRECTORY_TREE_UNSAFE_ROOT')
  // opendir rather than readdir(all): hostile huge directories cannot allocate
  // an unbounded initial entries array. Cap includes skipped entries as work too.
  const directory = await fs.promises.opendir(rootPath)
  const result: string[] = []
  let examined = 0
  for await (const entry of directory) {
    // Root itself consumes one node in the builder mirror.
    if (++examined >= boundary.maxNodes) throw new Error('DIRECTORY_TREE_NODE_LIMIT')
    if (entry.isSymbolicLink()) continue
    if (!options.includeHidden && entry.name.startsWith('.')) continue
    // Source watcher always filters these, independently of respectGitignore.
    if (['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini'].includes(entry.name)) continue
    if ((!entry.isFile() || !options.includeFiles) && (!entry.isDirectory() || !options.includeDirectories)) continue
    const target = path.join(rootPath, entry.name)
    if (!boundary.allowPath(target)) continue
    result.push(target.replace(/\\/g, '/'))
  }
  if (!boundary.allowPath(rootPath)) throw new Error('DIRECTORY_TREE_ROOT_UNAVAILABLE')
  return result
}
