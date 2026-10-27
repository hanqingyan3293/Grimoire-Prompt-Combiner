import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
let bundledRoot = ''

vi.mock('electron', () => ({
  app: {
    getAppPath: () => testRoot,
    isPackaged: false,
    getPath: (name: string) => path.join(testRoot, name)
  }
}))

import { PRESET_BINARY_TOOLS, getBinaryToolSnapshots, inspectBinaryTool } from './binary-tools.service'

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-binary-'))
  // `runtimeRoot()` resolves to `<appPath>/resources/agent-runtimes` when unpackaged.
  bundledRoot = path.join(testRoot, 'resources', 'agent-runtimes')
  fs.mkdirSync(bundledRoot, { recursive: true })
})

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true })
})

/** Writes a fake executable into the bundled root at the given relative path. */
function placeBundled(relativePath: string): string {
  const file = path.join(bundledRoot, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '#!/bin/sh\necho 9.9.9\n')
  return file
}

describe('binary tool detection', () => {
  it('reports a bundled tool with its path, and never claims a mise backend', () => {
    // A name the system PATH will not have, so the assertion cannot be satisfied by
    // falling through to `system`.
    const name = 'grimoire-nonexistent-probe-tool'
    const file = placeBundled(name + (process.platform === 'win32' ? '.exe' : ''))
    const snapshot = inspectBinaryTool(name)
    expect(snapshot.availability.source).toBe('bundled')
    // Narrowed so the assertion reads a field that only exists on a resolved source.
    if (snapshot.availability.source === 'none') throw new Error('expected a resolved tool')
    expect(snapshot.availability.path).toBe(file)
    // Grimoire has no mise backend, so the managed-recipe fact is 'unknown' with
    // `backend_unavailable`. Answering 'absent' would assert something about mise that
    // Grimoire cannot know.
    expect(snapshot.application).toEqual({ status: 'unknown', reason: 'backend_unavailable' })
  })

  it('finds a tool in the bundled bin/ subdirectory too', () => {
    const name = 'grimoire-nonexistent-probe-bin'
    const file = placeBundled(path.join('bin', name + (process.platform === 'win32' ? '.exe' : '')))
    const snapshot = inspectBinaryTool(name)
    expect(snapshot.availability.source).toBe('bundled')
    if (snapshot.availability.source === 'none') throw new Error('expected a resolved tool')
    expect(snapshot.availability.path).toBe(file)
  })

  it('reports a tool absent from both the bundled root and the PATH as none', () => {
    const snapshot = inspectBinaryTool('grimoire-definitely-not-installed-xyz')
    expect(snapshot.availability).toEqual({ source: 'none' })
    // The application fact is still reported, so the page can distinguish "not present"
    // from "present but whose managed recipe is unknown".
    expect(snapshot.application.status).toBe('unknown')
  })

  it('answers snapshots as a name-keyed record, de-duplicated and skipping blanks', () => {
    const snapshots = getBinaryToolSnapshots(['fd', 'fd', 'rg', '', '  ', 42])
    expect(Object.keys(snapshots).sort()).toEqual(['42', 'fd', 'rg'])
    expect(snapshots.fd.availability.source).toBeDefined()
    // A non-array input yields an empty record rather than throwing: the page controls
    // the names it asks for, and a throw here would blank the whole list.
    expect(getBinaryToolSnapshots(undefined)).toEqual({})
    expect(getBinaryToolSnapshots('fd')).toEqual({})
  })

  it('covers every preset tool name the source page renders', () => {
    // Drift guard: the page asks for these nine by name, so the service must know them.
    expect([...PRESET_BINARY_TOOLS].sort()).toEqual(
      ['babeldoc-stream', 'bun', 'fd', 'gh', 'lark-cli', 'ntn', 'rg', 'rtk', 'uv'].sort()
    )
    const snapshots = getBinaryToolSnapshots(PRESET_BINARY_TOOLS)
    expect(Object.keys(snapshots)).toHaveLength(PRESET_BINARY_TOOLS.length)
    for (const snapshot of Object.values(snapshots)) {
      expect(['mise', 'bundled', 'system', 'none']).toContain(snapshot.availability.source)
    }
  })
})
