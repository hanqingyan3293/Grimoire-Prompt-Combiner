// Reads the palette the main window has actually resolved (theme + accent + appearance) and
// publishes it so every other window can look identical. Reading computed styles instead of
// re-deriving the colours keeps a single source of truth: the theme CSS itself.
export type ThemePalette = { mode: 'light' | 'dark'; vars: Record<string, string> }

const TOKENS = [
  '--color-bg-primary',
  '--color-bg-secondary',
  '--color-bg-tertiary',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-border',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-fill',
  '--color-accent-foreground'
]

export function readThemePalette(): ThemePalette {
  const style = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  for (const token of TOKENS) {
    const value = style.getPropertyValue(token).trim()
    if (value) vars[token] = value
  }
  const mode = document.documentElement.getAttribute('data-appearance') === 'dark' ? 'dark' : 'light'
  return { mode, vars }
}

export function startThemePublishing(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const publish = () => {
    if (timer) clearTimeout(timer)
    // Debounced: applying a theme writes ~10 custom properties, and each write would
    // otherwise trigger its own broadcast.
    timer = setTimeout(() => {
      try { void window.api?.theme?.publish(readThemePalette()) } catch { /* preload absent in tests */ }
    }, 60)
  }
  publish()
  const observer = new MutationObserver(publish)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-appearance', 'style'] })
  return () => { observer.disconnect(); if (timer) clearTimeout(timer) }
}
