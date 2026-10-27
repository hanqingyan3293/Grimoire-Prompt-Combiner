import crypto from 'crypto'
import type { AiAssistantRecord, AiResourceOrderAnchor, AiTopicRecord } from '../../shared/ai-types'
import { getDatabase, saveDatabase } from '../database'
import { compareOrderKeysEmptyLast, evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from './resource-order'

type ResourceStateOverrides = {
  archived?: boolean
  groupId?: string | null
  lastActivityAt?: string
  orderKey?: string
  ownerId?: string | null
  pinned?: boolean
}

function json<T>(value: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(value || '')) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function withTransaction<T>(work: () => T): T {
  const db = getDatabase()
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    saveDatabase()
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
}

function assistantFromRow(row: unknown[]): AiAssistantRecord {
  return {
    id: String(row[0]),
    name: String(row[1] || ''),
    description: String(row[2] || ''),
    system_prompt: String(row[3] || ''),
    provider_id: String(row[4] || ''),
    model_id: String(row[5] || ''),
    avatar: String(row[6] || ''),
    settings: json(row[7], {}),
    sort_order: Number(row[8] || 0),
    created_at: String(row[9]),
    updated_at: String(row[10]),
    archived: Number(row[11] || 0) === 1,
    pinned: Number(row[12] || 0) === 1,
    order_key: typeof row[13] === 'string' ? row[13] : '',
    group_id: row[14] == null ? null : String(row[14]) || null,
    last_activity_at: row[15] != null && String(row[15]).trim() ? String(row[15]) : String(row[10]),
  }
}

function topicFromRow(row: unknown[]): AiTopicRecord {
  return {
    id: String(row[0]),
    session_id: String(row[1]),
    parent_id: row[2] == null ? null : String(row[2]),
    title: String(row[3] || ''),
    pinned: Number(row[4]) === 1,
    archived: Number(row[5]) === 1,
    metadata: json(row[6], {}),
    created_at: String(row[7]),
    updated_at: String(row[8]),
    owner_id: row[9] == null ? null : String(row[9]) || null,
    order_key: typeof row[10] === 'string' ? row[10] : '',
    last_activity_at: row[11] != null && String(row[11]).trim() ? String(row[11]) : String(row[8]),
  }
}

const ASSISTANT_SELECT = `
  SELECT t.id, t.name, t.description, t.system_prompt, t.provider_id, t.model_id, t.avatar,
         t.settings_json, t.sort_order, t.created_at, t.updated_at,
         COALESCE(r.archived, 0), COALESCE(r.pinned, 0), COALESCE(r.order_key, ''), r.group_id,
         COALESCE(r.last_activity_at, t.updated_at)
  FROM ai_assistants t
  LEFT JOIN cherry_resource_state r ON r.entity_type='assistant' AND r.entity_id=t.id
`

const TOPIC_SELECT = `
  SELECT t.id, t.session_id, t.parent_id, t.title, t.pinned, t.archived, t.metadata_json,
         t.created_at, t.updated_at, COALESCE(r.owner_id, t.session_id),
         COALESCE(r.order_key, ''), COALESCE(r.last_activity_at, t.updated_at)
  FROM ai_topics t
  LEFT JOIN cherry_resource_state r ON r.entity_type='topic' AND r.entity_id=t.id
`

function readAssistant(id: string): AiAssistantRecord | null {
  const row = getDatabase().exec(ASSISTANT_SELECT + ' WHERE t.id=?', [id])[0]?.values?.[0]
  return row ? assistantFromRow(row) : null
}

function readTopic(id: string): AiTopicRecord | null {
  const row = getDatabase().exec(TOPIC_SELECT + ' WHERE t.id=?', [id])[0]?.values?.[0]
  return row ? topicFromRow(row) : null
}

/**
 * Source `latestTopic` contract (`/topics/latest`): dedicated `lastActivityAt DESC
 * LIMIT 1` query that does not depend on the pinned-first list order. Scoping mirrors
 * the source query: a `sessionId` targets one owner's latest topic; an explicit `null`
 * is the source `unlinked` pseudo-scope (topics whose owner is missing); omitted is the
 * global latest across all active topics.
 */
export function getLatestAiTopic(input: { sessionId?: string | null } = {}): AiTopicRecord | null {
  const db = getDatabase()
  const ids = db.exec('SELECT id FROM ai_topics')[0]?.values || []
  for (const row of ids) ensureTopicResourceState(String(row[0]))
  const clauses = ['COALESCE(r.archived,0)=0', 't.archived=0']
  const params: unknown[] = []
  if (input.sessionId === null) {
    // Source 'unlinked' scope: topics whose assistant/session owner no longer resolves.
    clauses.push('NOT EXISTS (SELECT 1 FROM ai_sessions s WHERE s.id = COALESCE(r.owner_id, t.session_id))')
  } else if (typeof input.sessionId === 'string') {
    // A topic of a removed owner is unlinked, not a topic of that owner: scope to the
    // session only while its row still exists (the compat UI passes live session ids).
    clauses.push('COALESCE(r.owner_id, t.session_id)=? AND EXISTS (SELECT 1 FROM ai_sessions s2 WHERE s2.id = COALESCE(r.owner_id, t.session_id))')
    params.push(input.sessionId)
  }
  const row = db.exec(TOPIC_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY COALESCE(r.last_activity_at, t.updated_at) DESC, t.id DESC LIMIT 1', params)[0]?.values?.[0]
  return row ? topicFromRow(row) : null
}

/** Ensure a Grimoire-owned projection row exists without replacing any existing order/group state. */
function ensureResourceState(entityType: string, entityId: string, overrides: ResourceStateOverrides = {}): void {
  const db = getDatabase()
  const existing = db.exec(
    'SELECT entity_id FROM cherry_resource_state WHERE entity_type=? AND entity_id=?',
    [entityType, entityId]
  )[0]?.values?.[0]
  if (existing) return

  const now = new Date().toISOString()
  const archived = overrides.archived === true ? 1 : 0
  db.run(
    'INSERT INTO cherry_resource_state (entity_type,entity_id,archived,deleted_at,pinned,order_key,group_id,owner_id,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [
      entityType,
      entityId,
      archived,
      archived ? now : null,
      overrides.pinned === true ? 1 : 0,
      overrides.orderKey || '',
      overrides.groupId ?? null,
      overrides.ownerId ?? null,
      overrides.lastActivityAt || now,
      now,
      now,
    ]
  )
}

function ensureAssistantResourceState(id: string, row?: unknown[]): void {
  const assistant = row || getDatabase().exec(
    'SELECT sort_order,created_at,updated_at FROM ai_assistants WHERE id=?',
    [id]
  )[0]?.values?.[0]
  if (!assistant) return
  ensureResourceState('assistant', id, {
    lastActivityAt: String(assistant[2] || assistant[1] || new Date().toISOString()),
    orderKey: String(Number(assistant[0] || 0)).padStart(20, '0'),
  })
}

function ensureTopicResourceState(id: string, row?: unknown[]): void {
  const topic = row || getDatabase().exec(
    'SELECT session_id,pinned,archived,created_at,updated_at FROM ai_topics WHERE id=?',
    [id]
  )[0]?.values?.[0]
  if (!topic) return

  const sessionId = String(topic[0])
  const archived = Number(topic[2] || 0) === 1
  const pinned = Number(topic[1] || 0) === 1
  const lastActivity = String(topic[4] || topic[3] || new Date().toISOString())
  ensureResourceState('topic', id, {
    archived,
    lastActivityAt: lastActivity,
    ownerId: sessionId,
    pinned,
    orderKey: lastActivity + ':' + id,
  })
  // ai_topics remains the canonical source for these legacy fields. Repair a
  // missing/stale projection without changing its user-controlled order key.
  getDatabase().run(
    'UPDATE cherry_resource_state SET owner_id=?,archived=?,deleted_at=?,pinned=? WHERE entity_type=? AND entity_id=?',
    [sessionId, archived ? 1 : 0, archived ? String(topic[4] || new Date().toISOString()) : null, pinned ? 1 : 0, 'topic', id]
  )
}

export function listAiAssistants(includeArchived = false, manualOrder = false): AiAssistantRecord[] {
  const db = getDatabase()
  const ids = db.exec('SELECT id,sort_order,created_at,updated_at FROM ai_assistants')[0]?.values || []
  for (const row of ids) ensureAssistantResourceState(String(row[0]), row.slice(1))
  const where = includeArchived ? '' : 'WHERE COALESCE(r.archived, 0)=0'
  // Manual mode is the explicit drag-sort view and matches `orderedResourceEntries`
  // (pinned first, un-keyed rows after keyed ones); activity order is the default.
  const orderBy = manualOrder
    ? " ORDER BY COALESCE(r.pinned,0) DESC, CASE WHEN COALESCE(r.order_key,'')='' THEN 1 ELSE 0 END ASC, COALESCE(r.order_key,'') ASC, COALESCE(r.last_activity_at,t.updated_at) DESC, t.id ASC"
    : " ORDER BY COALESCE(r.pinned,0) DESC, COALESCE(r.last_activity_at,t.updated_at) DESC, COALESCE(r.order_key,'') ASC, t.id ASC"
  const rows = db.exec(ASSISTANT_SELECT + where + orderBy)[0]?.values || []
  return rows.map(assistantFromRow)
}

export function saveAiAssistant(input: Partial<AiAssistantRecord> & { id?: string }): AiAssistantRecord {
  return withTransaction(() => {
    const db = getDatabase()
    const id = input.id || 'ai_assistant_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    const current = db.exec(
      'SELECT id,name,description,system_prompt,provider_id,model_id,avatar,settings_json,sort_order,created_at,updated_at FROM ai_assistants WHERE id=?',
      [id]
    )[0]?.values?.[0]
    const now = new Date().toISOString()
    const values = [
      id,
      input.name ?? String(current?.[1] || '新助手'),
      input.description ?? String(current?.[2] || ''),
      input.system_prompt ?? String(current?.[3] || ''),
      input.provider_id ?? String(current?.[4] || ''),
      input.model_id ?? String(current?.[5] || ''),
      input.avatar ?? String(current?.[6] || ''),
      JSON.stringify(input.settings ?? json(current?.[7], {})),
      input.sort_order ?? Number(current?.[8] || 0),
      String(current?.[9] || now),
      now,
    ]
    if (current) {
      db.run(
        'UPDATE ai_assistants SET name=?,description=?,system_prompt=?,provider_id=?,model_id=?,avatar=?,settings_json=?,sort_order=?,updated_at=? WHERE id=?',
        values.slice(1, 9).concat(values[10], id)
      )
    } else {
      db.run(
        'INSERT INTO ai_assistants (id,name,description,system_prompt,provider_id,model_id,avatar,settings_json,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        values
      )
    }
    ensureAssistantResourceState(id, [values[8], values[9], values[10]])
    const state = db.exec(
      "SELECT archived,pinned,order_key,group_id FROM cherry_resource_state WHERE entity_type='assistant' AND entity_id=?",
      [id]
    )[0]?.values?.[0]
    const archived = input.archived === undefined ? Number(state?.[0] || 0) : input.archived ? 1 : 0
    const pinned = input.pinned === undefined ? Number(state?.[1] || 0) : input.pinned ? 1 : 0
    const orderKey = input.order_key === undefined ? String(state?.[2] || '') : String(input.order_key || '').slice(0, 200)
    const groupId = input.group_id === undefined ? (state?.[3] == null ? null : String(state[3])) : input.group_id
    db.run(
      "UPDATE cherry_resource_state SET archived=?,deleted_at=?,pinned=?,order_key=?,group_id=?,last_activity_at=?,updated_at=? WHERE entity_type='assistant' AND entity_id=?",
      [archived, archived ? now : null, pinned, orderKey, groupId, now, now, id]
    )
    return readAssistant(id)!
  })
}

