import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'

/**
 * Read-only detection for the source `binary.*` registry route family.
 *
 * The source's `EnvironmentDependencies` page presents nine external CLI tools and
 * reports, per tool, where it resolved from (`mise` / `bundled` / `system` / `none`) and
 * whether the managed recipe is actually applied. Grimoire does not run the `mise`
 * backend and does not install these tools — its stated policy is
 * `local-only-no-silent-download` (`resources/agent-runtimes/runtime-manifest.json`) —
 * so this service answers the READ half from the mechanism Grimoire really has, and the
 * WRITE half is refused by the IPC layer rather than faked.
 *
 * Detection mirrors `agent-runtime-manager.inspectAgentRuntime`, which is the existing,
 * proven resolver for this exact question: look in Grimoire's own bundled runtime root
 * first (`bundled`), then the system PATH (`system`), else `none`. A tool that is
 * present is reported as present; a tool that is absent as absent. Nothing is invented,
 * and no download is attempted.
 */

export type BinaryAvailability =
  | { source: 'mise'; path: string; version?: string }
  | { source: 'bundled'; path: string; version?: string }
  | { source: 'system'; path: string }
  | { source: 'none' }

/**
 * The managed-recipe fact. Grimoire has no `mise` backend, so this is always
 * `unknown` with `backend_unavailable` — the source explicitly models that state for a
 * backend that cannot answer, and answering `absent` instead would assert something
 * about mise that Grimoire cannot know.
 */
export type BinaryApplication = { status: 'unknown'; reason: 'backend_unavailable' }

export type BinaryToolSnapshot = {
  name: string
  application: BinaryApplication
  availability: BinaryAvailability
}

/** Source `shared/data/presets/binaryTools.ts` — the tools the page renders. */
export const PRESET_BINARY_TOOLS: readonly string[] = [
  'uv', 'bun', 'fd', 'rg', 'rtk', 'lark-cli', 'gh', 'ntn', 'babeldoc-stream'
]

function runtimeRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'agent-runtimes')
    : path.join(app.getAppPath(), 'resources', 'agent-runtimes')
}

/** Executable names to try inside the bundled root, mirroring the runtime resolver. */
function bundledCandidates(name: string): string[] {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', undefined] : [undefined]
  const candidates: string[] = []
  for (const extension of extensions) {
    const file = extension ? name + extension : name
    candidates.push(file, path.join('bin', file))
  }
  return candidates
}

/** First match for `name` on the system PATH, or null. */
function systemPath(name: string): string | null {
  try {
    const output = execFileSync(
      process.platform === 'win32' ? 'where.exe' : 'which',
      [name],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 }
    )
    const found = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean).filter(value => fs.existsSync(value))
    if (!found.length) return null
    // Prefer a real executable over a shim, matching the runtime resolver's ranking.
    const rank = (value: string) => {
      const lower = value.toLowerCase()
      if (lower.endsWith('.exe')) return 0
      if (lower.endsWith('.cmd')) return 1
      if (lower.endsWith('.bat')) return 2
      return 3
    }
    return found.sort((a, b) => rank(a) - rank(b))[0] || null
  } catch {
    return null
  }
}

/** `--version` output, first line, or undefined when the probe fails. */
function probeVersion(executable: string): string | undefined {
  try {
    const output = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    const line = output.trim().split(String.fromCharCode(10))[0]?.trim()
    return line || undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves one tool. Order: Grimoire's bundled runtime root, then the system PATH.
 * Never `mise`, because Grimoire has no mise backend — claiming `mise` would point the
 * page's "open containing folder" action at a path that does not exist.
 */
export function inspectBinaryTool(name: string): BinaryToolSnapshot {
  const application: BinaryApplication = { status: 'unknown', reason: 'backend_unavailable' }
  const root = runtimeRoot()
  for (const candidate of bundledCandidates(name)) {
    const file = path.join(root, candidate)
    if (fs.existsSync(file)) {
      return { name, application, availability: { source: 'bundled', path: file, version: probeVersion(file) } }
    }
  }
  const system = systemPath(name)
  if (system) return { name, application, availability: { source: 'system', path: system } }
  return { name, application, availability: { source: 'none' } }
}

/**
 * Snapshots for the requested names as a name-keyed record (the shape the source page
 * reads). An unknown name is answered as `none` rather than throwing: the page resolves
 * names it controls, and a hard failure there would blank the whole list.
 */
export function getBinaryToolSnapshots(names: unknown): Record<string, BinaryToolSnapshot> {
  const requested = Array.isArray(names) ? names.map(String) : []
  const unique = [...new Set(requested)]
  const result: Record<string, BinaryToolSnapshot> = {}
  for (const name of unique) {
    if (!name.trim()) continue
    result[name] = inspectBinaryTool(name)
  }
  return result
}

// The source also emits `binary.availability_changed` when its manager mutates state.
// Grimoire has no mutation path (no install backend) and no filesystem/PATH change
// event, so there is nothing that could legitimately emit it — the push event is left
// unbridged rather than fired on a timer that would report changes that did not happen.
