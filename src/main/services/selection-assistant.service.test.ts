import { describe, expect, it } from 'vitest'
import {
  SELECTION_ACTIONS, applySelectionShortcut, currentSelectionShortcut, normalizeSelection,
  planSelectionAction, resetSelectionShortcutForTests, selectionToTags,
} from './selection-assistant.service'

function registrar(options: { fails?: boolean; throws?: boolean } = {}) {
  const registered = new Map<string, () => void>()
  return {
    registered,
    register: (accelerator: string, handler: () => void) => {
      if (options.throws) throw new Error('boom')
      if (options.fails) return false
      registered.set(accelerator, handler)
      return true
    },
    unregister: (accelerator: string) => { registered.delete(accelerator) },
    isRegistered: (accelerator: string) => registered.has(accelerator),
  }
}

describe('selection assistant (M3, no native hook)', () => {
  it('holds the shortcut only while enabled, and replaces it when the accelerator changes', () => {
    resetSelectionShortcutForTests()
    const target = registrar()
    expect(applySelectionShortcut({ registrar: target, enabled: true, accelerator: 'Alt+Shift+S', handler: () => {} }).registered).toBe(true)
    expect(currentSelectionShortcut()).toBe('Alt+Shift+S')
    applySelectionShortcut({ registrar: target, enabled: true, accelerator: 'Alt+Shift+A', handler: () => {} })
    expect(target.isRegistered('Alt+Shift+S')).toBe(false)
    expect(currentSelectionShortcut()).toBe('Alt+Shift+A')
    const off = applySelectionShortcut({ registrar: target, enabled: false, accelerator: 'Alt+Shift+A', handler: () => {} })
    expect(off.reason).toBe('DISABLED')
    expect(target.registered.size).toBe(0)
  })

  it('reports a conflict or a thrown registrar instead of pretending it is bound', () => {
    resetSelectionShortcutForTests()
    expect(applySelectionShortcut({ registrar: registrar({ fails: true }), enabled: true, accelerator: 'Alt+Shift+S', handler: () => {} }).reason).toBe('CONFLICT')
    expect(applySelectionShortcut({ registrar: registrar({ throws: true }), enabled: true, accelerator: 'Alt+Shift+S', handler: () => {} }).reason).toBe('ERROR')
    expect(currentSelectionShortcut()).toBeNull()
  })

  it('turns pasted prose into tag syntax without breaking weight grammar', () => {
    expect(selectionToTags('1girl, (smile:1.2)\n{{long hair}}、solo')).toBe('1girl, (smile:1.2) , {{long hair}}, solo'.replace(' , ', ', '))
    expect(selectionToTags('   ')).toBe('')
  })

  it('plans each action and refuses to invent content from whitespace', () => {
    expect(SELECTION_ACTIONS.map(action => action.id)).toEqual(['copy-as-tags', 'copy-normalized', 'to-prompt-asset'])
    expect(planSelectionAction('copy-normalized', '  a  b \n\n c ')).toEqual({ kind: 'clipboard', text: 'a b\nc' })
    expect(planSelectionAction('to-prompt-asset', 'line one\nline two')).toEqual({ kind: 'prompt-asset', payload: 'line one\nline two' })
    expect(planSelectionAction('copy-as-tags', '   \n  ')).toEqual({ kind: 'empty' })
  })

  it('normalizes CRLF and collapses runs of spaces so a copied block stays one shape', () => {
    expect(normalizeSelection('a\r\n\r\nb\t\tc')).toBe('a\nb c')
  })
})
