// Handler-level integration smoke: registers the real media/tag IPC handlers
// against a captured ipcMain, then exercises the new wave C/E channels through
// the actual service stack (no renderer, no Electron runtime).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => root },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
}))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { registerMediaIPC } from './media.ipc'
import { registerTagIntelligenceIPC } from './tag-intelligence.ipc'

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error('未注册的通道：' + channel)
  return Promise.resolve(handler({ sender: { send: () => undefined } }, ...args))
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-media-ipc-'))
  handlers.clear()
  await initDatabase()
  registerMediaIPC()
  registerTagIntelligenceIPC()

  const db = getDatabase()
  db.run('INSERT INTO categories (id,group_id,en,zh,sort_order) VALUES (?,?,?,?,?)', ['cat', 'default', 'Character', '人物', 1])
  db.run('INSERT INTO subcategories (id,group_id,category_id,en,zh,sort_order) VALUES (?,?,?,?,?,?)', ['sub', 'default', 'cat', 'Face', '脸部', 1])
  db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['t_a', 'default', 'sub', '1girl', '单个女孩', 1, 'builtin'])
  db.run('INSERT INTO tags (id,group_id,subcategory_id,en,zh,sort_order,source) VALUES (?,?,?,?,?,?,?)', ['t_b', 'default', 'sub', 'solo', '单人', 2, 'builtin'])
  db.run("INSERT INTO image_refs (id,file_path,storage_mode,available,width,height) VALUES (?,?,?,?,?,?)", [1, 'a.png', 'managed', 1, 512, 512])
  db.run("INSERT INTO image_refs (id,file_path,storage_mode,available) VALUES (?,?,?,?)", [2, 'b.png', 'managed', 1])
  db.run('INSERT INTO media_assets (id,image_ref_id,source_kind,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['media_image_1', 1, 'imported-reference', '图一', 'available', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'])
  db.run('INSERT INTO media_assets (id,image_ref_id,source_kind,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['media_image_2', 2, 'generated-comfy', '图二', 'available', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'])
  db.run("INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at,asset_ref_id) VALUES (?,?,?,?,?,?,?,?,?)", ['l1', 'image', 'image:1', 't_a', 'neutral', 'wd14', 'accepted', '2026-01-01T00:00:00.000Z', 1])
  db.run("INSERT INTO asset_tag_links (id,asset_type,asset_key,tag_id,polarity,source,status,created_at,asset_ref_id) VALUES (?,?,?,?,?,?,?,?,?)", ['l2', 'image', 'image:2', 't_b', 'neutral', 'wd14', 'accepted', '2026-01-01T00:00:00.000Z', 2])
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('media and tag IPC handler smoke (waves C/E channels)', () => {
  it('serves media:query with tag filters through the real handler stack', async () => {
    const all = await call('media:query', { query: { sort: 'updated', order: 'desc' }, page: { limit: 50, offset: 0 } }) as { items: Array<{ mediaId: string }>; total: number }
    expect(all.total).toBe(2)
    expect(all.items[0]?.mediaId).toBe('media_image_1')

    const filtered = await call('media:query', { query: { tagFilter: { tagIds: ['t_b'], logic: 'any' } }, page: { limit: 50, offset: 0 } }) as { items: Array<{ mediaId: string }>; total: number }
    expect(filtered.total).toBe(1)
    expect(filtered.items[0]?.mediaId).toBe('media_image_2')

    const excluded = await call('media:query', { query: { tagFilter: { tagIds: [], logic: 'any', excludeTagIds: ['t_a'] } }, page: { limit: 50, offset: 0 } }) as { items: Array<{ mediaId: string }>; total: number }
    expect(excluded.items.map(entry => entry.mediaId)).toEqual(['media_image_2'])
  })

  it('serves tag asset queries and batch previews', async () => {
    const assets = await call('tags:assets:query', { filter: { assetType: 'image', tagIds: ['t_a'], logic: 'any' }, page: { limit: 100, offset: 0 } }) as { keys: Array<{ assetKey: string }>; total: number }
    expect(assets.keys.map(entry => entry.assetKey)).toEqual(['image:1'])

    const preview = await call('tags:assets:batchPreview', { filter: { assetType: 'image', tagIds: ['t_a'], logic: 'any' }, operation: { type: 'remove', tagIds: ['t_a'] } }) as { total: number; operationCount: number }
    expect(preview.total).toBe(1)
    expect(preview.operationCount).toBe(1)
  })

  it('round-trips saved searches and metadata parse through IPC', async () => {
    const saved = await call('tags:savedSearches:save', { name: '冒烟', queryJson: JSON.stringify({ search: 'x' }) }) as { id: string; name: string }
    expect(saved.name).toBe('冒烟')
    const list = await call('tags:savedSearches:list') as Array<{ id: string }>
    expect(list.map(entry => entry.id)).toContain(saved.id)
    expect(await call('tags:savedSearches:delete', saved.id)).toBe(true)
    expect((await call('tags:savedSearches:list') as unknown[]).length).toBe(0)

    const parsed = await call('media:metadata:parse', { mediaId: 'missing_media' })
    expect(parsed).toBeNull()

    const thumbs = await call('media:thumbs:list', { ids: [1, 2], kind: 'thumbnail' }) as Record<number, string | null>
    expect(thumbs[1]).toBeNull()
    expect(thumbs[2]).toBeNull()
  })
})