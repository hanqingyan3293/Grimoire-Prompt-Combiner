import { findLatestActive, pickNeighbourAfterRemoval } from '../../source/src/renderer/utils/resourceEntity'

/**
 * Source delete/archive selection policy, reused verbatim for the compat lists.
 *
 * `orderedList` must be the pre-removal snapshot in visible display order (the same
 * scope the removed row lived in), and must still contain the removed row. The
 * replacement is the next display neighbour, else the previous one, else the
 * remaining row with the most recent conversation activity (`lastActivityAt`, not
 * metadata writes), else `null` for the caller to clear the active selection.
 */
export function pickResourceReplacement<T extends { id: string; last_activity_at?: string }>(
  orderedList: readonly T[],
  removedId: string
): T | null {
  const neighbour = pickNeighbourAfterRemoval(orderedList, removedId)
  if (neighbour) return neighbour
  const remaining = orderedList
    .filter(item => item.id !== removedId)
    .map(item => ({ item, lastActivityAt: item.last_activity_at || '' }))
  const latest = findLatestActive(remaining)
  return latest ? latest.item : null
}

/** Most-recently-active row (source `findLatestActive`), used when no neighbour exists. */
export function pickLatestResource<T extends { id: string; last_activity_at?: string }>(list: readonly T[]): T | null {
  const latest = findLatestActive(list.map(item => ({ item, lastActivityAt: item.last_activity_at || '' })))
  return latest ? latest.item : null
}
