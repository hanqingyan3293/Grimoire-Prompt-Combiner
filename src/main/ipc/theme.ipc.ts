import { BrowserWindow, ipcMain } from 'electron'

/**
 * Theme bridge: the main renderer owns the resolved palette (it is the only window that knows
 * the theme + accent + appearance-mode combination), and every other window — including the
 * Cherry compat surface — receives it through here. The alternative (duplicating the theme
 * CSS in each window) is how two windows end up disagreeing about what "dark" means.
 */
export type ThemePalette = { mode: 'light' | 'dark'; vars: Record<string, string> }

let lastPalette: ThemePalette | null = null
const MAX_VARS = 64

function sanitize(input: unknown): ThemePalette | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { mode?: unknown; vars?: unknown }
  const mode = raw.mode === 'dark' ? 'dark' : raw.mode === 'light' ? 'light' : null
  if (!mode || !raw.vars || typeof raw.vars !== 'object') return null
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw.vars as Record<string, unknown>)) {
    if (!/^--color-[a-z-]+$/.test(key)) continue
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) continue
    if (!/^[#a-zA-Z0-9.,%()\s-]+$/.test(value)) continue
    vars[key] = value
    if (Object.keys(vars).length >= MAX_VARS) break
  }
  return Object.keys(vars).length ? { mode, vars } : null
}

export function registerThemeIPC(): void {
  ipcMain.handle('theme:publish', (_event, input: unknown) => {
    const palette = sanitize(input)
    if (!palette) return false
    lastPalette = palette
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('theme:changed', palette)
    }
    return true
  })
  ipcMain.handle('theme:get', () => lastPalette)
}
