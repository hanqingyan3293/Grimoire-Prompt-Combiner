import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyScreenshotShortcut, currentScreenshotShortcut, resetScreenshotShortcutForTests } from './screenshot-shortcut.service'

function registrar(behaviour: 'ok' | 'conflict' | 'throw' = 'ok') {
  const registered = new Set<string>()
  return {
    registered,
    register: vi.fn((accelerator: string) => {
      if (behaviour === 'throw') throw new Error('boom')
      if (behaviour === 'conflict') return false
      registered.add(accelerator)
      return true
    }),
    unregister: vi.fn((accelerator: string) => { registered.delete(accelerator) }),
    unregisterAll: vi.fn(() => registered.clear()),
    isRegistered: (accelerator: string) => registered.has(accelerator),
  }
}

beforeEach(() => resetScreenshotShortcutForTests())

describe('screenshot shortcut policy (M3)', () => {
  it('registers when enabled and releases the old accelerator when it changes', () => {
    const first = registrar()
    expect(applyScreenshotShortcut({ registrar: first, enabled: true, accelerator: 'CommandOrControl+Shift+A', handler: () => {} })).toMatchObject({ registered: true })
    expect(currentScreenshotShortcut()).toBe('CommandOrControl+Shift+A')
    const second = registrar()
    expect(applyScreenshotShortcut({ registrar: second, enabled: true, accelerator: 'CommandOrControl+Shift+B', handler: () => {} })).toMatchObject({ registered: true })
    expect(first.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+A')
    expect(currentScreenshotShortcut()).toBe('CommandOrControl+Shift+B')
  })

  it('never holds a shortcut while the feature is off', () => {
    const reg = registrar()
    applyScreenshotShortcut({ registrar: reg, enabled: true, accelerator: 'F9', handler: () => {} })
    expect(applyScreenshotShortcut({ registrar: reg, enabled: false, accelerator: 'F9', handler: () => {} })).toEqual({ registered: false, accelerator: null, reason: 'DISABLED' })
    expect(currentScreenshotShortcut()).toBeNull()
    expect(reg.registered.size).toBe(0)
  })

  it('reports a conflict and an empty accelerator instead of pretending success', () => {
    expect(applyScreenshotShortcut({ registrar: registrar('conflict'), enabled: true, accelerator: 'F10', handler: () => {} })).toEqual({ registered: false, accelerator: null, reason: 'CONFLICT' })
    expect(currentScreenshotShortcut()).toBeNull()
    expect(applyScreenshotShortcut({ registrar: registrar(), enabled: true, accelerator: '   ', handler: () => {} })).toEqual({ registered: false, accelerator: null, reason: 'NO_ACCELERATOR' })
  })

  it('survives a throwing registrar', () => {
    expect(applyScreenshotShortcut({ registrar: registrar('throw'), enabled: true, accelerator: 'F11', handler: () => {} }).reason).toBe('ERROR')
  })
})