export function deleteAiAssistant(id: string): boolean {
  return withTransaction(() => {
    const result = getDatabase().run('DELETE FROM ai_assistants WHERE id=?', [id])
    getDatabase().run('DELETE FROM cherry_resource_state WHERE entity_type=? AND entity_id=?', ['assistant', id])
    return Number(result.changes || 0) > 0
  })
}

export function listAiTopics(sessionId: string, includeArchived = false, manualOrder = false): AiTopicRecord[] {
  const db = getDatabase()
  const ids = db.exec('SELECT id,session_id,pinned,archived,created_at,updated_at FROM ai_topics WHERE session_id=?', [sessionId])[0]?.values || []
  for (const row of ids) ensureTopicResourceState(String(row[0]), row.slice(1))
  const where = includeArchived ? 'WHERE t.session_id=?' : 'WHERE t.session_id=? AND t.archived=0'
  const orderBy = manualOrder
    ? " ORDER BY t.pinned DESC, CASE WHEN COALESCE(r.order_key,'')='' THEN 1 ELSE 0 END ASC, COALESCE(r.order_key,'') ASC, COALESCE(r.last_activity_at,t.updated_at) DESC, t.id ASC"
    : " ORDER BY t.pinned DESC, COALESCE(r.last_activity_at,t.updated_at) DESC, COALESCE(r.order_key,'') ASC, t.id ASC"
  const rows = db.exec(TOPIC_SELECT + where + orderBy, [sessionId])[0]?.values || []
  return rows.map(topicFromRow)
}

