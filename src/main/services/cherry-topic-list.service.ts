import { getDatabase } from '../database'

/**
 * The source's GLOBAL topic list: cursor-paginated, pinned-first, with optional id/name/trash
 * filters.
 *
 * Distinct from `listAiTopics(sessionId)`, which the compat's own rail uses and which is
 * scoped to one session. The source `/topics` GET is not session-scoped at all — its query
 * accepts `ids`, `cursor`, `limit`, `q` and `inTrash` and no session — so the two cannot be the
 * same function. An earlier version of this route demanded a `sessionId`, which would have
 * returned a subset the source's `useTopics` (an infinite query over `/topics`) cannot page.
 *
 * Ordering mirrors the source's composed view: pinned rows first, then the rest, both by the
 * resource-state `order_key`, with `id` as a tiebreak. `order_key` is the column the reorder
 * routes write, so a drag is reflected here.
 */

export type TopicListQuery = {
  ids?: string[]
  q?: string
  inTrash?: boolean
  cursor?: string
  limit?: number
}

export type TopicListRow = {
  id: string
  session_id: string
  title: string
  created_at: string
  updated_at: string
  pinned: number
  order_key: string
}

export type TopicListPage = {
  items: TopicListRow[]
  nextCursor?: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * A cursor is the last row's full SORT KEY: `[pinned, orderKey, id]`.
 *
 * It must carry every column the ORDER BY uses. An earlier version encoded only
 * `[orderKey, id]` while the query compared against `(pinned, orderKey, id)` — the two sides
 * disagreed, so paging would have restarted or skipped. The encode and the comparison are now
 * written against the same three components.
 *
 * Keyset rather than offset: an offset cursor skips or repeats rows when a topic is created or
 * reordered between pages, which is exactly when a user is most likely to be paging.
 */
function encodeCursor(row: TopicListRow): string {
  return Buffer.from(JSON.stringify([row.pinned, row.order_key, row.id]), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): [number, string, string] | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 3) return null
    return [Number(parsed[0] || 0), String(parsed[1] ?? ''), String(parsed[2] ?? '')]
  } catch {
    return null
  }
}

/** One page of the global topic list. */
export function listTopicsPage(query: TopicListQuery): TopicListPage {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(query.limit) ? Math.trunc(query.limit as number) : DEFAULT_LIMIT))
  const clauses: string[] = []
  const parameters: unknown[] = []

  // `inTrash` selects the recycle bin, matching the source's `deleted_at IS NOT NULL` filter;
  // Grimoire's equivalent is the archived flag.
  clauses.push(query.inTrash ? 't.archived = 1' : 't.archived = 0')

  if (query.ids && query.ids.length) {
    clauses.push(`t.id IN (${query.ids.map(() => '?').join(',')})`)
    parameters.push(...query.ids)
  }
  if (query.q && query.q.trim()) {
    // Case-insensitive substring, the same shape as the source's LIKE filter.
    clauses.push('lower(t.title) LIKE ?')
    parameters.push('%' + query.q.trim().toLowerCase() + '%')
  }

  // A malformed cursor is treated as "start from the beginning" rather than erroring: the
  // source's decoder does the same, and a user with a stale cursor should see the list, not an
  // error page.
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  if (cursor) {
    // Keyset pagination, with the FIRST component's comparison following the sort direction.
    //
    // `pinned` is ordered DESC, so "after the cursor" means a SMALLER pinned value — writing
    // `pinned > ?` here (as the first version did) made the predicate unsatisfiable, because
    // pinned is boolean (0/1) and nothing is greater than 1. The page after a pinned row came
    // back empty while every non-paging test still passed. The remaining components are ASC, so
    // they keep `>`.
    clauses.push(
      '(COALESCE(p.pinned,0) < ? OR (COALESCE(p.pinned,0) = ? AND (COALESCE(r.order_key, t.updated_at) > ? OR (COALESCE(r.order_key, t.updated_at) = ? AND t.id > ?))))'
    )
    parameters.push(cursor[0], cursor[0], cursor[1], cursor[1], cursor[2])
  }

  const rows = getDatabase().exec(
    `SELECT t.id, t.session_id, t.title, t.created_at, t.updated_at,
            COALESCE(p.pinned, 0) AS pinned, COALESCE(r.order_key, t.updated_at) AS order_key
     FROM ai_topics t
     LEFT JOIN cherry_resource_state p ON p.entity_type='topic' AND p.entity_id=t.id
     LEFT JOIN cherry_resource_state r ON r.entity_type='topic' AND r.entity_id=t.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY pinned DESC, order_key ASC, t.id ASC
     LIMIT ?`,
    [...parameters, limit + 1]
  )[0]?.values || []

  const mapped: TopicListRow[] = rows.map(row => ({
    id: String(row[0]),
    session_id: String(row[1]),
    title: String(row[2]),
    created_at: String(row[3]),
    updated_at: String(row[4]),
    pinned: Number(row[5] || 0),
    order_key: String(row[6] || '')
  }))

  const items = mapped.slice(0, limit)
  const last = items[items.length - 1]
  return {
    items,
    // `nextCursor` is omitted (not an empty string) when there is no next page — the source's
    // contract is "undefined means no more data", and a caller testing truthiness would
    // otherwise keep paging forever.
    nextCursor: mapped.length > limit && last ? encodeCursor(last) : undefined
  }
}
