import { getDatabase } from '../database'

/**
 * The source `/archives` recycle-bin listing.
 *
 * This was recorded as BLOCKED for several sessions on the belief that Grimoire deleted
 * physically while the source route filters `deleted_at IS NOT NULL`. **That belief was wrong**:
 * all three archive paths already write `deleted_at` on archive and clear it on restore —
 * `archiveAiTopic` and `archiveAiAssistant` explicitly, and `archiveAiSession` through
 * `updateAiSessionResource`'s `archived ? now : null`. So the recycle bin's storage has been
 * populated all along; what was missing was only the projection.
 *
 * Domains: the source unions `topics | assistants | agents | sessions | paintings | files`.
 * Grimoire tracks the first three (`agents` is the same table family as assistants in the
 * source and has no Grimoire counterpart; `paintings` and `files` have no trash concept here).
 * A domain with no rows contributes nothing rather than being fabricated — an empty union arm
 * is not a claim, whereas inventing an entry would be.
 */

export type ArchiveDomain = 'topics' | 'assistants' | 'sessions'

/** Source `ArchiveEntry`: `id, entityId, domain, name, deletedAt`. */
export type ArchiveEntry = {
  id: string
  entityId: string
  domain: ArchiveDomain
  name: string
  deletedAt: number
}

export type ArchivePage = {
  items: ArchiveEntry[]
  nextCursor?: string
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

type RawRow = {
  entity_id: string
  domain: ArchiveDomain
  name: string
  deleted_at: string
}

/**
 * Archived rows across the three tracked domains, newest-deleted first.
 *
 * `deleted_at` is stored as an ISO string; the source's `ArchiveEntry.deletedAt` is a NUMBER
 * (epoch ms). The conversion is done here rather than left to the caller, because the source
 * UI formats it as a date and a string would render as `Invalid Date` — a silent blank rather
 * than an error.
 */
function readArchivedRows(): RawRow[] {
  const db = getDatabase()
  const rows = db.exec(`
    SELECT r.entity_id, 'topics' AS domain, COALESCE(t.title, '(未命名主题)') AS name, r.deleted_at
      FROM cherry_resource_state r LEFT JOIN ai_topics t ON t.id = r.entity_id
      WHERE r.entity_type='topic' AND r.deleted_at IS NOT NULL
    UNION ALL
    SELECT r.entity_id, 'assistants', COALESCE(a.name, '(未命名助手)'), r.deleted_at
      FROM cherry_resource_state r LEFT JOIN ai_assistants a ON a.id = r.entity_id
      WHERE r.entity_type='assistant' AND r.deleted_at IS NOT NULL
    UNION ALL
    SELECT r.entity_id, 'sessions', COALESCE(s.title, '(未命名会话)'), r.deleted_at
      FROM cherry_resource_state r LEFT JOIN ai_sessions s ON s.id = r.entity_id
      WHERE r.entity_type='session' AND r.deleted_at IS NOT NULL
    ORDER BY r.deleted_at DESC
  `)[0]?.values || []

  return rows.map(row => ({
    entity_id: String(row[0]),
    domain: String(row[1]) as ArchiveDomain,
    // A LEFT JOIN can miss when the entity row is gone but the projection lingers. Falling back
    // to a placeholder keeps the entry VISIBLE and deletable rather than showing a nameless
    // row — hiding it would make the orphan unreachable through the only UI that can purge it.
    name: String(row[2] || ''),
    deleted_at: String(row[3] || '')
  }))
}

/** Epoch ms from the stored ISO string; `0` when unparseable so the entry still sorts and lists. */
function deletedAtMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * One page of the recycle bin.
 *
 * Cursor-paginated like the source. The cursor is `deletedAt` + `id` — the same composite the
 * source's keyset ordering uses — so a page boundary is stable while items are being restored
 * in another window.
 */
export function listArchives(query: { cursor?: string; limit?: number } = {}): ArchivePage {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(query.limit) ? Math.trunc(query.limit as number) : DEFAULT_LIMIT))
  const all: ArchiveEntry[] = readArchivedRows().map(row => ({
    // The source's id is `${domain}:${entityId}` — a synthetic composite, because the union has
    // no single key space. Reproduced exactly: the UI splits on `:` to route a restore.
    id: row.domain + ':' + row.entity_id,
    entityId: row.entity_id,
    domain: row.domain,
    name: row.name,
    deletedAt: deletedAtMs(row.deleted_at)
  }))

  let start = 0
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor)
    if (decoded) {
      const [cursorMs, cursorId] = decoded
      const index = all.findIndex(entry => entry.deletedAt === cursorMs && entry.id === cursorId)
      // A cursor naming a row that has since been restored: resume from the position it WOULD
      // have occupied rather than restarting. Restarting would re-show already-seen entries,
      // and erroring would strand the user mid-list.
      start = index === -1
        ? all.findIndex(entry => entry.deletedAt < cursorMs || (entry.deletedAt === cursorMs && entry.id > cursorId))
        : index + 1
      if (start === -1) start = all.length
    }
  }

  const items = all.slice(start, start + limit)
  const last = items[items.length - 1]
  return {
    items,
    // `undefined`, not an empty string — the source's contract is "absent means no more data".
    nextCursor: start + limit < all.length && last ? encodeCursor(last) : undefined
  }
}

function encodeCursor(entry: ArchiveEntry): string {
  return Buffer.from(JSON.stringify([entry.deletedAt, entry.id]), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): [number, string] | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    return [Number(parsed[0] || 0), String(parsed[1] ?? '')]
  } catch {
    return null
  }
}