export function saveAiTopic(input: Partial<AiTopicRecord> & { session_id: string; id?: string }): AiTopicRecord {
  return withTransaction(() => {
    const db = getDatabase()
    const id = input.id || 'ai_topic_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    const current = db.exec(
      'SELECT id,session_id,parent_id,title,pinned,archived,metadata_json,created_at,updated_at FROM ai_topics WHERE id=?',
      [id]
    )[0]?.values?.[0]
    const now = new Date().toISOString()
    const values = [
      id,
      input.session_id,
      input.parent_id ?? (current?.[2] == null ? null : String(current[2])),
      input.title ?? String(current?.[3] || '新主题'),
      input.pinned === undefined ? Number(current?.[4] || 0) : input.pinned ? 1 : 0,
      input.archived === undefined ? Number(current?.[5] || 0) : input.archived ? 1 : 0,
      JSON.stringify(input.metadata ?? json(current?.[6], {})),
      String(current?.[7] || now),
      now,
    ]
    if (current) {
      db.run(
        'UPDATE ai_topics SET session_id=?,parent_id=?,title=?,pinned=?,archived=?,metadata_json=?,updated_at=? WHERE id=?',
        values.slice(1, 7).concat(values[8], id)
      )
    } else {
      db.run(
        'INSERT INTO ai_topics (id,session_id,parent_id,title,pinned,archived,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        values
      )
    }
    ensureTopicResourceState(id, [values[1], values[4], values[5], values[7], values[8]])
    const state = db.exec(
      "SELECT order_key FROM cherry_resource_state WHERE entity_type='topic' AND entity_id=?",
      [id]
    )[0]?.values?.[0]
    db.run(
      "UPDATE cherry_resource_state SET owner_id=?,archived=?,deleted_at=?,pinned=?,order_key=?,last_activity_at=?,updated_at=? WHERE entity_type='topic' AND entity_id=?",
      [String(input.session_id), Number(values[5]), Number(values[5]) ? now : null, Number(values[4]), input.order_key === undefined ? String(state?.[0] || '') : String(input.order_key || '').slice(0, 200), now, now, id]
    )
    return readTopic(id)!
  })
}

