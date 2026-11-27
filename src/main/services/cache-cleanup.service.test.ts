import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
let tempRoot = ''
/** `GRIMOIRE_LOG_DIR` is read by the logger, so it also relocates this service's logs. */
let logRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'userData' ? testRoot : path.join(testRoot, name),
    isReady: () => true
  }
}))

import {
  CACHE_CLEANUP_GROUPS,
  inspectGroup,
  normalizeCleanupGroups,
  rotatableLogFiles,
  runGroup
} from './cache-cleanup.service'
import { getActiveLogPath } from './logger.service'
import { closeDatabase, initDatabase } from '../database'
const actualTempRoot = os.tmpdir()

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(actualTempRoot, 'grimoire-cache-'))
  tempRoot = path.join(testRoot, 'owned-temp')
  fs.mkdirSync(tempRoot)
  // Never sweep another running app's OS-temp directories while running the root suite.
  vi.spyOn(os, 'tmpdir').mockReturnValue(tempRoot)
  logRoot = path.join(testRoot, 'owned-logs')
  fs.mkdirSync(logRoot)
  process.env.GRIMOIRE_LOG_DIR = logRoot
  await initDatabase()
})

afterEach(() => {
  delete process.env.GRIMOIRE_LOG_DIR
  closeDatabase()
  vi.restoreAllMocks()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

/** Creates a temp dir with the given prefix, holding `files` of `size` bytes each. */
function makeTempFixture(prefix: string, files: number, size: number): string {
  const dir = fs.mkdtempSync(path.join(tempRoot, prefix))
  for (let index = 0; index < files; index += 1) {
    fs.writeFileSync(path.join(dir, `f${index}.bin`), Buffer.alloc(size))
  }
  return dir
}

describe('cache cleanup groups', () => {
  it('normalizes a renderer group list, dropping unknown entries and duplicates', () => {
    expect(normalizeCleanupGroups(['logs', 'logs', 'normal_cache', 'bogus', 7, null]))
      .toEqual(['logs', 'normal_cache'])
    expect(normalizeCleanupGroups('logs')).toEqual([])
    expect(normalizeCleanupGroups(undefined)).toEqual([])
    // Every declared group is accepted, so the list cannot drift from the type.
    expect(normalizeCleanupGroups([...CACHE_CLEANUP_GROUPS])).toEqual([...CACHE_CLEANUP_GROUPS])
  })

  it('measures normal_cache as an exact size across the Grimoire temp dirs', () => {
    makeTempFixture('grimoire-image-import-', 2, 100)
    makeTempFixture('grimoire-comfy-', 1, 50)
    const size = inspectGroup('normal_cache')
    expect(size.accuracy).toBe('exact')
    expect(size.completeness).toBe('complete')
    // At least the fixtures this suite created; other Grimoire temp dirs may exist.
    expect(size.bytes).toBeGreaterThanOrEqual(250)
  })

  it('reports unavailable rather than zero when there is nothing to measure', () => {
    // An empty/absent cache must not read as "0 bytes, exact" — that would suggest the
    // sweep ran and found an empty cache, which is a different claim.
    const size = inspectGroup('logs')
    expect(size.bytes).toBeNull()
    expect(size.accuracy).toBe('unavailable')
  })

  it('clears the temp dirs it owns and reports not_found when there are none', () => {
    const fixture = makeTempFixture('grimoire-package-', 1, 10)
    expect(fs.existsSync(fixture)).toBe(true)
    expect(runGroup('normal_cache')).toBe('cleared')
    expect(fs.existsSync(fixture)).toBe(false)
    // A second run has nothing left to remove.
    expect(runGroup('normal_cache')).toBe('not_found')
  })

  it('clears rotated logs but never the active log file', () => {
    const active = getActiveLogPath()
    fs.mkdirSync(path.dirname(active), { recursive: true })
    fs.writeFileSync(active, 'active')
    fs.writeFileSync(path.join(logRoot, 'grimoire.1.log'), 'rotated')
    fs.writeFileSync(path.join(logRoot, 'grimoire.2.log'), 'rotated')

    expect(rotatableLogFiles().sort()).toEqual([
      path.join(logRoot, 'grimoire.1.log'),
      path.join(logRoot, 'grimoire.2.log')
    ].sort())

    expect(runGroup('logs')).toBe('cleared')
    // The file in use survives — deleting it would break logging mid-session.
    expect(fs.existsSync(active)).toBe(true)
    expect(fs.readdirSync(logRoot)).toEqual([path.basename(active)])
  })

  it('skips groups with no Grimoire target instead of claiming a clear', () => {
    // These three have no implementation here, and the source UI renders a distinct
    // state for each status — reporting 'cleared' would be a fabricated success.
    for (const group of ['site_data', 'orphaned_data', 'legacy_v1'] as const) {
      expect(runGroup(group)).toBe('skipped')
      expect(inspectGroup(group)).toEqual({ bytes: null, accuracy: 'unavailable', completeness: 'complete' })
    }
  })
})
