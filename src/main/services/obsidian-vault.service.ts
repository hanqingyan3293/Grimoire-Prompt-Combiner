import fs from 'fs'
import os from 'os'
import path from 'path'
import { logEvent } from './logger.service'

/**
 * Obsidian vault discovery, for the source `export.obsidian.*` routes.
 *
 * Mirrors `main/services/ObsidianVaultService.ts` in the vendored closure: Obsidian keeps
 * its own vault registry in a per-user config file, and the source reads THAT rather than
 * asking the user to point at a folder. Reading the same file means the export dialog
 * offers exactly the vaults Obsidian itself knows about — a `selectFolder` picker would
 * present a different (and larger) set.
 *
 * Everything here is a real filesystem read. A missing config file, an unreadable vault
 * or a malformed config all answer empty, matching the source's own
 * catch-and-return-`[]` behaviour: the dialog renders "no vaults found", which is a true
 * statement about the machine, not a fabricated success.
 */

export type ObsidianVault = { path: string; name: string }
export type ObsidianEntry = { path: string; type: 'folder' | 'markdown'; name: string }

/**
 * Obsidian's config path per platform, following the source's `getObsidianConfigPath`.
 * Windows uses `%APPDATA%`, macOS `~/Library/Application Support`, Linux honours
 * `XDG_CONFIG_HOME` (defaulting to `~/.config`).
 */
function obsidianConfigCandidates(): string[] {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return [path.join(appData, 'obsidian', 'obsidian.json')]
  }
  if (process.platform === 'darwin') {
    return [path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')]
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  // The source tolerates case differences across Linux installs, so both spellings are
  // tried rather than picking one.
  return [
    path.join(xdg, 'obsidian', 'obsidian.json'),
    path.join(xdg, 'Obsidian', 'obsidian.json'),
    path.join(xdg, 'obsidian', 'Obsidian.json')
  ]
}

/** The vaults Obsidian itself has registered on this machine. */
export function listObsidianVaults(): ObsidianVault[] {
  const configPath = obsidianConfigCandidates().find(candidate => fs.existsSync(candidate))
  if (!configPath) return []
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { vaults?: Record<string, { path?: unknown; name?: unknown }> }
    if (!config || typeof config.vaults !== 'object' || config.vaults === null) return []
    const vaults: ObsidianVault[] = []
    for (const entry of Object.values(config.vaults)) {
      const vaultPath = typeof entry?.path === 'string' ? entry.path : ''
      if (!vaultPath) continue
      const name = typeof entry?.name === 'string' && entry.name ? entry.name : path.basename(vaultPath)
      vaults.push({ path: vaultPath, name })
    }
    return vaults
  } catch (error) {
    logEvent('warn', 'obsidian-vault', '读取 Obsidian 配置失败', {
      context: (error instanceof Error ? error.message : String(error)) + ' :: ' + configPath
    })
    return []
  }
}

/**
 * Folder + markdown structure of one vault, as the export dialog's target picker needs.
 *
 * Hidden entries (`.obsidian`, `.trash`, …) are skipped, matching the source — offering
 * Obsidian's own internals as export targets would let a user write into its config.
 */
export function listObsidianVaultEntries(vaultName: string): ObsidianEntry[] {
  const vault = listObsidianVaults().find(candidate => candidate.name === vaultName)
  if (!vault) return []
  let stats: fs.Stats
  try {
    stats = fs.statSync(vault.path)
  } catch {
    return []
  }
  if (!stats.isDirectory()) return []
  const results: ObsidianEntry[] = []
  const traverse = (dirPath: string, relativePath: string): void => {
    if (relativePath) results.push({ path: relativePath, type: 'folder', name: path.basename(relativePath) })
    let items: fs.Dirent[]
    try {
      items = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      const nextRelative = relativePath ? relativePath + '/' + item.name : item.name
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) traverse(fullPath, nextRelative)
      else if (item.isFile() && item.name.endsWith('.md')) {
        results.push({ path: nextRelative, type: 'markdown', name: item.name })
      }
    }
  }
  traverse(vault.path, '')
  return results
}
