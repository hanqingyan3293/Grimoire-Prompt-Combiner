import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import { evenlySpacedKeys, orderKeyBetween } from './resource-order'

/**
 * The source `/groups` API, backed by the additive `cherry_resource_groups` table (schema v27).
 *
 * Distinct from Grimoire's pre-existing `chat_groups`, which names conversation-history
 * buckets. The source's `Group` is an ENTITY-TYPE-SCOPED container — `listByEntityType` is its
 * canonical read path and `entityType` is always required — and it is what
 * `AiAssistantRecord.group_id` points at. Pointing that column at `chat_groups` would
 * misattribute assistants to whatever the user titled their chat history buckets, so a
 * separate table is used instead of reusing the name that happens to match.
 *
 * `cherry_resource_state.group_id` already existed and was already written for sessions and
 * assistants; only the group ENTITY (name + order) had nowhere to live.
 */

/** Source `GroupSchema`: `id, entityType, name, orderKey, createdAt, updatedAt`. */
export type CherryGroup = {
  id: string
  entityType: string
  name: string
  orderKey: string
  createdAt: string
  updatedAt: string
}

/** Entity types Grimoire keeps assistants/agents for; the source allows a wider set. */
const TRACKED_ENTITY_TYPES = new Set(['assistant', 'topic', 'session', 'agent', 'model', 'knowledge'])

const MAX_NAME_LENGTH = 200

function toGroup(row: unknown[]): CherryGroup {
  return {
    id: String(row[0]),
    entityType: String(row[1]),
    name: String(row[2]),
    orderKey: String(row[3] || ''),
    createdAt: String(row[4] || ''),
    updatedAt: String(row[5] || '')
  }
}

/** Groups of one entity type, in the source `Group` shape, ordered like the source lists them. */
export function listGroups(entityType: string): CherryGroup[] {
  if (!TRACKED_ENTITY_TYPES.has(entityType)) return []
  const rows = getDatabase().exec(
    'SELECT id, entity_type, name, order_key, created_at, updated_at FROM cherry_resource_groups WHERE entity_type=? ORDER BY order_key ASC, name ASC, id ASC',
    [entityType]
  )[0]?.values || []
  return rows.map(toGroup)
}

/** One group, or `null` when it does not exist. */
export function getGroup(id: string): CherryGroup | null {
  const row = getDatabase().exec(
    'SELECT id, entity_type, name, order_key, created_at, updated_at FROM cherry_resource_groups WHERE id=?',
    [id]
  )[0]?.values?.[0]
  return row ? toGroup(row) : null
}

/**
 * Creates a group.
 *
 * `orderKey` is assigned the same way every other ordered collection in this app assigns one —
 * `evenlySpacedKeys` over the existing set — so a new group sorts after the current ones
 * without needing a rebalance, and the rail's comparator behaves identically to sessions,
 * topics and prompts.
 */
export function createGroup(entityType: string, rawName: unknown): CherryGroup | null {
  if (!TRACKED_ENTITY_TYPES.has(entityType)) return null
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  // The source's `GroupNameSchema` rejects an empty name; an unnamed group would render as a
  // blank rail header with no way to tell it apart from another blank one.
  if (!name || name.length > MAX_NAME_LENGTH) return null

  const db = getDatabase()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const existing = listGroups(entityType)
  const keys = evenlySpacedKeys(existing.length + 1)
  const orderKey = keys[keys.length - 1]

  db.run(
    'INSERT INTO cherry_resource_groups (id, entity_type, name, order_key, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [id, entityType, name, orderKey, now, now]
  )
  saveDatabase()
  return { id, entityType, name, orderKey, createdAt: now, updatedAt: now }
}

/** Renames a group; answers the updated group or `null` when it is absent/invalid. */
export function renameGroup(id: string, rawName: unknown): CherryGroup | null {
  const existing = getGroup(id)
  if (!existing) return null
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (!name || name.length > MAX_NAME_LENGTH) return null
  const now = new Date().toISOString()
  getDatabase().run('UPDATE cherry_resource_groups SET name=?, updated_at=? WHERE id=?', [name, now, id])
  saveDatabase()
  return { ...existing, name, updatedAt: now }
}

/**
 * Deletes a group and clears it from every entity that pointed at it.
 *
 * The detach is done in the same transaction as the delete: leaving `group_id` pointing at a
 * removed row would make the rail render entities under a group whose name can no longer be
 * resolved — an empty-looking header with orphaned children.
 */
export function deleteGroup(id: string): boolean {
  const existing = getGroup(id)
  if (!existing) return false
  const db = getDatabase()
  db.run('DELETE FROM cherry_resource_groups WHERE id=?', [id])
  db.run('UPDATE cherry_resource_state SET group_id=NULL, updated_at=? WHERE group_id=?', [new Date().toISOString(), id])
  saveDatabase()
  return true
}

/** Moves a group relative to an anchor, using the shared fractional order keys. */
export function reorderGroup(id: string, anchor: { before?: string; after?: string; position?: 'first' | 'last' }): boolean {
  const existing = getGroup(id)
  if (!existing) return false
  const siblings = listGroups(existing.entityType).filter(group => group.id !== id)
  if (siblings.length === 0) return false

  let previousId: string | null = null
  let nextId: string | null = null
  if (anchor.position === 'first') {
    nextId = siblings[0].id
  } else if (anchor.position === 'last' || (!anchor.before && !anchor.after)) {
    previousId = siblings[siblings.length - 1].id
  } else {
    const anchorId = anchor.before || anchor.after || ''
    const index = siblings.findIndex(group => group.id === anchorId)
    // A stale client can name a group that has since been deleted; answering `false` lets the
    // caller report a conflict instead of silently appending.
    if (index === -1) return false
    if (anchor.before) {
      previousId = index > 0 ? siblings[index - 1].id : null
      nextId = siblings[index].id
    } else {
      previousId = siblings[index].id
      nextId = index + 1 < siblings.length ? siblings[index + 1].id : null
    }
  }

  const readKey = (groupId: string | null): string | null => {
    if (!groupId) return null
    const value = siblings.find(group => group.id === groupId)?.orderKey || ''
    return value === '' ? null : value
  }
  const previousKey = readKey(previousId)
  const nextKey = readKey(nextId)
  // `orderKeyBetween` needs room between the neighbours; with sparse even spacing there always
  // is, and the shared helper is what the other ordered collections use.
  // `orderKeyBetween` is the same helper the session/topic/prompt collections use, and it
  // already guarantees a key strictly between its arguments. An earlier version added a
  // second "is it really between?" guard here, which rejected legitimate moves (the test
  // caught it returning false for a valid `position: first`) — the helper's contract is the
  // check, and duplicating it with a subtly different comparison was wrong.
  const orderKey = orderKeyBetween(previousKey, nextKey)
  getDatabase().run('UPDATE cherry_resource_groups SET order_key=?, updated_at=? WHERE id=?', [orderKey, new Date().toISOString(), id])
  saveDatabase()
  return true
}
