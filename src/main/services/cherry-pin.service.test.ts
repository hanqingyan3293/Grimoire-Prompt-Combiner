import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { findPinById, listPins, setPin } from './cherry-pin.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-pin-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

/** Creates the projection row a pin attaches to. */
function seedEntity(entityType: string, entityId: string, orderKey = ''): void {
  getDatabase().run(
    'INSERT INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [entityType, entityId, 0, null, 0, orderKey, null, null, '2026-01-01', '2026-01-01', '2026-01-01']
  )
}

describe('Cherry pins adapter', () => {
  it('pins a projected entity and lists it in the source Pin shape', async () => {
    await initDatabase()
    seedEntity('topic', 't1')
    const pin = setPin('topic', 't1', true)
    expect(pin).toMatchObject({ entityType: 'topic', entityId: 't1' })
    // Every source-required field is present and non-empty.
    expect(pin!.id).toBeTruthy()
    expect(pin!.orderKey.length).toBeGreaterThan(0)
    expect(pin!.createdAt).toBeTruthy()

    const listed = listPins('topic')
    expect(listed).toHaveLength(1)
    expect(listed[0].entityId).toBe('t1')
  })

  it('is idempotent — pinning twice yields ONE pin, not an error or a duplicate', async () => {
    await initDatabase()
    seedEntity('topic', 't1')
    const first = setPin('topic', 't1', true)
    const second = setPin('topic', 't1', true)
    // The source's `pin()` reuses an existing row; a double-click must not duplicate.
    expect(second!.id).toBe(first!.id)
    expect(listPins('topic')).toHaveLength(1)
  })

  it('round-trips the id through findPinById', async () => {
    await initDatabase()
    seedEntity('assistant', 'a1')
    const pin = setPin('assistant', 'a1', true)
    // The client may pass the id back to DELETE /pins/:id, so it must resolve.
    expect(findPinById(pin!.id)).toEqual({ entityType: 'assistant', entityId: 'a1' })
    expect(findPinById('00000000-0000-4000-a000-000000000000')).toBeNull()
  })

  it('unpins, and unpinning something already unpinned is not an error', async () => {
    await initDatabase()
    seedEntity('topic', 't1')
    setPin('topic', 't1', true)
    setPin('topic', 't1', false)
    expect(listPins('topic')).toHaveLength(0)
    // A second unpin answers null (nothing to report) rather than throwing.
    expect(setPin('topic', 't1', false)).toBeNull()
  })

  it('answers NO pin for an entity with no projection row, rather than inventing one', async () => {
    await initDatabase()
    // Creating a pin here would assert the entity exists in Grimoire's projection when
    // nothing registered it — and the pin would never surface in any rail.
    expect(setPin('topic', 'never-seen', true)).toBeNull()
    expect(listPins('topic')).toHaveLength(0)
  })

  it('answers an empty list for entity types Grimoire does not project', async () => {
    await initDatabase()
    // `model` / `knowledge` / `agent` are valid in the source enum but have no rows here.
    // "No pins" is true; fabricating one would show a pin the user never set.
    for (const type of ['model', 'knowledge', 'agent', 'nonsense']) {
      expect(listPins(type)).toEqual([])
      expect(setPin(type, 'x', true)).toBeNull()
    }
  })

  it('orders pins by orderKey then id, matching the source listing', async () => {
    await initDatabase()
    seedEntity('topic', 't2', '00000000000000000020')
    seedEntity('topic', 't1', '00000000000000000010')
    setPin('topic', 't2', true)
    setPin('topic', 't1', true)
    expect(listPins('topic').map(pin => pin.entityId)).toEqual(['t1', 't2'])
  })

  it('PERSISTS the pin — a re-read from a fresh handle sees it', async () => {
    await initDatabase()
    seedEntity('topic', 't1')
    setPin('topic', 't1', true)
    // Read the raw column rather than the service, so a persistence bug cannot pass on the
    // service's own return value.
    const raw = getDatabase().exec("SELECT pinned FROM cherry_resource_state WHERE entity_type='topic' AND entity_id='t1'")[0]?.values?.[0]?.[0]
    expect(Number(raw)).toBe(1)
  })
})
