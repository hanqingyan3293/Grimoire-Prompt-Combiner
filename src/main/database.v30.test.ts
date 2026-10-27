import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot },
}))

import { CURRENT_SCHEMA_VERSION, closeDatabase, getDatabase, initDatabase } from './database'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-database-v30-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('database v30 similarity schema', () => {
  it('creates image_perceptual_hashes and image_embeddings with the embedding index', async () => {
    await initDatabase()
    const tables = getDatabase().exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('image_perceptual_hashes','image_embeddings')")[0]?.values?.map(row => String(row[0])) || []
    expect(tables.sort()).toEqual(['image_embeddings', 'image_perceptual_hashes'])
    const hashColumns = getDatabase().exec('PRAGMA table_info(image_perceptual_hashes)')[0]?.values?.map(row => String(row[1])) || []
    expect(hashColumns).toEqual(expect.arrayContaining(['image_ref_id', 'dhash', 'color_histogram', 'width', 'height', 'computed_at']))
    const embeddingColumns = getDatabase().exec('PRAGMA table_info(image_embeddings)')[0]?.values?.map(row => String(row[1])) || []
    expect(embeddingColumns).toEqual(expect.arrayContaining(['image_ref_id', 'model', 'dims', 'vector', 'source', 'computed_at']))
    expect(getDatabase().exec("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_image_embeddings_model'")[0]?.values?.length).toBe(1)
    expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0]?.values?.[0]?.[0]).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  it('cascades hash/embedding rows when the image ref is deleted and stores BLOBs', async () => {
    await initDatabase()
    getDatabase().run('INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)', [7, 'x.png', 'external', 1])
    getDatabase().run('INSERT INTO image_perceptual_hashes (image_ref_id,dhash,color_histogram,width,height,computed_at) VALUES (?,?,?,?,?,?)', [7, '0123456789abcdef', '[0.5]', 64, 64, '2026-01-01T00:00:00.000Z'])
    getDatabase().run('INSERT INTO image_embeddings (image_ref_id,model,dims,vector,source,computed_at) VALUES (?,?,?,?,?,?)', [7, 'm', 2, Buffer.from([0, 0, 128, 63, 0, 0, 0, 64]), 'clip-sidecar', '2026-01-01T00:00:00.000Z'])
    expect(getDatabase().exec('SELECT COUNT(*) FROM image_perceptual_hashes')[0]?.values?.[0]?.[0]).toBe(1)
    getDatabase().run('DELETE FROM image_refs WHERE id=?', [7])
    expect(getDatabase().exec('SELECT COUNT(*) FROM image_perceptual_hashes')[0]?.values?.[0]?.[0]).toBe(0)
    expect(getDatabase().exec('SELECT COUNT(*) FROM image_embeddings')[0]?.values?.[0]?.[0]).toBe(0)
  })

  it('is idempotent across restarts and tolerates an existing v30 database', async () => {
    await initDatabase()
    getDatabase().run('INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)', [1, 'a.png', 'external', 1])
    getDatabase().run('INSERT INTO image_perceptual_hashes (image_ref_id,dhash,color_histogram,width,height,computed_at) VALUES (?,?,?,?,?,?)', [1, 'ffffffffffffffff', '[]', 1, 1, '2026-01-01T00:00:00.000Z'])
    closeDatabase()
    await initDatabase()
    expect(getDatabase().exec('SELECT dhash FROM image_perceptual_hashes WHERE image_ref_id=1')[0]?.values?.[0]?.[0]).toBe('ffffffffffffffff')
  })
})
