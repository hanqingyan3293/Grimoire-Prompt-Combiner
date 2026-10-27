import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * The three path helpers the source Cherry preload exposes alongside `file.selectFolder`:
 * `window.api.resolvePath` / `isPathInside` / `hasWritePermission`.
 *
 * These are NOT conveniences — the source `LocalBackupSettings` calls `resolvePath` from a
 * `useEffect` whenever a backup directory is configured, and `checkLocalBackupDirValid`
 * chains `resolvePath` → `isPathInside` (twice) → `hasWritePermission` before accepting a
 * directory. Without them the panel renders on a fresh profile and then throws the moment a
 * directory exists, which reads as a working panel that breaks only for users who use it.
 *
 * Semantics mirror `src/main/ipc.ts` + `src/main/utils/legacyFile.ts` in the vendored source,
 * which is what the renderer-facing handlers actually call:
 *
 *   App_ResolvePath      -> path.resolve(untildify(input))
 *   App_IsPathInside     -> legacyFile.isPathInside  (EQUALITY IS TRUE — see below)
 *   App_HasWritePermission -> fs.promises.access(dir, W_OK) in a try/catch -> boolean
 *
 * The equality detail matters: the closure holds TWO `isPathInside` implementations that
 * disagree. `utils/file/path.ts` documents "equality returns false (a directory is not inside
 * itself)", while `utils/legacyFile.ts` returns TRUE for equal paths. `ipc.ts` imports the
 * legacyFile one, so equality-true is what the renderer observes and what these panels depend
 * on — `checkLocalBackupDirValid` compares the chosen dir against `appDataPath`/`installPath`
 * and an equality-false helper would let a user point a backup directory AT the app data
 * directory it is meant to stay out of.
 */

/**
 * Expands a leading `~` to the home directory, matching the source's `untildify`.
 *
 * Only a leading `~` followed by end-of-string or a separator expands, so a directory
 * literally named `~backup` is left alone.
 *
 * NOT exported: the raw substitution can leave a mixed-separator path on Windows
 * (`~/a` -> `C:\Users\x/a`), because the home directory is spliced in verbatim — the
 * source does the same. `path.resolve` in `resolveUserPath` is what normalizes it, so
 * only the resolved form is a contract worth exposing.
 */
function untildify(input: string): string {
  if (input.startsWith('~')) {
    return input.replace(/^~(?=$|\/|\\)/, os.homedir())
  }
  return input
}

/** Source `App_ResolvePath`: tilde expansion then `path.resolve`. */
export function resolveUserPath(input: string): string {
  return path.resolve(untildify(input))
}

/**
 * True iff `child` equals `parent` or is a proper descendant of it.
 *
 * Paths are resolved before comparison so `..` segments cannot escape the check, and the
 * result is compared with `path.relative` rather than `startsWith` so `/root/test aaa` is
 * not mistaken for a child of `/root/test`.
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  try {
    const resolvedChild = path.normalize(path.resolve(childPath))
    const resolvedParent = path.normalize(path.resolve(parentPath))
    if (resolvedChild === resolvedParent) return true
    const relativePath = path.relative(resolvedParent, resolvedChild)
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  } catch {
    // The source logs and returns false; a path that cannot be resolved is not inside.
    return false
  }
}

/**
 * True iff the directory is writable, by the same `access(W_OK)` probe the source uses.
 *
 * Deliberately `access` and not a write-and-delete probe: this answers "would a backup
 * written here succeed", and creating a probe file inside a user's chosen backup directory
 * has side effects the check does not need.
 */
export async function hasWritePermission(dir: string): Promise<boolean> {
  try {
    await fs.promises.access(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
