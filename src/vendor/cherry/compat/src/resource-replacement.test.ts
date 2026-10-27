import { describe, expect, it } from 'vitest'
import { pickLatestResource, pickResourceReplacement } from './resource-replacement'

type Row = { id: string; last_activity_at?: string }

const rows: Row[] = [
  { id: 'a', last_activity_at: '2026-10-10T10:00:00.000Z' },
  { id: 'b', last_activity_at: '2026-10-10T12:00:00.000Z' },
  { id: 'c', last_activity_at: '2026-10-10T11:00:00.000Z' }
]

describe('compat resource replacement policy (source resourceEntity semantics)', () => {
  it('picks the next display neighbour when the removed row is not last', () => {
    expect(pickResourceReplacement(rows, 'a')?.id).toBe('b')
    expect(pickResourceReplacement(rows, 'b')?.id).toBe('c')
  })

  it('falls back to the previous neighbour when the removed row was last', () => {
    expect(pickResourceReplacement(rows, 'c')?.id).toBe('b')
  })

  it('falls back to the latest active row when no neighbour exists', () => {
    expect(pickResourceReplacement([{ id: 'only' }], 'only')).toBeNull()
    // Unknown id: source returns no neighbour, then latest-active decides over the
    // remaining rows (the filter only excludes the removed id, which is absent).
    expect(pickResourceReplacement([{ id: 'x', last_activity_at: '2026-10-10T09:00:00.000Z' }], 'missing')?.id).toBe('x')
    expect(pickResourceReplacement(rows, 'missing')?.id).toBe('b')
  })

  it('resolves the most recently active row and treats missing activity as oldest', () => {
    expect(pickLatestResource(rows)?.id).toBe('b')
    expect(pickLatestResource([{ id: 'no-activity' }, { id: 'old', last_activity_at: '2020-01-01T00:00:00.000Z' }])?.id).toBe('old')
    expect(pickLatestResource([])).toBeNull()
  })
})
