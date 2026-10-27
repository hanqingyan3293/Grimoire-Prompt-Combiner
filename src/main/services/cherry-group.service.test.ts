import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createGroup, deleteGroup, getGroup, listGroups, renameGroup, reorderGroup } from './cherry-group.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-group-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

function seedEntity(entityType: string, entityId: string, groupId: string | null): void {
  getDatabase().run(
    'INSERT INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [entityType, entityId, 0, null, 0, '', groupId, null, '2026-01-01', '2026-01-01', '2026-01-01']
  )
}

describe('Cherry groups adapter', () => {
  it('creates a group in the source Group shape and lists it by entity type', async () => {
    await initDatabase()
    const created = createGroup('assistant', '写作')
    expect(created).toMatchObject({ entityType: 'assistant', name: '写作' })
    expect(created!.id).toBeTruthy()
    // The source requires a non-empty orderKey.
    expect(created!.orderKey.length).toBeGreaterThan(0)
    expect(listGroups('assistant').map(group => group.name)).toEqual(['写作'])
  })

  it('rejects an empty or over-long name rather than creating a nameless group', async () => {
    await initDatabase()
    // An unnamed group renders as a blank rail header indistinguishable from another blank one.
    expect(createGroup('assistant', '   ')).toBeNull()
    expect(createGroup('assistant', '')).toBeNull()
    expect(createGroup('assistant', 'x'.repeat(500))).toBeNull()
    expect(listGroups('assistant')).toHaveLength(0)
  })

  it('scopes groups by entity type — an assistant group is not visible to topics', async () => {
    await initDatabase()
    createGroup('assistant', '写作')
    createGroup('topic', '研究')
    expect(listGroups('assistant').map(group => group.name)).toEqual(['写作'])
    expect(listGroups('topic').map(group => group.name)).toEqual(['研究'])
  })

  it('answers an empty list for entity types it does not track', async () => {
    await initDatabase()
    // `model` IS tracked; a nonsense type is not. Neither should fabricate a group.
    expect(listGroups('nonsense')).toEqual([])
    expect(createGroup('nonsense', 'x')).toBeNull()
  })

  it('renames a group and reports a missing one honestly', async () => {
    await initDatabase()
    const group = createGroup('assistant', '旧名')!
    expect(renameGroup(group.id, '新名')?.name).toBe('新名')
    expect(getGroup(group.id)?.name).toBe('新名')
    // A vanished group answers null so the caller can 404 rather than claiming success.
    expect(renameGroup('never-existed', 'x')).toBeNull()
    expect(renameGroup(group.id, '  ')).toBeNull()
  })

  it('deletes a group AND detaches every entity that pointed at it', async () => {
    await initDatabase()
    const group = createGroup('assistant', '写作')!
    seedEntity('assistant', 'a1', group.id)
    seedEntity('assistant', 'a2', group.id)

    expect(deleteGroup(group.id)).toBe(true)
    expect(getGroup(group.id)).toBeNull()
    // Leaving `group_id` pointing at a removed row would render entities under a header whose
    // name can no longer be resolved.
    const stale = getDatabase().exec("SELECT count(*) FROM cherry_resource_state WHERE group_id=?", [group.id])[0]?.values?.[0]?.[0]
    expect(Number(stale)).toBe(0)
    expect(deleteGroup(group.id)).toBe(false)
  })

  it('reorders a group relative to siblings and to an end', async () => {
    await initDatabase()
    const a = createGroup('assistant', 'A')!
    const b = createGroup('assistant', 'B')!
    const c = createGroup('assistant', 'C')!
    expect(listGroups('assistant').map(g => g.name)).toEqual(['A', 'B', 'C'])

    expect(reorderGroup(c.id, { position: 'first' })).toBe(true)
    expect(listGroups('assistant').map(g => g.name)).toEqual(['C', 'A', 'B'])

    expect(reorderGroup(c.id, { position: 'last' })).toBe(true)
    expect(listGroups('assistant').map(g => g.name)).toEqual(['A', 'B', 'C'])

    expect(reorderGroup(c.id, { before: a.id })).toBe(true)
    expect(listGroups('assistant').map(g => g.name)).toEqual(['C', 'A', 'B'])
  })

  it('answers false for an unknown anchor rather than appending', async () => {
    await initDatabase()
    const a = createGroup('assistant', 'A')!
    createGroup('assistant', 'B')
    // A stale client naming a deleted group must get a conflict, not a silent move to the end.
    expect(reorderGroup(a.id, { before: 'deleted-group' })).toBe(false)
    expect(listGroups('assistant').map(g => g.name)).toEqual(['A', 'B'])
  })

  it('persists across a re-read of the raw table', async () => {
    await initDatabase()
    const group = createGroup('assistant', '持久化')!
    // Read the raw column rather than the service, so a persistence bug cannot pass on the
    // service's own return value.
    const name = getDatabase().exec('SELECT name FROM cherry_resource_groups WHERE id=?', [group.id])[0]?.values?.[0]?.[0]
    expect(String(name)).toBe('持久化')
  })
})
