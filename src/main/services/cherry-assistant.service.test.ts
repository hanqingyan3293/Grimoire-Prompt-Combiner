import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import {
  archiveAiAssistant,
  archiveAiTopic,
  deleteAiAssistant,
  deleteAiTopic,
  getLatestAiTopic,
  listAiAssistants,
  listAiTopics,
  pinAiAssistant,
  pinAiTopic,
  reorderAiAssistant,
  reorderAiTopic,
  restoreAiAssistant,
  restoreAiTopic,
  saveAiAssistant,
  saveAiTopic
} from './cherry-assistant.service'
import { appendAiMessage, createAiSession } from './ai-session.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-cherry-assistant-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('Cherry assistant and topic persistence', () => {
  it('keeps assistant settings and updates without duplicating the record', async () => {
    await initDatabase()
    const created = saveAiAssistant({ name: '写作助手', system_prompt: '保持简洁', settings: { temperature: 0.4 } })
    const updated = saveAiAssistant({ id: created.id, name: '写作助手 2', model_id: 'model-a' })
    expect(updated.id).toBe(created.id)
    expect(listAiAssistants()).toHaveLength(1)
    expect(listAiAssistants()[0]).toMatchObject({ name: '写作助手 2', system_prompt: '保持简洁', model_id: 'model-a', settings: { temperature: 0.4 } })
    expect(deleteAiAssistant(created.id)).toBe(true)
    expect(listAiAssistants()).toHaveLength(0)
  })

  it('stores topic hierarchy and archive state against an AI session', async () => {
    await initDatabase()
    const session = createAiSession({ title: 'Cherry 会话' })
    const parent = saveAiTopic({ session_id: session.id, title: '主主题', pinned: true })
    const child = saveAiTopic({ session_id: session.id, parent_id: parent.id, title: '子主题' })
    expect(listAiTopics(session.id)).toMatchObject([{ id: parent.id, pinned: true }, { id: child.id, parent_id: parent.id }])
    saveAiTopic({ id: child.id, session_id: session.id, archived: true })
    expect(listAiTopics(session.id)).toHaveLength(1)
    expect(listAiTopics(session.id, true)).toHaveLength(2)
    expect(deleteAiTopic(parent.id)).toBe(true)
    expect(listAiTopics(session.id, true).find(item => item.id === child.id)?.parent_id).toBeNull()
  })

  it('keeps assistant/topic lifecycle separate from permanent deletion and preserves messages', async () => {
    await initDatabase()
    const session = createAiSession({ title: '生命周期会话' })
    const assistant = saveAiAssistant({ name: '可归档助手' })
    const topic = saveAiTopic({ session_id: session.id, title: '可归档主题' })
    appendAiMessage({ sessionId: session.id, role: 'user', content: '保留的消息' })

    const archivedAssistant = archiveAiAssistant(assistant.id)
    expect(archivedAssistant.archived).toBe(true)
    expect(listAiAssistants()).toHaveLength(0)
    expect(listAiAssistants(true)).toMatchObject([{ id: assistant.id, archived: true }])
    expect(pinAiAssistant(assistant.id, true).pinned).toBe(true)
    expect(restoreAiAssistant(assistant.id).archived).toBe(false)

    const archivedTopic = archiveAiTopic(topic.id)
    expect(archivedTopic.archived).toBe(true)
    expect(listAiTopics(session.id)).toHaveLength(0)
    expect(pinAiTopic(topic.id, true).pinned).toBe(true)
    expect(restoreAiTopic(topic.id).archived).toBe(false)
    expect(listAiTopics(session.id, true)).toMatchObject([{ id: topic.id, pinned: true, archived: false }])
    expect(getDatabase().exec('SELECT COUNT(*) FROM ai_messages WHERE session_id=?', [session.id])[0]?.values?.[0]?.[0]).toBe(1)
  })

  it('repairs a missing v20 projection row before lifecycle mutations', async () => {
    await initDatabase()
    const assistant = saveAiAssistant({ name: '缺失投影助手' })
    const topicSession = createAiSession({ title: '投影会话' })
    const topic = saveAiTopic({ session_id: topicSession.id, title: '缺失投影主题' })
    getDatabase().run('DELETE FROM cherry_resource_state WHERE entity_type=? AND entity_id=?', ['assistant', assistant.id])
    getDatabase().run('DELETE FROM cherry_resource_state WHERE entity_type=? AND entity_id=?', ['topic', topic.id])

    expect(archiveAiAssistant(assistant.id).archived).toBe(true)
    expect(restoreAiAssistant(assistant.id).archived).toBe(false)
    expect(pinAiTopic(topic.id, true).pinned).toBe(true)
    expect(getDatabase().exec('SELECT COUNT(*) FROM cherry_resource_state WHERE (entity_type=? AND entity_id=?) OR (entity_type=? AND entity_id=?)', ['assistant', assistant.id, 'topic', topic.id])[0]?.values?.[0]?.[0]).toBe(2)
  })

  it('reorders assistants with fractional anchors and rejects unknown anchors', async () => {
    await initDatabase()
    const a = saveAiAssistant({ name: '助手 A' })
    const b = saveAiAssistant({ name: '助手 B' })
    const c = saveAiAssistant({ name: '助手 C' })
    // Seed keys are order-agnostic (equal sort_order), so lay an explicit baseline first.
    reorderAiAssistant({ id: a.id, anchor: { position: 'last' } })
    reorderAiAssistant({ id: b.id, anchor: { position: 'last' } })
    reorderAiAssistant({ id: c.id, anchor: { position: 'last' } })
    expect(listAiAssistants(false, true).map(item => item.id)).toEqual([a.id, b.id, c.id])

    reorderAiAssistant({ id: c.id, anchor: { before: a.id } })
    expect(listAiAssistants(false, true).map(item => item.id)).toEqual([c.id, a.id, b.id])

    reorderAiAssistant({ id: a.id, anchor: { after: c.id } })
    expect(listAiAssistants(false, true).map(item => item.id)).toEqual([c.id, a.id, b.id])

    reorderAiAssistant({ id: b.id, anchor: { position: 'last' } })
    expect(listAiAssistants(false, true).map(item => item.id)).toEqual([c.id, a.id, b.id])

    expect(() => reorderAiAssistant({ id: a.id, anchor: { before: 'ai_assistant_missing' } })).toThrow('ORDER_OVER_NOT_FOUND')
    // Manual list order and reorder agree because both use the same key precedence.
    expect(listAiAssistants(true, true).map(item => item.id)).toEqual([c.id, a.id, b.id])
  })

  it('keeps repeated assistant insertions ordered, rewriting unrelated keys only on rebalance', async () => {
    await initDatabase()
    const first = saveAiAssistant({ name: '助手 1' })
    reorderAiAssistant({ id: first.id, anchor: { position: 'last' } })
    const anchorKey = getDatabase().exec("SELECT order_key FROM cherry_resource_state WHERE entity_type='assistant' AND entity_id=?", [first.id])[0]?.values?.[0]?.[0]

    // Six appends after the same anchor still have fractional room: no rebalance, so
    // the anchor row keeps its original key and only dropped rows are written.
    for (let index = 0; index < 6; index += 1) {
      const created = saveAiAssistant({ name: '助手 ' + (index + 2) })
      reorderAiAssistant({ id: created.id, anchor: { after: first.id } })
    }
    expect(getDatabase().exec("SELECT order_key FROM cherry_resource_state WHERE entity_type='assistant' AND entity_id=?", [first.id])[0]?.values?.[0]?.[0]).toBe(anchorKey)
    expect(listAiAssistants(false, true)[0].id).toBe(first.id)

    // Continuing until the digit space between the two neighbors is exhausted triggers
    // one scope rebalance; the relative order must survive it.
    for (let index = 6; index < 12; index += 1) {
      const created = saveAiAssistant({ name: '助手 ' + (index + 2) })
      reorderAiAssistant({ id: created.id, anchor: { after: first.id } })
    }
    const ordered = listAiAssistants(false, true)
    expect(ordered).toHaveLength(13)
    expect(ordered[0].id).toBe(first.id)
  })

  it('reorders topics inside one owner and moves ownership atomically across owners', async () => {
    await initDatabase()
    const sessionA = createAiSession({ title: '会话 A' })
    const sessionB = createAiSession({ title: '会话 B' })
    const topic1 = saveAiTopic({ session_id: sessionA.id, title: '主题一' })
    const topic2 = saveAiTopic({ session_id: sessionA.id, title: '主题二' })

    reorderAiTopic({ id: topic2.id, anchor: { before: topic1.id } })
    expect(listAiTopics(sessionA.id, false, true).map(item => item.id)).toEqual([topic2.id, topic1.id])

    const moved = reorderAiTopic({ id: topic2.id, anchor: { position: 'last' }, ownerId: sessionB.id })
    expect(moved.session_id).toBe(sessionB.id)
    expect(listAiTopics(sessionA.id, false, true).map(item => item.id)).toEqual([topic1.id])
    expect(listAiTopics(sessionB.id, false, true).map(item => item.id)).toEqual([topic2.id])
    const projection = getDatabase().exec("SELECT owner_id FROM cherry_resource_state WHERE entity_type='topic' AND entity_id=?", [topic2.id])[0]?.values?.[0]?.[0]
    expect(projection).toBe(sessionB.id)

    expect(() => reorderAiTopic({ id: topic1.id, anchor: { position: 'last' }, ownerId: 'ai_session_missing' })).toThrow('AI_SESSION_NOT_FOUND')
    expect(listAiTopics(sessionA.id, false, true).map(item => item.id)).toEqual([topic1.id])
  })

  it('resolves the latest topic by activity instead of list order and honors owner scopes', async () => {
    await initDatabase()
    const sessionA = createAiSession({ title: '会话 A' })
    const sessionB = createAiSession({ title: '会话 B' })
    const older = saveAiTopic({ session_id: sessionA.id, title: '旧主题' })
    const newer = saveAiTopic({ session_id: sessionA.id, title: '最新主题' })
    const other = saveAiTopic({ session_id: sessionB.id, title: '另一会话主题' })
    // Make `older` the pinned list head while `newer` stays the most recently active:
    // latest must follow activity, not pinned ordering.
    pinAiTopic(older.id, true)
    const newerAt = new Date(Date.now() + 60_000).toISOString()
    getDatabase().run("UPDATE cherry_resource_state SET last_activity_at=? WHERE entity_type='topic' AND entity_id=?", [newerAt, newer.id])
    const otherAt = new Date(Date.now() + 120_000).toISOString()
    getDatabase().run("UPDATE cherry_resource_state SET last_activity_at=? WHERE entity_type='topic' AND entity_id=?", [otherAt, other.id])

    expect(getLatestAiTopic({ sessionId: sessionA.id })?.id).toBe(newer.id)
    expect(getLatestAiTopic({ sessionId: sessionB.id })?.id).toBe(other.id)
    expect(getLatestAiTopic()?.id).toBe(other.id)
    archiveAiTopic(other.id)
    expect(getLatestAiTopic()?.id).toBe(newer.id)
  })

  it('excludes archived topics and resolves the unlinked owner scope for latest', async () => {
    await initDatabase()
    const session = createAiSession({ title: '会话' })
    const topic = saveAiTopic({ session_id: session.id, title: '主题' })
    // Legacy/imported data can hold topics whose session row is gone (the FK cascade
    // does not cover rows restored from an older backup); simulate exactly that state.
    const db = getDatabase()
    db.exec('PRAGMA foreign_keys=OFF')
    try { db.run('DELETE FROM ai_sessions WHERE id=?', [session.id]) } finally { db.exec('PRAGMA foreign_keys=ON') }
    expect(getLatestAiTopic({ sessionId: null })?.id).toBe(topic.id)
    expect(getLatestAiTopic({ sessionId: session.id })).toBeNull()
  })
})
