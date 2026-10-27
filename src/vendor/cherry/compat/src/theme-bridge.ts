// Bridges the Grimoire palette onto the Cherry design tokens.
//
// The Cherry surface keeps its own component tree and its own Tailwind theme; the only thing
// we change is the value of the tokens it already reads. That keeps vendor source untouched
// (a hard rule) while making the window follow the user's theme, accent colour and dark mode.
export type ThemePalette = { mode: 'light' | 'dark'; vars: Record<string, string> }

const MAP: Array<[string, string]> = [
  ['--color-background', '--color-bg-primary'],
  ['--color-background-subtle', '--color-bg-tertiary'],
  ['--color-card', '--color-bg-secondary'],
  ['--color-card-foreground', '--color-text-primary'],
  ['--color-foreground', '--color-text-primary'],
  ['--color-foreground-tertiary', '--color-text-secondary'],
  ['--color-foreground-disabled', '--color-text-secondary'],
  ['--color-muted', '--color-bg-tertiary'],
  ['--color-muted-foreground', '--color-text-secondary'],
  ['--color-border', '--color-border'],
  ['--color-border-subtle', '--color-border'],
  ['--color-border-strong', '--color-border'],
  ['--color-input', '--color-border'],
  ['--color-ring', '--color-accent'],
  ['--color-primary', '--color-accent'],
  ['--color-primary-foreground', '--color-accent-foreground'],
  ['--color-accent', '--color-accent'],
  ['--color-accent-foreground', '--color-accent-foreground'],
  ['--color-secondary', '--color-bg-tertiary'],
  ['--color-secondary-foreground', '--color-text-primary'],
  ['--color-popover', '--color-bg-secondary'],
  ['--color-popover-foreground', '--color-text-primary']
]

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')
}

function mix(hex: string, towards: '#ffffff' | '#000000', amount: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const target: [number, number, number] = towards === '#ffffff' ? [255, 255, 255] : [0, 0, 0]
  return toHex([0, 1, 2].map(index => rgb[index] + (target[index] - rgb[index]) * amount) as [number, number, number])
}

// Tailwind's brand scale: 500 is the accent itself, lighter steps mix toward white and darker
// steps toward black. Values mirror the source theme's own scale steps closely enough that
// components using brand-600 for hover still read correctly.
const BRAND_STEPS: Array<[number, number, '#ffffff' | '#000000']> = [
  [50, 0.92, '#ffffff'], [100, 0.85, '#ffffff'], [200, 0.68, '#ffffff'], [300, 0.46, '#ffffff'],
  [400, 0.22, '#ffffff'], [600, 0.16, '#000000'], [700, 0.3, '#000000'], [800, 0.44, '#000000'],
  [900, 0.58, '#000000'], [950, 0.72, '#000000']
]

export function applyThemePalette(palette: ThemePalette): void {
  const root = document.documentElement
  for (const [cherryToken, grimoireToken] of MAP) {
    const value = palette.vars[grimoireToken]
    if (value) root.style.setProperty(cherryToken, value)
  }
  const accent = palette.vars['--color-accent']
  if (accent) {
    root.style.setProperty('--color-brand-500', accent)
    for (const [step, amount, towards] of BRAND_STEPS) {
      root.style.setProperty('--color-brand-' + step, mix(accent, towards, amount))
    }
  }
  root.classList.toggle('dark', palette.mode === 'dark')
  root.setAttribute('data-appearance', palette.mode)
  root.style.colorScheme = palette.mode
}

type ThemeApi = {
  get: () => Promise<ThemePalette | null>
  onChanged: (callback: (palette: ThemePalette) => void) => () => void
}

export function startThemeBridge(): () => void {
  const api = (window as unknown as { api?: { theme?: ThemeApi } }).api?.theme
  if (!api) return () => undefined
  void api.get().then(palette => { if (palette) applyThemePalette(palette) }).catch(() => undefined)
  return api.onChanged(palette => applyThemePalette(palette))
}
