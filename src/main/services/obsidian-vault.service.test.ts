import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The service reads the REAL Obsidian config path for the current platform, so these
 * tests point `APPDATA` (Windows) or `XDG_CONFIG_HOME` (Linux) at a fixture directory
 * rather than mocking the module. macOS ignores both env vars, so the macOS branch is
 * exercised by writing the fixture to the real `~/Library/...` location only if it can
 * be created safely — otherwise the suite skips that case rather than writing into the
 * user's home.
 */
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'

let fixtureRoot = ''
let previousAppData: string | undefined
let previousXdg: string | undefined

function configPath(vaultName = 'obsidian'): string {
  if (isWindows) return path.join(fixtureRoot, 'obsidian', 'obsidian.json')
  if (isLinux) return path.join(fixtureRoot, vaultName, 'obsidian.json')
  return path.join(fixtureRoot, 'obsidian', 'obsidian.json')
}

function writeConfig(vaults: Record<string, { path: string; name?: string }>, vaultDir = 'obsidian'): void {
  const target = configPath(vaultDir)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ vaults }))
}

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-obsidian-'))
  previousAppData = process.env.APPDATA
  previousXdg = process.env.XDG_CONFIG_HOME
  if (isWindows) process.env.APPDATA = fixtureRoot
  if (isLinux) process.env.XDG_CONFIG_HOME = fixtureRoot
})

afterEach(() => {
  if (isWindows) {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
  }
  if (isLinux) {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousXdg
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
})

vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { listObsidianVaultEntries, listObsidianVaults } from './obsidian-vault.service'

const platformSupported = isWindows || isLinux

describe.skipIf(!platformSupported)('Obsidian vault discovery', () => {
  it('reads the vaults Obsidian itself registered', () => {
    const vaultPath = path.join(fixtureRoot, 'MyVault')
    fs.mkdirSync(vaultPath, { recursive: true })
    writeConfig({
      aaa: { path: vaultPath },
      bbb: { path: '/somewhere/else', name: 'Named Vault' }
    })
    const vaults = listObsidianVaults()
    expect(vaults).toHaveLength(2)
    // An entry without a name falls back to the folder's basename, like the source.
    expect(vaults[0]).toEqual({ path: vaultPath, name: 'MyVault' })
    expect(vaults[1]).toEqual({ path: '/somewhere/else', name: 'Named Vault' })
  })

  it('answers empty — not an error — when there is no config, no vaults, or bad JSON', () => {
    // No config file at all.
    expect(listObsidianVaults()).toEqual([])
    // Config present but no vaults key.
    const target = configPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ other: true }))
    expect(listObsidianVaults()).toEqual([])
    // Malformed JSON: logged, answered empty. The dialog then says "no vaults", which is
    // a true statement rather than a fabricated success.
    fs.writeFileSync(target, '{ not json')
    expect(listObsidianVaults()).toEqual([])
    // An entry with no usable path is skipped rather than yielding a nameless vault.
    writeConfig({ aaa: { path: '' }, bbb: { path: '/ok' } })
    expect(listObsidianVaults()).toEqual([{ path: '/ok', name: 'ok' }])
  })

  it('walks a vault for folders and markdown files, skipping hidden entries', () => {
    const vaultPath = path.join(fixtureRoot, 'Vault')
    fs.mkdirSync(path.join(vaultPath, 'Notes'), { recursive: true })
    fs.mkdirSync(path.join(vaultPath, '.obsidian'), { recursive: true })
    fs.writeFileSync(path.join(vaultPath, 'root.md'), '# root')
    fs.writeFileSync(path.join(vaultPath, 'Notes', 'nested.md'), '# nested')
    fs.writeFileSync(path.join(vaultPath, 'Notes', 'ignored.txt'), 'not markdown')
    fs.writeFileSync(path.join(vaultPath, '.obsidian', 'config.json'), '{}')
    writeConfig({ aaa: { path: vaultPath, name: 'Vault' } })

    const entries = listObsidianVaultEntries('Vault')
    const byPath = Object.fromEntries(entries.map(entry => [entry.path, entry.type]))
    // Folders and markdown are collected; non-markdown files and hidden dirs are not.
    expect(byPath).toEqual({ Notes: 'folder', 'root.md': 'markdown', 'Notes/nested.md': 'markdown' })
  })

  it('answers empty for an unknown vault or a vault path that is not a directory', () => {
    writeConfig({ aaa: { path: path.join(fixtureRoot, 'not-a-dir'), name: 'Missing' } })
    fs.writeFileSync(path.join(fixtureRoot, 'not-a-dir'), 'a file')
    expect(listObsidianVaultEntries('Missing')).toEqual([])
    expect(listObsidianVaultEntries('NoSuchVault')).toEqual([])
  })
})

describe('Obsidian vault discovery (unsupported platform)', () => {
  it.runIf(!platformSupported)('is skipped on macOS, whose config path ignores env vars', () => {
    expect(platformSupported).toBe(false)
  })
})
