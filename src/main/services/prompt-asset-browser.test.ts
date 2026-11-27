import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createLegacyDatabase } from './sqlite.compat'
import {
  deletePromptAsset,
  isImportedPromptRow,
  orderedPromptAssetIds,
  queryPromptAssets,
  reorderPromptAsset,
  updatePromptAsset,
  validatePromptAssetQuery
} from './prompt-asset-browser'

function createDatabase() {
  const native = new DatabaseSync(':memory:')
  const db = createLegacyDatabase(native)
  db.exec(`
    CREATE TABLE prompt_assets (id TEXT, source_id TEXT, source TEXT, name TEXT, prompt TEXT, chapter TEXT, section TEXT, subsection TEXT, nsfw INTEGER, variant_count INTEGER, source_fingerprint TEXT, created_at TEXT, updated_at TEXT, visibility TEXT NOT NULL DEFAULT 'global');
    CREATE TABLE history (id TEXT, prompt TEXT, positive_count INTEGER, negative_count INTEGER, created_at TEXT);
    CREATE TABLE presets (id TEXT, name TEXT, data TEXT, updated_at TEXT);
    CREATE TABLE favorites (tag_id TEXT, created_at TEXT);
    CREATE TABLE tags (id TEXT, en TEXT, zh TEXT, subcategory_id TEXT);
    CREATE TABLE subcategories (id TEXT, zh TEXT, category_id TEXT);
    CREATE TABLE categories (id TEXT, zh TEXT);
    CREATE TABLE cherry_resource_state (entity_type TEXT, entity_id TEXT, archived INTEGER DEFAULT 0, deleted_at TEXT, pinned INTEGER DEFAULT 0, order_key TEXT DEFAULT '', group_id TEXT, owner_id TEXT, last_activity_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY (entity_type, entity_id));
    CREATE TABLE cherry_prompt_bindings (prompt_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (prompt_id, target_type, target_id));
  `)
  db.run('INSERT INTO categories VALUES (?,?)', ['cat', '人物'])
  db.run('INSERT INTO subcategories VALUES (?,?,?)', ['sub', '发型', 'cat'])
  db.run('INSERT INTO tags VALUES (?,?,?,?)', ['tag_hair', 'long hair', '长发', 'sub'])
  db.run('INSERT INTO tags VALUES (?,?,?,?)', ['tag_bad', 'low quality', '低质量', 'sub'])
  db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset1', 'source1', 'suigu-search-index', '肖像', 'long hair', '人物', '发型', '', 0, 2, '', '2026-01-04', '2026-01-04', 'global'])
  db.run('INSERT INTO history VALUES (?,?,?,?,?)', ['hist1', 'long hair', 1, 0, '2026-01-03'])
  db.run('INSERT INTO presets VALUES (?,?,?,?)', ['preset1', '质量预设', JSON.stringify({ positive: [{ tag_id: 'tag_hair', weight: 1 }], negative: [{ tag_id: 'tag_bad', weight: 1 }] }), '2026-01-02'])
  db.run('INSERT INTO favorites VALUES (?,?)', ['tag_hair', '2026-01-01'])
  return { native, db }
}

