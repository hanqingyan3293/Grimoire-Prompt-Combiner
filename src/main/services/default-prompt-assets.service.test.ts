import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({ app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { importDefaultPromptAssets } from './default-prompt-assets.service'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-default-assets-'))
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('built-in prompt asset import (D12 regression)', () => {
  it('imports every source row instead of dying on a column-count mismatch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'))
    fs.writeFileSync(path.join(directory, 'awesome-gpt-image.json'), JSON.stringify([
      { id: '1', title: '肖像', prompt: 'long hair, portrait', description: '人物', tags: ['portrait', 'hair'], variantCount: 2 },
      { id: '2', title: '风景', prompt: 'mountain lake', tags: [] },
      { id: '3', title: '', prompt: 'skipped: no title' },
    ]))
    const added = await importDefaultPromptAssets(directory)
    expect(added).toBe(2)
    const rows = getDatabase().exec('SELECT name, prompt, chapter, section, subsection, nsfw, variant_count FROM prompt_assets ORDER BY name')[0]?.values ?? []
    expect(rows.map(row => String(row[0]))).toEqual(['肖像', '风景'].sort())
    const portrait = rows.find(row => String(row[0]) === '肖像')!
    expect(String(portrait[2])).toBe('人物')
    expect(String(portrait[3])).toBe('精选 GPT 图像提示词')
    expect(String(portrait[4])).toBe('portrait / hair')
    expect(Number(portrait[5])).toBe(0)
    expect(Number(portrait[6])).toBe(2)
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('is idempotent through the completion marker', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'))
    fs.writeFileSync(path.join(directory, 'awesome-gpt-image.json'), JSON.stringify([{ id: '1', title: '肖像', prompt: 'long hair' }]))
    expect(await importDefaultPromptAssets(directory)).toBe(1)
    expect(await importDefaultPromptAssets(directory)).toBe(0)
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('returns 0 for a missing directory instead of throwing at startup', async () => {
    // The startup call is `.catch`-ed, so a throw here would look like "nothing to import" while
    // being a real failure. A missing directory must be a quiet 0.
    await expect(importDefaultPromptAssets(path.join(testRoot, 'missing-assets'))).resolves.toBe(0)
  })
})