export function deleteAiTopic(id: string): boolean {
  return withTransaction(() => {
    const result = getDatabase().run('DELETE FROM ai_topics WHERE id=?', [id])
    getDatabase().run('DELETE FROM cherry_resource_state WHERE entity_type=? AND entity_id=?', ['topic', id])
    return Number(result.changes || 0) > 0
  })
}

// Assistant lifecycle uses the sidecar because ai_assistants has no legacy
// archived column. Permanent delete remains a separate physical operation.
export function archiveAiAssistant(id: string): AiAssistantRecord {
  return withTransaction(() => {
    const row = getDatabase().exec('SELECT sort_order,created_at,updated_at FROM ai_assistants WHERE id=?', [id])[0]?.values?.[0]
    if (!row) throw Object.assign(new Error('AI_ASSISTANT_NOT_FOUND: 助手不存在'), { code: 'AI_ASSISTANT_NOT_FOUND' })
    ensureAssistantResourceState(id, row)
    const now = new Date().toISOString()
    getDatabase().run(
      "UPDATE cherry_resource_state SET archived=1,deleted_at=?,updated_at=? WHERE entity_type='assistant' AND entity_id=?",
      [now, now, id]
    )
    return readAssistant(id)!
  })
}

export function restoreAiAssistant(id: string): AiAssistantRecord {
  return withTransaction(() => {
    const row = getDatabase().exec('SELECT sort_order,created_at,updated_at FROM ai_assistants WHERE id=?', [id])[0]?.values?.[0]
    if (!row) throw Object.assign(new Error('AI_ASSISTANT_NOT_FOUND: 助手不存在'), { code: 'AI_ASSISTANT_NOT_FOUND' })
    ensureAssistantResourceState(id, row)
    const now = new Date().toISOString()
    getDatabase().run(
      "UPDATE cherry_resource_state SET archived=0,deleted_at=NULL,updated_at=? WHERE entity_type='assistant' AND entity_id=?",
      [now, id]
    )
    return readAssistant(id)!
  })
}