describe('prompt asset browser', () => {
  it('aggregates all existing prompt sources without duplicating data', () => {
    const { native, db } = createDatabase()
    const page = queryPromptAssets(db, {})
    expect(page.total).toBe(4)
    expect(new Set(page.items.map(item => item.source))).toEqual(new Set(['asset', 'history', 'preset', 'favorite']))
    expect(page.items.find(item => item.source === 'preset')?.prompt).toContain('--neg low quality')
    native.close()
  })

  it('filters by source, searches text, and treats wildcard characters literally', () => {
    const { native, db } = createDatabase()
    expect(queryPromptAssets(db, { source: 'asset', query: '肖像' }).items).toHaveLength(1)
    expect(queryPromptAssets(db, { query: 'long hair' }).total).toBe(4)
    expect(queryPromptAssets(db, { query: '%' }).total).toBe(0)
    expect(queryPromptAssets(db, { query: String.fromCharCode(92) }).total).toBe(0)
    native.close()
  })

  it('validates paging and source boundaries', () => {
    expect(validatePromptAssetQuery({ limit: 100, offset: 5 }).limit).toBe(100)
    expect(() => validatePromptAssetQuery({ limit: 101 })).toThrow('每页数量')
    expect(() => validatePromptAssetQuery({ source: 'unknown' })).toThrow('来源')
  })

  it('returns stable pages in newest-first order', () => {
    const { native, db } = createDatabase()
    const first = queryPromptAssets(db, { limit: 2, offset: 0 })
    const second = queryPromptAssets(db, { limit: 2, offset: 2 })
    expect(first.items.map(item => item.source)).toEqual(['asset', 'history'])
    expect(second.items.map(item => item.source)).toEqual(['preset', 'favorite'])
    native.close()
  })

  it('ignores malformed legacy preset JSON instead of failing the whole browser', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO presets VALUES (?,?,?,?)', ['broken', '损坏预设', '{bad json', '2026-01-05'])
    expect(queryPromptAssets(db, {}).total).toBe(4)
    native.close()
  })

  it('deletes only canvas-owned prompt assets by source reference', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset2', 'canvas-ref', 'asset', '画布资产', 'blue sky', '', '', '', 0, 0, '', '2026-01-06', '2026-01-06', 'global'])
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['legacy1', 'canvas-ref', 'suigu-search-index', '外部索引', 'blue sky', '', '', '', 0, 0, '', '2026-01-06', '2026-01-06', 'global'])
    expect(deletePromptAsset(db, 'canvas-ref')).toBe(true)
    expect(queryPromptAssets(db, { source: 'asset' }).items.map(item => item.sourceRef)).not.toContain('canvas-ref')
    expect(db.exec("SELECT source FROM prompt_assets WHERE source_id='canvas-ref'")[0]?.values).toEqual([['suigu-search-index']])
    native.close()
  })
})

