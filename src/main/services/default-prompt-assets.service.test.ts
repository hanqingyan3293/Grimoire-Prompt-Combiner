import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({ app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { defaultPromptAssetRoot, importDefaultPromptAssets, localAssetCoverUrl, seedDefaultPromptAssetCategories } from './default-prompt-assets.service'
import { LOCAL_ASSET_SCHEME, resolveLocalAssetPath } from './local-asset-protocol.service'
import { queryPromptAssets } from './prompt-asset-browser'

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

describe('MOSS default prompt assets (M7.1)', () => {
  const assetDirectory = path.join(process.cwd(), 'data/default-prompt-assets')

  it('ships exactly 120 catalog items and 120 local images', () => {
    const entries = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'moss-character.json'), 'utf8')) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(120)
    expect(new Set(entries.map(entry => entry.id)).size).toBe(120)
    expect(entries.every(entry => typeof entry.title === 'string' && entry.title.length > 0)).toBe(true)
    expect(entries.every(entry => typeof entry.prompt === 'string' && entry.prompt.length > 0)).toBe(true)
    const images = fs.readdirSync(path.join(assetDirectory, 'moss-character')).filter(name => name.endsWith('.webp'))
    expect(images).toHaveLength(120)
    for (const image of images) expect(fs.statSync(path.join(assetDirectory, 'moss-character', image)).size).toBeGreaterThan(0)
  })

  it('imports 120 MOSS rows without changing the existing 1,742 rows', async () => {
    const existingFiles = fs.readdirSync(assetDirectory).filter(name => name.endsWith('.json') && name !== 'moss-character.json')
    const existingCount = existingFiles.reduce((total, name) => total + (JSON.parse(fs.readFileSync(path.join(assetDirectory, name), 'utf8')) as unknown[]).length, 0)
    expect(existingCount).toBe(1742)

    const upgradeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-upgrade-'))
    for (const name of existingFiles) fs.copyFileSync(path.join(assetDirectory, name), path.join(upgradeDirectory, name))
    expect(await importDefaultPromptAssets(upgradeDirectory)).toBe(1742)
    getDatabase().run("DELETE FROM schema_meta WHERE key='default_prompt_assets_local_v2'")
    getDatabase().run("INSERT OR REPLACE INTO schema_meta (key,value) VALUES ('default_prompt_assets_local_v1','complete')")
    fs.copyFileSync(path.join(assetDirectory, 'moss-character.json'), path.join(upgradeDirectory, 'moss-character.json'))
    expect(await importDefaultPromptAssets(upgradeDirectory)).toBe(120)
    const total = Number(getDatabase().exec('SELECT COUNT(*) FROM prompt_assets')[0]?.values?.[0]?.[0] || 0)
    const moss = Number(getDatabase().exec("SELECT COUNT(*) FROM prompt_assets WHERE source_id LIKE 'builtin:moss-character:%'")[0]?.values?.[0]?.[0] || 0)
    expect(total).toBe(1862)
    expect(moss).toBe(120)
    fs.rmSync(upgradeDirectory, { recursive: true, force: true })
  }, 30_000)

  it('is idempotent on repeat import while preserving the 1,862 total', async () => {
    expect(await importDefaultPromptAssets(assetDirectory)).toBe(1862)
    expect(await importDefaultPromptAssets(assetDirectory)).toBe(0)
    const total = Number(getDatabase().exec('SELECT COUNT(*) FROM prompt_assets')[0]?.values?.[0]?.[0] || 0)
    expect(total).toBe(1862)
  }, 60_000)

  it('rebuilds the same MOSS category tree with 96 characters and 24 styles', async () => {
    await importDefaultPromptAssets(assetDirectory)
    seedDefaultPromptAssetCategories()
    const db = getDatabase()
    const readTree = () => {
      const root = db.exec("SELECT id FROM prompt_asset_categories WHERE parent_id IS NULL AND name='MOSS 角色与风格图鉴'")[0]?.values?.[0]?.[0]
      expect(root).toBeTruthy()
      const rows = db.exec('SELECT c.id, c.name, COUNT(DISTINCT l.asset_id) FROM prompt_asset_categories c LEFT JOIN prompt_asset_category_links l ON l.category_id=c.id WHERE c.parent_id=? GROUP BY c.id ORDER BY c.name', [String(root)])[0]?.values || []
      return { root: String(root), rows: rows.map(row => [String(row[0]), String(row[1]), Number(row[2])] as const) }
    }
    const first = readTree()
    expect(Object.fromEntries(first.rows.map(row => [row[1], row[2]]))).toMatchObject({ 角色: 96, 风格: 24 })

    const dbRun = db.run.bind(db)
    dbRun("DELETE FROM schema_meta WHERE key='default_prompt_asset_categories_v10'")
    seedDefaultPromptAssetCategories()
    expect(readTree()).toEqual(first)
  }, 60_000)

  it('returns a local cover URL that resolves to the shipped image', async () => {
    await importDefaultPromptAssets(assetDirectory)
    const page = queryPromptAssets(getDatabase(), { query: 'pikachu', source: 'asset', limit: 10, offset: 0 })
    const moss = page.items.find(item => item.name === 'pikachu')
    expect(moss?.coverUrl).toBe(`${LOCAL_ASSET_SCHEME}://default-prompt-assets/moss-character/001.webp`)
    expect(localAssetCoverUrl('builtin:moss-character:demo-001')).toBe(moss?.coverUrl)
    const resolved = resolveLocalAssetPath(assetDirectory, moss?.coverUrl || '')
    expect(resolved).toBe(path.join(assetDirectory, 'moss-character', '001.webp'))
    expect(fs.existsSync(resolved || '')).toBe(true)
  }, 30_000)
})

describe('default prompt asset roots', () => {
  it('reads repository data in development and app.asar dist data when packaged', () => {
    const devDirname = path.join('D:', 'repo', 'dist', 'main', 'main')
    const appPath = path.join('C:', 'Program Files', 'Grimoire', 'resources', 'app.asar')
    expect(defaultPromptAssetRoot({ isPackaged: false, appPath, dirname: devDirname })).toBe(path.join('D:', 'repo', 'data', 'default-prompt-assets'))
    expect(defaultPromptAssetRoot({ isPackaged: true, appPath, dirname: devDirname })).toBe(path.join(appPath, 'dist', 'main', 'data', 'default-prompt-assets'))
  })
})