export function pinAiAssistant(id: string, pinned: boolean): AiAssistantRecord {
  return withTransaction(() => {
    const row = getDatabase().exec('SELECT sort_order,created_at,updated_at FROM ai_assistants WHERE id=?', [id])[0]?.values?.[0]
    if (!row) throw Object.assign(new Error('AI_ASSISTANT_NOT_FOUND: 助手不存在'), { code: 'AI_ASSISTANT_NOT_FOUND' })
    ensureAssistantResourceState(id, row)
    const now = new Date().toISOString()
    getDatabase().run(
      "UPDATE cherry_resource_state SET pinned=?,updated_at=? WHERE entity_type='assistant' AND entity_id=?",
      [pinned ? 1 : 0, now, id]
    )
    return readAssistant(id)!
  })
}

// Topic archived/pinned fields remain canonical in ai_topics. The sidecar is
// updated in the same transaction for Cherry ordering/owner projection.
export function archiveAiTopic(id: string): AiTopicRecord {
  return withTransaction(() => {
    const row = getDatabase().exec('SELECT id,session_id,parent_id,title,pinned,archived,metadata_json,created_at,updated_at FROM ai_topics WHERE id=?', [id])[0]?.values?.[0]
    if (!row) throw Object.assign(new Error('AI_TOPIC_NOT_FOUND: 主题不存在'), { code: 'AI_TOPIC_NOT_FOUND' })
    const now = new Date().toISOString()
    getDatabase().run('UPDATE ai_topics SET archived=1,updated_at=? WHERE id=?', [now, id])
    ensureTopicResourceState(id)
    getDatabase().run(
      "UPDATE cherry_resource_state SET archived=1,deleted_at=?,updated_at=? WHERE entity_type='topic' AND entity_id=?",
      [now, now, id]
    )
    return readTopic(id)!
  })
}

export function restoreAiTopic(id: string): AiTopicRecord {
  return withTransaction(() => {
    const row = getDatabase().exec('SELECT id FROM ai_topics WHERE id=?', [id])[0]?.values?.[0]
    if (!row) throw Object.assign(new Error('AI_TOPIC_NOT_FOUND: 主题不存在'), { code: 'AI_TOPIC_NOT_FOUND' })
    const now = new Date().toISOString()
    getDatabase().run('UPDATE ai_topics SET archived=0,updated_at=? WHERE id=?', [now, id])
    ensureTopicResourceState(id)
    getDatabase().run(
      "UPDATE cherry_resource_state SET archived=0,deleted_at=NULL,updated_at=? WHERE entity_type='topic' AND entity_id=?",
      [now, id]
    )
    return readTopic(id)!
  })
}