describe('prompt asset write protection', () => {
  // A real built-in row carries `source='asset'` exactly like a user-created one — verified
  // against the live library, where all 1,742 imported rows have it. So the discriminator
  // must be the id prefix `createPromptAsset` mints, and these tests pin that.
  it('recognises imported rows, and NOT canvas-created ones', () => {
    // The marker is the builtin_ prefix an importer assigns. An earlier version tested the
    // inverse (`asset:` = user-created) and classified canvas rows as non-user, breaking
    // their deletion — the existing delete test caught it.
    expect(isImportedPromptRow('builtin_01bbb053a8fac80fc510157e')).toBe(true)
    expect(isImportedPromptRow('asset:8e1cf342-8615-49f1-ac2f-315ca4211850')).toBe(false)
    expect(isImportedPromptRow('asset2')).toBe(false)
  })

  it('refuses to edit an imported row even though its source is "asset"', () => {
    const { native, db } = createDatabase()
    // Same `source` value as a user row; only the id distinguishes them.
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['builtin_abc', 'builtin:pack:x', 'asset', '内置条目', 'content', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    expect(updatePromptAsset(db, 'builtin_abc', { name: 'changed' })).toBeNull()
    // And it is genuinely untouched, not merely reported as refused.
    expect(String(native.prepare('SELECT name FROM prompt_assets WHERE id=?').get('builtin_abc')?.name)).toBe('内置条目')
    native.close()
  })

  it('refuses to edit a row imported under a non-asset source', () => {
    const { native, db } = createDatabase()
    // The fixture's first row is `source='suigu-search-index'` with a non-builtin id.
    expect(updatePromptAsset(db, 'asset1', { visibility: 'restricted' })).toBeNull()
    expect(String(native.prepare('SELECT visibility FROM prompt_assets WHERE id=?').get('asset1')?.visibility)).toBe('global')
    native.close()
  })

  it('refuses to delete an imported row', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['builtin_abc', 'builtin:pack:x', 'asset', '内置条目', 'content', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    expect(deletePromptAsset(db, 'builtin:pack:x')).toBe(false)
    // Assert the ROW survived rather than a raw count: the harness seeds its own rows, so a
    // count assertion couples this test to the fixture and says nothing about the row.
    expect(native.prepare('SELECT count(*) c FROM prompt_assets WHERE source_id=?').get('builtin:pack:x')?.c).toBe(1)
    native.close()
  })

  it('edits a user-created row and leaves the untouched field alone', () => {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset:uuid-1', 'asset-src-1', 'asset', '原名', '原内容', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    const updated = updatePromptAsset(db, 'asset:uuid-1', { name: '新名' })
    expect(updated).toMatchObject({ name: '新名', prompt: '原内容' })
    // The stored row agrees with the returned projection.
    const stored = native.prepare('SELECT name, prompt FROM prompt_assets WHERE id=?').get('asset:uuid-1')
    expect(stored).toMatchObject({ name: '新名', prompt: '原内容' })
    native.close()
  })
})

describe('prompt visibility updates', () => {
  const insertPrompt = (db: ReturnType<typeof createDatabase>['db'], id: string, visibility: 'global' | 'restricted') =>
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, 'src-' + id, 'asset', 'original', 'body', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', visibility])

  const insertBinding = (db: ReturnType<typeof createDatabase>['db'], promptId: string, targetId = 'assistant-1') =>
    db.run('INSERT INTO cherry_prompt_bindings (prompt_id,target_type,target_id,created_at) VALUES (?,?,?,?)', [promptId, 'assistant', targetId, '2026-01-01'])

  const storedVisibility = (native: DatabaseSync, id: string) =>
    String(native.prepare('SELECT visibility FROM prompt_assets WHERE id=?').get(id)?.visibility)

  it('stores and returns the restricted visibility instead of projecting global', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-1', 'global')

    const updated = updatePromptAsset(db, 'asset:visible-1', { visibility: 'restricted' })

    expect(updated).toMatchObject({ id: 'asset:visible-1', visibility: 'restricted' })
    expect(storedVisibility(native, 'asset:visible-1')).toBe('restricted')
    expect(queryPromptAssets(db, { source: 'asset' }).items.find(item => item.id === 'asset:asset:visible-1')?.visibility).toBe('restricted')
    native.close()
  })

  it('leaves an existing binding in place when a prompt stays restricted', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-2', 'restricted')
    insertBinding(db, 'asset:visible-2')

    const updated = updatePromptAsset(db, 'asset:visible-2', { name: 'renamed', visibility: 'restricted' })

    expect(updated).toMatchObject({ name: 'renamed', visibility: 'restricted' })
    expect(native.prepare('SELECT count(*) c FROM cherry_prompt_bindings WHERE prompt_id=?').get('asset:visible-2')?.c).toBe(1)
    native.close()
  })

  it('does not invent binding targets when a global prompt becomes restricted', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-3', 'global')

    updatePromptAsset(db, 'asset:visible-3', { visibility: 'restricted' })

    expect(storedVisibility(native, 'asset:visible-3')).toBe('restricted')
    expect(native.prepare('SELECT count(*) c FROM cherry_prompt_bindings').get()?.c).toBe(0)
    native.close()
  })

  it('rejects making a bound prompt global without an expectedBindings snapshot', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-4', 'restricted')
    insertBinding(db, 'asset:visible-4')

    expect(() => updatePromptAsset(db, 'asset:visible-4', { visibility: 'global' })).toThrow('PROMPT_BINDINGS_CONFLICT')
    expect(storedVisibility(native, 'asset:visible-4')).toBe('restricted')
    expect(native.prepare('SELECT count(*) c FROM cherry_prompt_bindings WHERE prompt_id=?').get('asset:visible-4')?.c).toBe(1)
    native.close()
  })

  it('rejects a stale expectedBindings snapshot without a partial write', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-5', 'restricted')
    insertBinding(db, 'asset:visible-5', 'assistant-current')

    expect(() => updatePromptAsset(db, 'asset:visible-5', {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-stale' }]
    })).toThrow('PROMPT_BINDINGS_CONFLICT')

    expect(storedVisibility(native, 'asset:visible-5')).toBe('restricted')
    expect(native.prepare('SELECT target_id FROM cherry_prompt_bindings WHERE prompt_id=?').get('asset:visible-5')?.target_id).toBe('assistant-current')
    native.close()
  })

  it('clears bindings and stores global when the snapshot matches', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-6', 'restricted')
    insertBinding(db, 'asset:visible-6', 'assistant-1')
    insertBinding(db, 'asset:visible-6', 'assistant-2')

    const updated = updatePromptAsset(db, 'asset:visible-6', {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-2' }, { type: 'assistant', id: 'assistant-1' }]
    })

    expect(updated).toMatchObject({ visibility: 'global' })
    expect(storedVisibility(native, 'asset:visible-6')).toBe('global')
    expect(native.prepare('SELECT count(*) c FROM cherry_prompt_bindings WHERE prompt_id=?').get('asset:visible-6')?.c).toBe(0)
    native.close()
  })

  it('compares the snapshot in logical target space when both id forms are bound', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-6b', 'restricted')
    // The create route binds by stored id; the list route binds by the `asset:` alias.
    // They are the same prompt and the same target, so the snapshot has one entry.
    insertBinding(db, 'asset:visible-6b', 'assistant-1')
    insertBinding(db, 'asset:asset:visible-6b', 'assistant-1')

    const updated = updatePromptAsset(db, 'asset:visible-6b', {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-1' }]
    })

    expect(updated).toMatchObject({ visibility: 'global' })
    expect(native.prepare("SELECT count(*) c FROM cherry_prompt_bindings WHERE prompt_id IN ('asset:visible-6b','asset:asset:visible-6b')").get()?.c).toBe(0)
    native.close()
  })

  it('rolls the visibility change back when clearing bindings fails', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-7', 'restricted')
    insertBinding(db, 'asset:visible-7')
    db.exec("CREATE TRIGGER reject_binding_delete BEFORE DELETE ON cherry_prompt_bindings BEGIN SELECT RAISE(ABORT,'fixture failure'); END")

    expect(() => updatePromptAsset(db, 'asset:visible-7', {
      visibility: 'global',
      expectedBindings: [{ type: 'assistant', id: 'assistant-1' }]
    })).toThrow()

    expect(storedVisibility(native, 'asset:visible-7')).toBe('restricted')
    expect(native.prepare('SELECT count(*) c FROM cherry_prompt_bindings WHERE prompt_id=?').get('asset:visible-7')?.c).toBe(1)
    native.close()
  })

  it('rejects unknown visibility values', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-8', 'global')

    expect(() => updatePromptAsset(db, 'asset:visible-8', { visibility: 'private' })).toThrow('INVALID_VISIBILITY')
    expect(storedVisibility(native, 'asset:visible-8')).toBe('global')
    native.close()
  })

  it('rejects expectedBindings unless the update is explicitly global', () => {
    const { native, db } = createDatabase()
    insertPrompt(db, 'asset:visible-9', 'restricted')

    expect(() => updatePromptAsset(db, 'asset:visible-9', {
      visibility: 'restricted',
      expectedBindings: []
    })).toThrow('INVALID_EXPECTED_BINDINGS')
    expect(storedVisibility(native, 'asset:visible-9')).toBe('restricted')
    native.close()
  })
})

