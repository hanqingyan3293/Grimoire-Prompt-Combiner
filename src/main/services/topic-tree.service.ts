// Grimoire persistence ADAPTER for Cherry Studio 2.1.4 MessageService/TopicService
// (AGPL-3.0). Source remains read-only. Only initialize/append/select/branch are adapted.
import { randomUUID } from 'node:crypto'
import { getDatabase, saveDatabase } from '../database'
import { pageTopicPath, TOPIC_CONTENT_ROLES, TOPIC_MESSAGE_STATUSES, TopicTreeError } from '../../shared/topic-tree'
import type { AppendTopicMessage, TopicBranchQuery, TopicBranchResponse, TopicTreeMessage, TopicTreeState } from '../../shared/topic-tree'

function fail(code: TopicTreeError['code'], message: string): never { throw new TopicTreeError(code, message) }
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail('VALIDATION', 'Nonempty identifier required')
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('VALIDATION', 'Message ID must be a UUID')
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('VALIDATION', 'Plain object required')
}
/** JSON roundtrip must not silently erase undefined, nonfinite numbers, functions or cycles.
 * FileUIPart and offloaded tool output need a relation, not merely a stored JSON claim.
 */
function jsonData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object') fail('VALIDATION', 'Message data must be JSON')
  if (seen.has(value)) fail('VALIDATION', 'Message data must be acyclic')
  seen.add(value)
  if (!Array.isArray(value)) {
    object(value)
    if (value.type === 'file' || 'fileEntryId' in value || '$persistedToolOutput' in value || 'attachments' in value) fail('UNSUPPORTED', 'Topic attachment reference relation is not implemented')
  }
  for (const entry of Object.values(value)) jsonData(entry, seen)
  seen.delete(value)
}
function transaction<T>(work: () => T): T {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
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
function requireTopic(topicId: string): void {
  identifier(topicId)
  const row = getDatabase().exec('SELECT archived FROM ai_topics WHERE id=?', [topicId])[0]?.values[0]
  if (!row || Number(row[0]) !== 0) fail('NOT_FOUND', `Active Topic: ${topicId}`)
}
function state(topicId: string): TopicTreeState {
  requireTopic(topicId)
  const row = getDatabase().exec('SELECT root_id,active_node_id,assistant_id FROM topic_tree_state WHERE topic_id=?', [topicId])[0]?.values[0]
  if (!row) fail('UNSUPPORTED', `Topic ${topicId} has no initialized independent message tree; legacy session history is not adopted`)
  return { topicId, rootId: String(row[0]), activeNodeId: row[1] === null ? null : String(row[1]), assistantId: row[2] === null ? null : String(row[2]) }
}
function requireNode(topicId: string, nodeId: string, contentOnly: boolean): void {
  uuid(nodeId)
  const row = getDatabase().exec('SELECT topic_id,role FROM topic_tree_messages WHERE id=?', [nodeId])[0]?.values[0]
  if (!row) fail('NOT_FOUND', `Message: ${nodeId}`)
  if (row[0] !== topicId) fail('INVALID_OPERATION', 'Message does not belong to this topic')
  if (contentOnly && row[1] === 'root') fail('INVALID_OPERATION', 'The virtual root cannot be selected')
}
function message(row: unknown[]): TopicTreeMessage {
  return { id: String(row[0]), topicId: String(row[1]), parentId: String(row[2]), role: row[3] as TopicTreeMessage['role'], data: JSON.parse(String(row[4])), status: row[5] as TopicTreeMessage['status'], siblingsGroupId: 0, createdAt: String(row[6]), updatedAt: String(row[7]) }
}
const COLUMNS = 'id,topic_id,parent_id,role,data_json,status,created_at,updated_at'

/** Explicit opt-in, idempotent. Existing session messages are never read or copied.
 * assistantId remains null: session_id/resource owner is NOT last-used assistant.
 */
export function initializeTopicTree(topicId: string): TopicTreeState {
  return transaction(() => {
    requireTopic(topicId)
    if (getDatabase().exec('SELECT topic_id FROM topic_tree_state WHERE topic_id=?', [topicId])[0]?.values.length) return state(topicId)
    const now = new Date().toISOString(), rootId = randomUUID(), db = getDatabase()
    db.run('INSERT INTO topic_tree_messages (id,topic_id,parent_id,role,data_json,status,created_at,updated_at) VALUES (?,?,NULL,\'root\',?,\'success\',?,?)', [rootId, topicId, '{"parts":[]}', now, now])
    db.run('INSERT INTO topic_tree_state (topic_id,root_id,active_node_id,assistant_id,created_at,updated_at) VALUES (?,?,NULL,NULL,?,?)', [topicId, rootId, now, now])
    return state(topicId)
  })
}
export function getTopicTreeState(topicId: string): TopicTreeState { return state(topicId) }

/** Source create: omitted parent -> exact active/root, null -> root, explicit -> same topic.
 * Deliberately no automatic initialization and no legacy ai_messages writes.
 */
export function appendTopicMessage(topicId: string, input: AppendTopicMessage): TopicTreeMessage {
  object(input)
  for (const key of Object.keys(input)) if (!['parentId', 'role', 'data', 'status', 'setAsActive'].includes(key)) fail('UNSUPPORTED', `Append field: ${key}`)
  if (!TOPIC_CONTENT_ROLES.includes(input.role)) fail('VALIDATION', 'Content message role required')
  if (input.status !== undefined && !TOPIC_MESSAGE_STATUSES.includes(input.status)) fail('VALIDATION', 'Invalid source message status')
  if (input.setAsActive !== undefined && typeof input.setAsActive !== 'boolean') fail('VALIDATION', 'setAsActive must be boolean')
  object(input.data)
  // Source MessageDataSchema's model selection enum; request controls need the
  // main-authoritative runtime adapter and are outside this persistence slice.
  if (input.data.modelSelection !== undefined && input.data.modelSelection !== 'default' && input.data.modelSelection !== 'explicit') fail('VALIDATION', 'Invalid modelSelection')
  if ('turnOptions' in input.data) fail('UNSUPPORTED', 'Runtime turn controls are not implemented for topic trees')
  if (input.data.parts !== undefined && (!Array.isArray(input.data.parts) || input.data.parts.some(part => !part || typeof part !== 'object' || Array.isArray(part)))) fail('VALIDATION', 'parts must be an array of objects')
  jsonData(input.data)
  const data = JSON.stringify(input.data)
  return transaction(() => {
    const current = state(topicId), db = getDatabase()
    const parentId = input.parentId === undefined ? current.activeNodeId ?? current.rootId : input.parentId === null ? current.rootId : input.parentId
    requireNode(topicId, parentId, false)
    const id = randomUUID(), now = new Date().toISOString()
    db.run('INSERT INTO topic_tree_messages (id,topic_id,parent_id,role,data_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, topicId, parentId, input.role, data, input.status ?? 'pending', now, now])
    if (input.setAsActive !== false) db.run('UPDATE topic_tree_state SET active_node_id=?,updated_at=? WHERE topic_id=?', [id, now, topicId])
    return message(db.exec(`SELECT ${COLUMNS} FROM topic_tree_messages WHERE id=?`, [id])[0].values[0])
  })
}
/** Source setActiveNodeTx: exact content node, even an internal node, never root. */
export function selectTopicContentNode(topicId: string, nodeId: string): { activeNodeId: string } {
  return transaction(() => {
    state(topicId)
    requireNode(topicId, nodeId, true)
    getDatabase().run('UPDATE topic_tree_state SET active_node_id=?,updated_at=? WHERE topic_id=?', [nodeId, new Date().toISOString(), topicId])
    return { activeNodeId: nodeId }
  })
}
export function readTopicBranch(topicId: string, query: TopicBranchQuery = {}): TopicBranchResponse {
  object(query)
  for (const key of Object.keys(query)) if (!['nodeId', 'cursor', 'limit'].includes(key)) fail('UNSUPPORTED', `Branch query field: ${key}`)
  if (query.nodeId !== undefined) uuid(query.nodeId)
  if (query.cursor !== undefined) uuid(query.cursor)
  const limit = query.limit ?? 20
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) fail('VALIDATION', 'limit must be a positive integer')
  const current = state(topicId), nodeId = query.nodeId ?? current.activeNodeId
  let path: TopicTreeMessage[] = []
  if (nodeId) {
    requireNode(topicId, nodeId, true)
    // Source getPathRowsToNodeTx scoped recursive ancestor CTE adapted to LegacyDatabase.
    // Explicit distance replaces the source ORM's CTE-order sort: raw SQL result order
    // is not guaranteed. A visited guard bounds corrupt imported cycles; root check
    // below refuses them rather than projecting a partial conversation.
    const chain = getDatabase().exec(`WITH RECURSIVE ancestors AS (
      SELECT ${COLUMNS},0 AS distance,',' || id || ',' AS visited
      FROM topic_tree_messages WHERE id=? AND topic_id=?
      UNION ALL
      SELECT m.id,m.topic_id,m.parent_id,m.role,m.data_json,m.status,m.created_at,m.updated_at,
        a.distance+1,a.visited || m.id || ','
      FROM topic_tree_messages m INNER JOIN ancestors a ON m.id=a.parent_id
      WHERE m.topic_id=? AND instr(a.visited,',' || m.id || ',')=0
    ) SELECT ${COLUMNS} FROM ancestors ORDER BY distance DESC`, [nodeId, topicId, topicId])[0]?.values ?? []
    if (chain[0]?.[0] !== current.rootId || chain[0]?.[2] !== null) fail('INTEGRITY', 'Path does not reach the topic root')
    path = chain.slice(1).map(message)
  }
  const page = pageTopicPath(path, query.cursor, limit)
  return { items: page.items.map(message => ({ message })), nextCursor: page.nextCursor, rootId: current.rootId, activeNodeId: current.activeNodeId, assistantId: current.assistantId }
}
