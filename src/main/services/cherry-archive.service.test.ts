import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { archiveAiAssistant, archiveAiTopic, restoreAiAssistant } from './cherry-assistant.service'
import { archiveAiSession, createAiSession, restoreAiSession } from './ai-session.service'
import { listArchives } from './cherry-archive.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-arch-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('recycle bin listing', () => {
  it('is EMPTY until something is archived, and populated after', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', title: '会被归档的会话' })
    // Nothing archived yet — the bin must be empty, not full of live entities.
    expect(listArchives().items).toHaveLength(0)

    archiveAiSession(session.id)
    const items = listArchives().items
    expect(items).toHaveLength(1)
    // The source's synthetic composite id, which the UI splits to route a restore.
    expect(items[0]).toMatchObject({ id: 'sessions:' + session.id, entityId: session.id, domain: 'sessions', name: '会被归档的会话' })
    // `deletedAt` is a NUMBER (epoch ms) — the source UI formats it as a date, and a string
    // would render as Invalid Date rather than failing loudly.
    expect(typeof items[0].deletedAt).toBe('number')
    expect(items[0].deletedAt).toBeGreaterThan(0)
  })

  it('lists all three tracked domains in one page', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', title: 'S' })
    archiveAiSession(session.id)
    const topic = getDatabase()
    getDatabase().run(
      'INSERT INTO ai_topics (id,session_id,parent_id,title,pinned,archived,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ['t1', session.id, null, 'T', 0, 0, '{}', '2026-01-01', '2026-01-01']
    )
    getDatabase().run(
      "INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES ('topic','t1',1,'2026-01-02T00:00:00.000Z',0,'k',NULL,NULL,'2026-01-01','2026-01-01','2026-01-01')"
    )
    const assistants = getDatabase()
    assistants.run(
      'INSERT INTO ai_assistants (id,name,description,system_prompt,provider_id,model_id,avatar,settings_json,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ['a1', 'A', '', '', '', '', '', '{}', 0, '2026-01-01', '2026-01-01']
    )
    getDatabase().run(
      "INSERT OR IGNORE INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES ('assistant','a1',1,'2026-01-03T00:00:00.000Z',0,'k',NULL,NULL,'2026-01-01','2026-01-01','2026-01-01')"
    )

    // Pin every timestamp explicitly: `archiveAiSession` stamps `deleted_at` with NOW, so a
    // hand-written date for the other rows made the order depend on when the test ran — the
    // first version asserted `assistants` first and got `sessions`, because "now" beats any
    // fixed date. The ordering itself was correct.
    for (const [entityType, entityId, day] of [
      ['session', session.id, 1], ['topic', 't1', 2], ['assistant', 'a1', 3]
    ] as const) {
      getDatabase().run(
        'UPDATE cherry_resource_state SET deleted_at=? WHERE entity_type=? AND entity_id=?',
        [new Date(Date.UTC(2026, 0, day)).toISOString(), entityType, entityId]
      )
    }

    const domains = listArchives().items.map(entry => entry.domain).sort()
    expect(domains).toEqual(['assistants', 'sessions', 'topics'])
    // Newest-deleted first, matching the source's `deletedAt DESC` ordering.
    expect(listArchives().items.map(entry => entry.domain)).toEqual(['assistants', 'topics', 'sessions'])
  })

  it('REMOVES an entry when it is restored — the bin is not a second list of live entities', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', title: '恢复我' })
    archiveAiSession(session.id)
    expect(listArchives().items).toHaveLength(1)
    restoreAiSession(session.id)
    // `updateAiSessionResource` clears `deleted_at` on restore; if it did not, the entity would
    // appear BOTH in the live list and the bin, and restoring would never remove it.
    expect(listArchives().items).toHaveLength(0)
  })

  it('pages with a cursor without repeating or skipping', async () => {
    await initDatabase()
    for (let index = 0; index < 5; index += 1) {
      const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', title: 'S' + index })
      archiveAiSession(session.id)
      // Distinct timestamps so the keyset order is deterministic.
      getDatabase().run(
        "UPDATE cherry_resource_state SET deleted_at=? WHERE entity_type='session' AND entity_id=?",
        [new Date(Date.UTC(2026, 0, index + 1)).toISOString(), session.id]
      )
    }
    const first = listArchives({ limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBeTruthy()

    const second = listArchives({ limit: 2, cursor: first.nextCursor })
    expect(second.items).toHaveLength(2)
    const third = listArchives({ limit: 2, cursor: second.nextCursor })
    expect(third.items).toHaveLength(1)
    expect(third.nextCursor).toBeUndefined()

    const ids = [...first.items, ...second.items, ...third.items].map(entry => entry.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('resumes past a cursor whose row was restored, rather than restarting the list', async () => {
    await initDatabase()
    const sessions = []
    for (let index = 0; index < 4; index += 1) {
      const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', title: 'S' + index })
      archiveAiSession(session.id)
      getDatabase().run(
        "UPDATE cherry_resource_state SET deleted_at=? WHERE entity_type='session' AND entity_id=?",
        [new Date(Date.UTC(2026, 0, index + 1)).toISOString(), session.id]
      )
      sessions.push(session)
    }
    const first = listArchives({ limit: 2 })
    const cursor = first.nextCursor!
    // Restore the row the cursor named — a plausible race, since the user can act in another
    // window between pages.
    restoreAiSession(sessions[1].id)

    const second = listArchives({ limit: 2, cursor })
    // It must NOT restart from the beginning (which would re-show the first page), and must not
    // error; it resumes at the position the removed row occupied.
    expect(second.items.map(entry => entry.entityId)).not.toContain(sessions[1].id)
    expect(second.items.length).toBeGreaterThan(0)
  })

  it('treats a malformed cursor as "start from the beginning"', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat', runtime: 'openai-compatible', title: 'X' })
    archiveAiSession(session.id)
    expect(listArchives({ cursor: 'not-a-cursor' }).items).toHaveLength(1)
  })
})