export function pinAiTopic(id: string, pinned: boolean): AiTopicRecord {
  return withTransaction(() => {
    const row = getDatabase().exec('SELECT id FROM ai_topics WHERE id=?', [id])[0]?.values?.[0]
    if (!row) throw Object.assign(new Error('AI_TOPIC_NOT_FOUND: 主题不存在'), { code: 'AI_TOPIC_NOT_FOUND' })
    const now = new Date().toISOString()
    getDatabase().run('UPDATE ai_topics SET pinned=?,updated_at=? WHERE id=?', [pinned ? 1 : 0, now, id])
    ensureTopicResourceState(id)
    getDatabase().run(
      "UPDATE cherry_resource_state SET pinned=?,updated_at=? WHERE entity_type='topic' AND entity_id=?",
      [pinned ? 1 : 0, now, id]
    )
    return readTopic(id)!
  })
}

/**
 * Id/key pairs of one entity scope in manual display order. Pinned rows first (source
 * `createPinnedFirstSorter`), then fractional order keys with un-keyed rows last
 * (`compareOrderKeysEmptyLast`), then recency, then id — the same precedence the
 * source rail uses.
 */
function orderedResourceEntries(entityType: 'assistant' | 'topic', ownerId?: string): Array<{ id: string; key: string }> {
  const db = getDatabase()
  const table = entityType === 'assistant' ? 'ai_assistants' : 'ai_topics'
  const clauses = ["COALESCE(r.archived,0)=0"]
  const params: unknown[] = [entityType]
  if (entityType === 'topic' && ownerId !== undefined) { clauses.push('COALESCE(r.owner_id, t.session_id)=?'); params.push(ownerId) }
  const rows = db.exec(`
    SELECT t.id, COALESCE(r.order_key,''), COALESCE(r.pinned,0), COALESCE(r.last_activity_at, t.updated_at)
    FROM ${table} t LEFT JOIN cherry_resource_state r ON r.entity_type=? AND r.entity_id=t.id
    WHERE ${clauses.join(' AND ')}
  `, params)[0]?.values || []
  return rows
    .map(row => ({ id: String(row[0]), key: String(row[1] || ''), pinned: Number(row[2] || 0), activity: String(row[3] || '') }))
    .sort((a, b) =>
      b.pinned - a.pinned ||
      compareOrderKeysEmptyLast(a.key, b.key) ||
      (a.activity < b.activity ? 1 : a.activity > b.activity ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, key }) => ({ id, key }))
}

function rebalanceResourceOrderKeys(entityType: 'assistant' | 'topic', ownerId?: string): void {
  const ordered = orderedResourceEntries(entityType, ownerId)
  const keys = evenlySpacedKeys(ordered.length)
  const now = new Date().toISOString()
  ordered.forEach((entry, index) => {
    getDatabase().run("UPDATE cherry_resource_state SET order_key=?, updated_at=? WHERE entity_type=? AND entity_id=?", [keys[index], now, entityType, entry.id])
  })
  saveDatabase()
}

function readResourceOrderKey(entityType: 'assistant' | 'topic', id: string): string {
  const row = getDatabase().exec('SELECT order_key FROM cherry_resource_state WHERE entity_type=? AND entity_id=?', [entityType, id])[0]?.values?.[0]
  return typeof row?.[0] === 'string' ? row[0] : ''
}

/**
 * Anchored reorder inside one entity scope using fractional order keys, mirroring
 * `reorderAiSession` and the source `ResourceEntityRail`/`moveTopic` anchor contract.
 * `ownerId` scopes topic ordering to one assistant/session owner; assistants are global.
 */
