import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hasWritePermission, isPathInside, resolveUserPath } from './cherry-path.service'

describe('resolveUserPath', () => {
  it('resolves relative segments and expands the tilde', () => {
    expect(resolveUserPath('~')).toBe(path.resolve(os.homedir()))
    // `..` must be collapsed, not passed through — the caller compares the result
    // against app data / install paths, and an unresolved `..` would defeat that.
    expect(resolveUserPath(path.join(os.homedir(), 'a', '..', 'b'))).toBe(path.join(os.homedir(), 'b'))
    expect(resolveUserPath('relative/dir')).toBe(path.resolve('relative/dir'))
  })

  it('normalizes the tilde expansion rather than splicing home in verbatim', () => {
    // The source's raw `untildify` leaves a mixed-separator path on Windows
    // (`C:\Users\x/a`); `path.resolve` is what makes the result comparable to the
    // app-data / install paths this is checked against.
    const resolved = resolveUserPath('~/backups')
    expect(resolved).toBe(path.join(os.homedir(), 'backups'))
    expect(resolved.includes('/')).toBe(process.platform !== 'win32')
  })

  it('leaves a directory literally named `~backup` alone', () => {
    expect(resolveUserPath('~backup')).toBe(path.resolve('~backup'))
  })
})

describe('isPathInside', () => {
  const root = path.resolve('/tmp/grimoire-root')

  it('is true for equality — the legacyFile semantics the renderer observes', () => {
    // Mutation check: the closure ALSO contains utils/file/path.ts, whose doc says
    // equality is false. That one is not what ipc.ts uses, and this assertion is what
    // distinguishes them — flipping the helper to equality-false must fail here.
    expect(isPathInside(root, root)).toBe(true)
    expect(isPathInside(root + path.sep, root)).toBe(true)
  })

  it('is true for descendants and false for siblings that share a prefix', () => {
    expect(isPathInside(path.join(root, 'nested', 'deep'), root)).toBe(true)
    // The reason `startsWith` is wrong: this shares a string prefix with `root` but is
    // not inside it.
    expect(isPathInside(root + ' aaa', root)).toBe(false)
    expect(isPathInside(path.join(path.dirname(root), 'sibling'), root)).toBe(false)
  })

  it('does not let `..` escape the containment check', () => {
    expect(isPathInside(path.join(root, '..', 'outside'), root)).toBe(false)
    expect(isPathInside(path.join(root, 'a', '..', '..', 'outside'), root)).toBe(false)
  })

  it('walks up but not down', () => {
    expect(isPathInside(root, path.join(root, 'child'))).toBe(false)
  })
})

describe('hasWritePermission', () => {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-write-'))
  })

  afterEach(() => {
    try {
      fs.chmodSync(dir, 0o700)
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('is true for a writable directory', async () => {
    expect(await hasWritePermission(dir)).toBe(true)
  })

  it('is false for a directory that does not exist, rather than throwing', async () => {
    // The panel calls this on a user-typed path; a throw would surface as an unhandled
    // rejection instead of the "no write permission" toast it is meant to produce.
    expect(await hasWritePermission(path.join(dir, 'does-not-exist'))).toBe(false)
  })

  // A read-only directory cannot be simulated reliably on Windows (chmod only toggles the
  // read-only attribute and does not deny directory writes), so the denial case is only
  // asserted where the permission bits are authoritative.
  it.runIf(process.platform !== 'win32')('is false for a read-only directory', async () => {
    fs.chmodSync(dir, 0o500)
    expect(await hasWritePermission(dir)).toBe(false)
  })
})
