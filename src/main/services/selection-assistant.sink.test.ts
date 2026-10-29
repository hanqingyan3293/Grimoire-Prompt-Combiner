import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { applySelectionPlan } from './selection-assistant.service'
import { createPromptAsset } from './prompt-asset-browser'

// The popup journey proves the window opens and the click reaches IPC. This proves the OTHER half: with a
// non-empty selection the prompt-asset action really writes a row, using the same sink the IPC handler uses.
beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-selection-'))
  await initDatabase()
})

afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('selection assistant sink against the real database (M3)', () => {
  it('writes a prompt asset row for the captured text', () => {
    const sink = {
      writeClipboard: () => {},
      createPromptAsset: (input: { name: string; prompt: string; detail: string }) => createPromptAsset(getDatabase(), input),
    }
    const outcome = applySelectionPlan('to-prompt-asset', '1girl, smile, {{long hair}}', sink)
    expect(outcome.kind).toBe('prompt-asset')
    const rows = getDatabase().exec('SELECT name, prompt FROM prompt_assets')
    const values = rows[0]?.values ?? []
    expect(values.length).toBe(1)
    expect(String(values[0][1])).toContain('{{long hair}}')
  })

  it('refuses an empty selection before touching the database', () => {
    const sink = {
      writeClipboard: () => {},
      createPromptAsset: () => { throw new Error('must not be called') },
    }
    expect(applySelectionPlan('to-prompt-asset', '   ', sink)).toEqual({ kind: 'empty' })
    const rows = getDatabase().exec('SELECT COUNT(*) FROM prompt_assets')
    expect(Number(rows[0]?.values?.[0]?.[0] ?? 0)).toBe(0)
  })
})
