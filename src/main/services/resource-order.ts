// Grimoire v7 — fractional order keys for Cherry-style resource lists (sessions, assistants, topics).
//
// Keys are lexicographically sortable base-36 strings with an implicit "0." prefix
// (the classic fractional-indexing scheme). A key between two neighbors is computed
// without touching any other row, so a drop persists exactly one order_key; when no
// midpoint digit is available the callers rebalance the affected scope (see
// `evenlySpacedKeys`), never the whole table silently.

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Compare with the empty string sorting last, matching "no manual order" semantics. */
export function compareOrderKeysEmptyLast(a: string, b: string): number {
  const aEmpty = a === ''
  const bEmpty = b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  return compareOrderKeys(a, b)
}

function digitIndex(char: string): number {
  const index = DIGITS.indexOf(char)
  return index === -1 ? 0 : index
}

/**
 * Midpoint of two fraction strings; `a` may be '' (before everything) and `b` may be
 * null (after everything). Requires a < b when both are given.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Strip the shared prefix and recurse on the differing tails.
    let common = 0
    while (common < a.length && common < b.length && a[common] === b[common]) common += 1
    if (common > 0) return b.slice(0, common) + midpoint(a.slice(common), b.slice(common))
  }

  const digitA = a.length > 0 ? digitIndex(a[0]) : 0
  const digitB = b !== null && b.length > 0 ? digitIndex(b[0]) : DIGITS.length

  if (digitB - digitA > 1) {
    return DIGITS[Math.floor((digitA + digitB) / 2)]
  }
  if (b !== null && b.length > 1) {
    // b has a non-zero tail: taking its head alone lands strictly between a and b.
    return b.slice(0, 1)
  }
  return DIGITS[digitA] + midpoint(a.length > 0 ? a.slice(1) : '', null)
}

/** Order key placing an item between `before` and `after` (either side may be null/''). */
export function orderKeyBetween(before: string | null, after: string | null): string {
  const a = before ?? ''
  const b = after ?? null
  if (a === '' && b === null) return 'n'
  if (b === null) {
    // Append after a: a + midpoint of the empty tail.
    return a + midpoint('', null)
  }
  if (a === '') {
    return midpoint('', b)
  }
  if (compareOrderKeys(a, b) >= 0) {
    throw new Error('ORDER_KEY_RANGE_INVALID: 锚点顺序无效')
  }
  return midpoint(a, b)
}

/**
 * Deterministic evenly spaced keys, used when an insertion has no room between two
 * adjacent keys. `count` covers the whole rebalanced scope; index 0 sorts first.
 */
export function evenlySpacedKeys(count: number): string[] {
  const keys: string[] = []
  for (let index = 0; index < count; index += 1) {
    // 'n' is the middle digit run: index ⇒ 'n' + padded index keeps gaps large.
    keys.push('n' + index.toString(36).padStart(4, '0'))
  }
  return keys
}

/** True when `orderKeyBetween(before, after)` can run without a rebalance. */
export function hasRoomBetween(before: string | null, after: string | null): boolean {
  try {
    const key = orderKeyBetween(before, after)
    if (before && compareOrderKeys(key, before) <= 0) return false
    if (after && compareOrderKeys(key, after) >= 0) return false
    return true
  } catch {
    return false
  }
}
