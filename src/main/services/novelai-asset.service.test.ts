import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) },
}))

import { closeDatabase, CURRENT_SCHEMA_VERSION, initDatabase } from '../database'
import {
  NovelaiAssetError,
  assertNovelaiImageRemovable,
  countNovelaiVersionReferences,
  createNovelaiAsset,
  deleteNovelaiAsset,
  getNovelaiAsset,
  listAssetsUsedByImage,
  listImagesUsingAsset,
  listNovelaiAssets,
  recordNovelaiAssetUsage,
  removeNovelaiAssetUsage,
  updateNovelaiAsset,
} from './novelai-asset.service'
import { createNovelaiWork, createNovelaiVersion, linkNovelaiVersionImage } from './novelai-version.service'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-assets-'))
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('NovelAI asset library (M6.4)', () => {
  it('creates, lists and updates assets', () => {
    const character = createNovelaiAsset({ kind: 'character', name: '少女', payload: '{{long hair}}', examples: ['a.png'] })
    createNovelaiAsset({ kind: 'style', name: '水彩' })
    // Ordered by kind then name: character < style, so the character comes first.
    expect(listNovelaiAssets().map(asset => asset.name)).toEqual(['少女', '水彩'])
    expect(listNovelaiAssets('character').map(asset => asset.id)).toEqual([character.id])
    const updated = updateNovelaiAsset(character.id, { name: '雨中少女', payload: '{{long hair}}, rain' })
    expect(updated.name).toBe('雨中少女')
    expect(updated.payload).toContain('rain')
    expect(updated.examples).toEqual(['a.png'])
  })

  it('rejects invalid kinds and empty names', () => {
    expect(() => createNovelaiAsset({ kind: 'weird' as never, name: 'x' })).toThrow(/kind/i)
    expect(() => createNovelaiAsset({ kind: 'scene', name: '   ' })).toThrow(/name/i)
  })

  it('answers 「这块素材用在哪些图」 and 「这张图用了哪些素材」', () => {
    const asset = createNovelaiAsset({ kind: 'character', name: '少女' })
    const style = createNovelaiAsset({ kind: 'style', name: '水彩' })
    recordNovelaiAssetUsage({ assetId: asset.id, imageId: 'img_1', via: 'manual' })
    recordNovelaiAssetUsage({ assetId: style.id, imageId: 'img_1', via: 'agent' })
    recordNovelaiAssetUsage({ assetId: asset.id, imageId: 'img_2' })
    expect(listImagesUsingAsset(asset.id).map(item => item.imageId).sort()).toEqual(['img_1', 'img_2'])
    expect(listAssetsUsedByImage('img_1').map(item => item.name).sort()).toEqual(['少女', '水彩'])
    expect(getNovelaiAsset(asset.id)?.uses).toBe(2)
  })

  it('is idempotent per (asset, image) and supports removing a usage', () => {
    const asset = createNovelaiAsset({ kind: 'object', name: '伞' })
    recordNovelaiAssetUsage({ assetId: asset.id, imageId: 'img_1', via: 'manual' })
    recordNovelaiAssetUsage({ assetId: asset.id, imageId: 'img_1', via: 'agent' })
    expect(listImagesUsingAsset(asset.id)).toHaveLength(1)
    expect(listImagesUsingAsset(asset.id)[0].via).toBe('agent')
    removeNovelaiAssetUsage(asset.id, 'img_1')
    expect(listImagesUsingAsset(asset.id)).toEqual([])
  })

  it('refuses to delete an asset that is still used, unless forced', () => {
    const asset = createNovelaiAsset({ kind: 'style', name: '水彩' })
    recordNovelaiAssetUsage({ assetId: asset.id, imageId: 'img_9' })
    try { deleteNovelaiAsset(asset.id); throw new Error('expected refusal') } catch (error) {
      expect(error).toBeInstanceOf(NovelaiAssetError)
      expect((error as NovelaiAssetError).code).toBe('ASSET_IN_USE')
    }
    deleteNovelaiAsset(asset.id, { force: true })
    expect(getNovelaiAsset(asset.id)).toBeNull()
    expect(listAssetsUsedByImage('img_9')).toEqual([])
  })

  it('guards permanent image deletion while a version references it (F8)', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, b', expectedRevision: 1 })
    linkNovelaiVersionImage({ versionId: root.id, imageId: 'img_ref' })
    expect(countNovelaiVersionReferences('img_ref')).toBe(1)
    expect(() => assertNovelaiImageRemovable('img_ref')).toThrow(/referenced/i)
    assertNovelaiImageRemovable('img_free')
  })

  it('ships schema v38', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(38)
  })
})
