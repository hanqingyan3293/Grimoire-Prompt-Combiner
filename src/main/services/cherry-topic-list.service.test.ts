import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { listTopicsPage } from './cherry-topic-list.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-tlist-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

let sessionId = ''

function seedTopic(id: string, title: string, options: { pinned?: boolean; archived?: boolean; orderKey?: string } = {}): void {
  const db = getDatabase()
  db.run(
    'INSERT INTO ai_topics (id, session_id, parent_id, title, pinned, archived, metadata_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, sessionId, null, title, options.pinned ? 1 : 0, options.archived ? 1 : 0, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
  )
  db.run(
    'INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['topic', id, options.archived ? 1 : 0, null, options.pinned ? 1 : 0, options.orderKey ?? id, null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
  )
}

async function init(): Promise<void> {
  await initDatabase()
  getDatabase().run('INSERT INTO ai_sessions (id,kind,runtime,provider_id,model_id,title,status,parent_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['s1', 'chat', 'openai-compatible', '', '', 'S', 'idle', null, '{}', '2026-01-01', '2026-01-01'])
  sessionId = 's1'
}

describe('global topic list', () => {
  it('lists active topics pinned-first, then by order key', async () => {
    await init()
    seedTopic('t_c', 'C', { orderKey: '00000000000000000003' })
    seedTopic('t_a', 'A', { orderKey: '00000000000000000001' })
    seedTopic('t_b', 'B', { orderKey: '00000000000000000002' })
    seedTopic('t_p', 'Pinned', { pinned: true, orderKey: '00000000000000000009' })
    // Pinned first even though its order key sorts last.
    expect(listTopicsPage({}).items.map(row => row.id)).toEqual(['t_p', 't_a', 't_b', 't_c'])
  })

  it('excludes archived topics unless inTrash asks for them', async () => {
    await init()
    seedTopic('t_live', 'Live')
    seedTopic('t_gone', 'Gone', { archived: true })
    expect(listTopicsPage({}).items.map(row => row.id)).toEqual(['t_live'])
    // The recycle-bin view is a different set, not a superset.
    expect(listTopicsPage({ inTrash: true }).items.map(row => row.id)).toEqual(['t_gone'])
  })

  it('filters by name substring, case-insensitively', async () => {
    await init()
    seedTopic('t1', 'Prompt Engineering')
    seedTopic('t2', 'unrelated')
    expect(listTopicsPage({ q: 'PROMPT' }).items.map(row => row.id)).toEqual(['t1'])
    expect(listTopicsPage({ q: 'nothing-matches' }).items).toEqual([])
  })

  it('filters by explicit ids', async () => {
    await init()
    seedTopic('t1', 'A')
    seedTopic('t2', 'B')
    seedTopic('t3', 'C')
    expect(listTopicsPage({ ids: ['t1', 't3'] }).items.map(row => row.id).sort()).toEqual(['t1', 't3'])
  })

  it('pages with a cursor WITHOUT repeating or skipping rows', async () => {
    await init()
    for (let index = 0; index < 7; index += 1) {
      seedTopic('t' + index, 'T' + index, { orderKey: String(index).padStart(20, '0') })
    }
    const first = listTopicsPage({ limit: 3 })
    expect(first.items.map(row => row.id)).toEqual(['t0', 't1', 't2'])
    expect(first.nextCursor).toBeTruthy()

    const second = listTopicsPage({ limit: 3, cursor: first.nextCursor })
    expect(second.items.map(row => row.id)).toEqual(['t3', 't4', 't5'])

    const third = listTopicsPage({ limit: 3, cursor: second.nextCursor })
    expect(third.items.map(row => row.id)).toEqual(['t6'])
    // The source's contract: `undefined` means no more data. An empty string would keep a
    // truthiness-testing caller paging forever.
    expect(third.nextCursor).toBeUndefined()

    // The union of the pages is exactly the full set, each row once.
    const seen = [...first.items, ...second.items, ...third.items].map(row => row.id)
    expect(seen).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6'])
  })

  it('pages correctly ACROSS the pinned/unpinned boundary', async () => {
    await init()
    // The cursor carries `pinned` as its first component, so a page ending on a pinned row must
    // resume into the unpinned rows rather than restarting or skipping.
    seedTopic('p1', 'P1', { pinned: true, orderKey: '00000000000000000001' })
    seedTopic('p2', 'P2', { pinned: true, orderKey: '00000000000000000002' })
    seedTopic('u1', 'U1', { orderKey: '00000000000000000003' })
    seedTopic('u2', 'U2', { orderKey: '00000000000000000004' })

    const first = listTopicsPage({ limit: 2 })
    expect(first.items.map(row => row.id)).toEqual(['p1', 'p2'])
    const second = listTopicsPage({ limit: 2, cursor: first.nextCursor })
    expect(second.items.map(row => row.id)).toEqual(['u1', 'u2'])
  })

  it('treats a malformed cursor as "start from the beginning" rather than erroring', async () => {
    await init()
    seedTopic('t1', 'A')
    seedTopic('t2', 'B')
    // A user with a stale or hand-edited cursor should see the list, not an error page.
    expect(listTopicsPage({ limit: 1, cursor: 'not-a-real-cursor' }).items.map(row => row.id)).toEqual(['t1'])
  })

  it('clamps the limit into the source bounds', async () => {
    await init()
    seedTopic('t1', 'A')
    // The source schema caps at 200 and requires a positive integer; a 0 or NaN falls back to
    // the default rather than returning everything.
    expect(listTopicsPage({ limit: 0 }).items).toHaveLength(1)
    expect(listTopicsPage({ limit: Number.NaN }).items).toHaveLength(1)
    expect(listTopicsPage({ limit: 99999 }).items).toHaveLength(1)
  })
})
