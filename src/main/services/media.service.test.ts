import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createMediaRelation, ensureMediaAsset, getMediaAsset, listMediaAssets, saveImageGenerationMetadata, getImageGenerationMetadata } from './media.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-media-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('media asset service', () => {
  it('creates a logical asset for an existing image and persists generation metadata', async () => {
    await initDatabase()
    const filePath = path.join(root, 'image.png')
    fs.writeFileSync(filePath, Buffer.from('image'))
    getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?,?)', [filePath, 'managed', 'hash', 'image/png', 5, 'image.png', 1])
    const imageId = Number(getDatabase().exec('SELECT last_insert_rowid()')[0].values[0][0])
    const asset = ensureMediaAsset(imageId, 'generated-api', '生成图')
    expect(getMediaAsset(asset.id)).toMatchObject({ image_ref_id: imageId, source_kind: 'generated-api', title: '生成图' })
    saveImageGenerationMetadata({ media_asset_id: asset.id, prompt: 'portrait', negative_prompt: 'low quality', provider: 'test', model: 'model', checkpoint: '', loras: [], seed: 42, sampler: 'euler', scheduler: 'normal', steps: 20, cfg: 7, width: 512, height: 512, raw: {} })
    expect(getImageGenerationMetadata(asset.id)).toMatchObject({ prompt: 'portrait', seed: 42, width: 512 })
    expect(listMediaAssets({ source: 'generated-api' })).toHaveLength(1)
  })

  it('round-trips the v22 origin column through get (regression: reader dropped it)', async () => {
    await initDatabase()
    const filePath = path.join(root, 'origin.png')
    fs.writeFileSync(filePath, Buffer.from('image'))
    getDatabase().run('INSERT INTO image_refs (file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?,?)', [filePath, 'managed', 'hash2', 'image/png', 5, 'origin.png', 1])
    const imageId = Number(getDatabase().exec('SELECT last_insert_rowid()')[0].values[0][0])
    const asset = ensureMediaAsset(imageId, 'imported-reference', '来源图')
    getDatabase().run('INSERT INTO image_generation_metadata (media_asset_id,origin,prompt,raw_json,created_at) VALUES (?,?,?,?,?)', [asset.id, 'webui', 'a prompt', '{}', '2026-01-01T00:00:00.000Z'])
    const read = getImageGenerationMetadata(asset.id)
    expect(read?.origin).toBe('webui')
    // Column positions after origin must still line up (prompt/raw shifted by one).
    expect(read?.prompt).toBe('a prompt')
    expect(read?.loras).toEqual([])
    expect(read?.seed).toBeNull()
  })

  it('keeps media relations unique and queryable', async () => {
    await initDatabase()
    const relation = createMediaRelation({ sourceType: 'image', sourceKey: 'image:1', relationType: 'uses-prompt', targetType: 'prompt', targetKey: 'prompt:1' })
    expect(relation.relation_type).toBe('uses-prompt')
    expect(createMediaRelation({ sourceType: 'image', sourceKey: 'image:1', relationType: 'uses-prompt', targetType: 'prompt', targetKey: 'prompt:1' }).id).toBe(relation.id)
  })
})