function reorderResource(entityType: 'assistant' | 'topic', id: string, anchor: AiResourceOrderAnchor, ownerId?: string): string {
  const normalized: AiResourceOrderAnchor =
    anchor && typeof anchor === 'object' && 'position' in anchor
      ? { position: 'last' }
      : anchor && typeof anchor === 'object' && 'before' in anchor
        ? { before: String(anchor.before || '') }
        : anchor && typeof anchor === 'object' && 'after' in anchor
          ? { after: String(anchor.after || '') }
          : { position: 'last' }

  const ordered = orderedResourceEntries(entityType, ownerId).filter(entry => entry.id !== id)
  let previousId: string | null = null
  let nextId: string | null = null

  if ('position' in normalized) {
    previousId = ordered.length ? ordered[ordered.length - 1].id : null
  } else {
    const anchorId = 'before' in normalized ? normalized.before : normalized.after
    const anchorIndex = ordered.findIndex(entry => entry.id === anchorId)
    if (anchorIndex === -1) throw new Error('ORDER_OVER_NOT_FOUND: 排序锚点不存在')
    if ('before' in normalized) {
      previousId = anchorIndex > 0 ? ordered[anchorIndex - 1].id : null
      nextId = ordered[anchorIndex].id
    } else {
      previousId = ordered[anchorIndex].id
      nextId = anchorIndex + 1 < ordered.length ? ordered[anchorIndex + 1].id : null
    }
  }

  let previousKey = previousId ? readResourceOrderKey(entityType, previousId) : null
  let nextKey = nextId ? readResourceOrderKey(entityType, nextId) : null
  if (previousKey === '') previousKey = null
  if (nextKey === '') nextKey = null

  if (!hasRoomBetween(previousKey, nextKey)) {
    rebalanceResourceOrderKeys(entityType, ownerId)
    previousKey = previousId ? readResourceOrderKey(entityType, previousId) : null
    nextKey = nextId ? readResourceOrderKey(entityType, nextId) : null
    if (previousKey === '') previousKey = null
    if (nextKey === '') nextKey = null
    if (!hasRoomBetween(previousKey, nextKey)) throw new Error('ORDER_REBALANCE_FAILED: 无法为该位置分配排序键')
  }

  return orderKeyBetween(previousKey, nextKey)
}

/** Reorder an assistant rail entry (source `PATCH /assistants/:id/order`). */
export function reorderAiAssistant(input: { id: string; anchor: AiResourceOrderAnchor }): AiAssistantRecord {
  const row = getDatabase().exec('SELECT id FROM ai_assistants WHERE id=?', [String(input?.id || '')])[0]?.values?.[0]
  if (!row) throw Object.assign(new Error('AI_ASSISTANT_NOT_FOUND: 助手不存在'), { code: 'AI_ASSISTANT_NOT_FOUND' })
  return withTransaction(() => {
    ensureAssistantResourceState(input.id)
    const orderKey = reorderResource('assistant', input.id, input.anchor)
    const now = new Date().toISOString()
    getDatabase().run("UPDATE cherry_resource_state SET order_key=?, updated_at=? WHERE entity_type='assistant' AND entity_id=?", [orderKey, now, input.id])
    return readAssistant(input.id)!
  })
}

/**
 * Reorder a topic inside its owner scope. When `ownerId` differs from the topic's
 * current owner this is the source `moveTopic` contract: `ai_topics.session_id`
 * (canonical) and the projection row commit in one transaction, so the topic never
 * appears under two owners and `COALESCE(r.owner_id, t.session_id)` stays consistent.
 */
export function reorderAiTopic(input: { id: string; anchor: AiResourceOrderAnchor; ownerId?: string }): AiTopicRecord {
  const id = String(input?.id || '')
  const row = getDatabase().exec('SELECT session_id FROM ai_topics WHERE id=?', [id])[0]?.values?.[0]
  if (!row) throw Object.assign(new Error('AI_TOPIC_NOT_FOUND: 主题不存在'), { code: 'AI_TOPIC_NOT_FOUND' })
  return withTransaction(() => {
    const currentOwner = String(row[0])
    const targetOwner = input.ownerId === undefined ? currentOwner : String(input.ownerId)
    if (targetOwner !== currentOwner && !getDatabase().exec('SELECT id FROM ai_sessions WHERE id=?', [targetOwner])[0]?.values?.[0]) {
      throw Object.assign(new Error('AI_SESSION_NOT_FOUND: 目标会话不存在'), { code: 'AI_SESSION_NOT_FOUND' })
    }
    ensureTopicResourceState(id)
    const orderKey = reorderResource('topic', id, input.anchor, targetOwner)
    const now = new Date().toISOString()
    if (targetOwner !== currentOwner) {
      getDatabase().run('UPDATE ai_topics SET session_id=?, updated_at=? WHERE id=?', [targetOwner, now, id])
    }
    getDatabase().run("UPDATE cherry_resource_state SET owner_id=?, order_key=?, updated_at=? WHERE entity_type='topic' AND entity_id=?", [targetOwner, orderKey, now, id])
    return readTopic(id)!
  })
}
