import { describe, expect, it } from 'vitest'
import { PANEL_DEFINITIONS } from './PanelRegistry'
import { PANEL_TYPES } from './panelTypes'
import { isPersistablePanelType } from '../../stores/workspace.store'

// A panel type that exists in the union but is missing from the store's validation used to be
// rewritten to `utility-sidebar` on reload, with no warning — the panel the user added simply
// turned into a different one. These tests make that class of drift impossible to merge quietly.
describe('panel type registry (M6 UI)', () => {
  it('has a definition for every declared panel type', () => {
    for (const type of PANEL_TYPES) expect(PANEL_DEFINITIONS[type]).toBeTruthy()
  })

  it('persists every declared panel type instead of falling back', () => {
    for (const type of PANEL_TYPES) expect(isPersistablePanelType(type)).toBe(true)
    expect(isPersistablePanelType('novelai-workbench')).toBe(true)
  })

  it('still rejects unknown strings', () => {
    expect(isPersistablePanelType('not-a-panel')).toBe(false)
    expect(isPersistablePanelType(42)).toBe(false)
  })
})