describe('prompt asset ordering', () => {
  function seedTwo() {
    const { native, db } = createDatabase()
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset:a', 'src-a', 'asset', 'A', 'pa', '', '', '', 0, 0, '', '2026-01-02', '2026-01-02', 'global'])
    db.run('INSERT INTO prompt_assets (id,source_id,source,name,prompt,chapter,section,subsection,nsfw,variant_count,source_fingerprint,created_at,updated_at,visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['asset:b', 'src-b', 'asset', 'B', 'pb', '', '', '', 0, 0, '', '2026-01-01', '2026-01-01', 'global'])
    return { native, db }
  }

  it('lists in stored-id space, matching what the route compares against', () => {
    const { native, db } = seedTwo()
    // Recency decides the default order (A is newer), and ids come back as stored.
    expect(orderedPromptAssetIds(db)).toEqual(['asset:a', 'asset:b'])
    native.close()
  })

  it('creates a resource-state row for an asset that has none', () => {
    const { native, db } = seedTwo()
    // Assets predating this feature have no projection row; an UPDATE-only write would
    // silently affect zero rows and the move would look applied while changing nothing.
    reorderPromptAsset(db, 'asset:b', { position: 'first' })
    const key = native.prepare("SELECT order_key FROM cherry_resource_state WHERE entity_type='prompt' AND entity_id=?").get('asset:b') as { order_key?: string } | undefined
    expect(key).toBeTruthy()
    expect(String(key?.order_key ?? '').length).toBeGreaterThan(0)
    native.close()
  })

  it('moves an item relative to before/after anchors and to an end', () => {
    const { native, db } = seedTwo()
    expect(orderedPromptAssetIds(db)).toEqual(['asset:a', 'asset:b'])
    reorderPromptAsset(db, 'asset:b', { before: 'asset:a' })
    expect(orderedPromptAssetIds(db)).toEqual(['asset:b', 'asset:a'])
    reorderPromptAsset(db, 'asset:b', { after: 'asset:a' })
    expect(orderedPromptAssetIds(db)).toEqual(['asset:a', 'asset:b'])
    reorderPromptAsset(db, 'asset:b', { position: 'first' })
    expect(orderedPromptAssetIds(db)).toEqual(['asset:b', 'asset:a'])
    native.close()
  })

  it('throws on an unknown anchor rather than appending', () => {
    const { native, db } = seedTwo()
    // A stale client referencing a deleted prompt must not get a silent move-to-end, which
    // would read as success while putting the row somewhere the user did not ask for.
    expect(() => reorderPromptAsset(db, 'asset:b', { before: 'asset:gone' })).toThrow('ORDER_ANCHOR_NOT_FOUND')
    native.close()
  })
})
