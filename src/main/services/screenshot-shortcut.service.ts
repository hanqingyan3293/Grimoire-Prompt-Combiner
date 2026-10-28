// Screenshot shortcut (M3).
//
// `globalShortcut` is injected so the registration policy is testable without a display: what matters
// is that a disabled feature never holds a shortcut, a changed accelerator replaces the old one, and a
// conflict is reported instead of silently swallowed.
export interface ShortcutRegistrar {
  register(accelerator: string, handler: () => void): boolean
  unregister(accelerator: string): void
  unregisterAll(): void
  isRegistered(accelerator: string): boolean
}

export interface ApplyResult { readonly registered: boolean; readonly accelerator: string | null; readonly reason?: 'DISABLED' | 'NO_ACCELERATOR' | 'CONFLICT' | 'ERROR' }

// The registrar that owns the live binding is remembered, so releasing it never depends on the caller
// passing the same registrar instance again.
let current: { accelerator: string; handler: () => void; registrar: ShortcutRegistrar } | null = null

export function applyScreenshotShortcut(input: { registrar: ShortcutRegistrar; enabled: boolean; accelerator: string; handler: () => void }): ApplyResult {
  const accelerator = (input.accelerator || '').trim()
  // Always drop the previous binding first: a switch that is turned off must not keep the keys.
  if (current) {
    try { current.registrar.unregister(current.accelerator) } catch {}
    current = null
  }
  if (!input.enabled) return { registered: false, accelerator: null, reason: 'DISABLED' }
  if (!accelerator) return { registered: false, accelerator: null, reason: 'NO_ACCELERATOR' }
  try {
    const ok = input.registrar.register(accelerator, input.handler)
    if (!ok) return { registered: false, accelerator: null, reason: 'CONFLICT' }
    current = { accelerator, handler: input.handler, registrar: input.registrar }
    return { registered: true, accelerator }
  } catch {
    return { registered: false, accelerator: null, reason: 'ERROR' }
  }
}

export function currentScreenshotShortcut(): string | null { return current?.accelerator ?? null }

export function resetScreenshotShortcutForTests(): void { current = null }
