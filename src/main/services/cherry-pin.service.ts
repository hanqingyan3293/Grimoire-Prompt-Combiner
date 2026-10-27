import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'

/**
 * The source `/pins` API, backed by `cherry_resource_state.pinned`.
 *
 * Grimoire has stored pin state since the resource-state projection landed (schema v20), and
 * its own rails read it through the Host bridge. What was missing was the source's DataApi
 * shape, which source components call through `usePins` — so this adapter exposes state that
 * already exists rather than introducing a second place to store it.
 *
 * SOURCE `entityType` values are `assistant | topic | model | agent | knowledge | session`.
 * Grimoire only tracks a projection row for the three it manages (`assistant`, `topic`,
 * `session`); the others answer an EMPTY LIST rather than a fabricated pin, because
 * `cherry_resource_state` has no rows for them — "no pins" is true, whereas inventing one
 * would make the UI show a pin the user never set.
 */

/** Source `PinSchema`: `id, entityType, entityId, orderKey, createdAt, updatedAt`. */
export type CherryPin = {
  id: string
  entityType: string
  entityId: string
  orderKey: string
  createdAt: string
  updatedAt: string
}

/**
 * The projection row's identity, expressed as a Pin id.
 *
 * Grimoire has no pin table, so there is no stored pin id. A DERIVED id keeps it stable
 * across calls (the client may pass it back to `DELETE /pins/:id`) without pretending a row
 * exists. The source treats pin ids as uuid v4, and a deterministic uuid-shaped value is
 * minted from the (entityType, entityId) pair for exactly that reason — a random id would
 * break the round trip on the next call.
 */
function pinIdFor(entityType: string, entityId: string): string {
  const hex = crypto.createHash('sha256').update(entityType + '\u0000' + entityId).digest('hex').slice(0, 32)
  // Format as uuid v4-shaped so a client that validates the shape accepts it.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Entity types Grimoire keeps a resource-state row for. */
const TRACKED_ENTITY_TYPES = new Set(['assistant', 'topic', 'session'])

type StateRow = { entity_type: string; entity_id: string; order_key: string; created_at: string; updated_at: string }

function readPinnedRows(entityType: string): StateRow[] {
  const rows = getDatabase().exec(
    'SELECT entity_type, entity_id, order_key, created_at, updated_at FROM cherry_resource_state WHERE entity_type=? AND pinned=1 ORDER BY order_key ASC, entity_id ASC',
    [entityType]
  )[0]?.values || []
  return rows.map(row => ({
    entity_type: String(row[0]),
    entity_id: String(row[1]),
    order_key: String(row[2] || ''),
    created_at: String(row[3] || ''),
    updated_at: String(row[4] || '')
  }))
}

function toPin(row: StateRow): CherryPin {
  return {
    id: pinIdFor(row.entity_type, row.entity_id),
    entityType: row.entity_type,
    entityId: row.entity_id,
    // The source requires a non-empty order key; the projection's own key is used, and an
    // empty one is substituted rather than invented so an un-reordered pin still sorts first
    // by the entity id tiebreak above.
    orderKey: row.order_key || '00000000000000000000',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Pins of one entity type, in the source `Pin` shape. */
export function listPins(entityType: string): CherryPin[] {
  if (!TRACKED_ENTITY_TYPES.has(entityType)) return []
  return readPinnedRows(entityType).map(toPin)
}

/** Resolves a pin id back to its projection row; `null` when nothing matches. */
export function findPinById(pinId: string): { entityType: string; entityId: string } | null {
  for (const entityType of TRACKED_ENTITY_TYPES) {
    for (const row of readPinnedRows(entityType)) {
      if (pinIdFor(row.entity_type, row.entity_id) === pinId) {
        return { entityType: row.entity_type, entityId: row.entity_id }
      }
    }
  }
  return null
}

/**
 * Pins or unpins an entity, idempotently, and answers the resulting pin.
 *
 * Idempotent because the source's `pin()` reuses an existing row: a client that pins twice
 * (a double-click, or a retry after a lost response) must not see an error or a duplicate.
 * Unpinning something already unpinned is likewise not an error — `unpin()` in the source is
 * a plain delete whose absence is not reported.
 *
 * Answers `null` when the entity has no projection row at all: creating one here would assert
 * that the entity exists in Grimoire's projection when nothing has ever registered it, and the
 * pin would then never surface anywhere (the rails read the projection, not this table).
 */
export function setPin(entityType: string, entityId: string, pinned: boolean): CherryPin | null {
  if (!TRACKED_ENTITY_TYPES.has(entityType)) return null
  const db = getDatabase()
  const existing = db.exec(
    'SELECT entity_type, entity_id, order_key, created_at, updated_at FROM cherry_resource_state WHERE entity_type=? AND entity_id=?',
    [entityType, entityId]
  )[0]?.values?.[0]
  if (!existing) return null

  const now = new Date().toISOString()
  db.run(
    'UPDATE cherry_resource_state SET pinned=?, updated_at=? WHERE entity_type=? AND entity_id=?',
    [pinned ? 1 : 0, now, entityType, entityId]
  )
  // `db.run` writes through but does not persist on its own — the same note as the prompt and
  // usage writers. Without this the pin would vanish on restart.
  saveDatabase()

  if (!pinned) return null
  return toPin({
    entity_type: String(existing[0]),
    entity_id: String(existing[1]),
    order_key: String(existing[2] || ''),
    created_at: String(existing[3] || ''),
    updated_at: now
  })
}
