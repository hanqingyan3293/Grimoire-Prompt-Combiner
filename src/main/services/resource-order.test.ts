import { describe, expect, it } from 'vitest'
import { compareOrderKeys, compareOrderKeysEmptyLast, evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from './resource-order'

describe('resource order keys', () => {
  it('computes keys strictly between neighbors and keeps them sortable', () => {
    const a = orderKeyBetween(null, null)
    const b = orderKeyBetween(a, null)
    const c = orderKeyBetween(null, a)
    expect(compareOrderKeys(c, a)).toBe(-1)
    expect(compareOrderKeys(a, b)).toBe(-1)

    // Repeated insertion between the same pair stays ordered without collisions.
    let before = a
    let after = b
    const inserted: string[] = []
    for (let index = 0; index < 25; index += 1) {
      const key = orderKeyBetween(before, after)
      inserted.push(key)
      expect(compareOrderKeys(before, key)).toBe(-1)
      expect(compareOrderKeys(key, after)).toBe(-1)
      before = key
    }
    expect(new Set(inserted).size).toBe(inserted.length)
    expect([...inserted].sort()).toEqual(inserted)
  })

  it('appends and prepends without disturbing existing keys', () => {
    const first = orderKeyBetween(null, null)
    const second = orderKeyBetween(first, null)
    const zero = orderKeyBetween(null, first)
    expect([zero, first, second].sort()).toEqual([zero, first, second])
  })

  it('rejects an inverted anchor pair', () => {
    const a = orderKeyBetween(null, null)
    const b = orderKeyBetween(a, null)
    expect(() => orderKeyBetween(b, a)).toThrow('ORDER_KEY_RANGE_INVALID')
  })

  it('produces evenly spaced keys in ascending order', () => {
    const keys = evenlySpacedKeys(5)
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
    for (let index = 1; index < keys.length; index += 1) {
      expect(compareOrderKeys(keys[index - 1], keys[index])).toBe(-1)
    }
  })

  it('treats empty keys as unordered and sorts them last', () => {
    expect(compareOrderKeysEmptyLast('', 'a')).toBe(1)
    expect(compareOrderKeysEmptyLast('a', '')).toBe(-1)
    expect(compareOrderKeysEmptyLast('', '')).toBe(0)
    expect(compareOrderKeysEmptyLast('a', 'b')).toBe(-1)
  })

  it('answers room questions for tight and open ranges', () => {
    expect(hasRoomBetween(null, null)).toBe(true)
    const a = orderKeyBetween(null, null)
    expect(hasRoomBetween(a, null)).toBe(true)
    expect(hasRoomBetween('', a)).toBe(true)
    expect(hasRoomBetween(a, a)).toBe(false)
    expect(hasRoomBetween('z', 'z')).toBe(false)
  })
})
