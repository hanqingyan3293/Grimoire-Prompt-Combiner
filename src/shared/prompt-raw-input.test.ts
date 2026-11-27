import { describe, expect, it } from 'vitest'
import { promptTextInputEdit } from './prompt-raw-input'

const apply = (raw: string, value: string, selection?: { start: number; end: number }) => {
  const edit = promptTextInputEdit(raw, value, selection)
  expect(raw.slice(edit.range.start, edit.range.end)).toBe(edit.expectedText)
  return raw.slice(0, edit.range.start) + edit.text + raw.slice(edit.range.end)
}
describe('raw text edits from normalized textarea values', () => {
  it('preserves untouched CRLF and surrounding whitespace during a local input change', () => {
    const raw = '  sky,\r\nlong hair,\r\n tail,  '
    expect(apply(raw, '  sky,\nlong coat,\n tail,  ')).toBe('  sky,\r\nlong coat,\r\n tail,  ')
  })
  it('does not normalize mixed line endings when the visible value did not change', () => {
    const raw = 'one\r\ntwo\nthree\rfour'
    expect(apply(raw, 'one\ntwo\nthree\nfour')).toBe(raw)
  })
  it('retains the exact selected origin when inserted text repeats the surrounding text', () => {
    expect(promptTextInputEdit('a', 'aa', { start: 0, end: 0 })).toEqual({ range: { start: 0, end: 0 }, expectedText: '', text: 'a' })
    expect(promptTextInputEdit('aa', 'ab', { start: 1, end: 2 })).toEqual({ range: { start: 1, end: 2 }, expectedText: 'a', text: 'b' })
  })
  it('keeps surrogate pairs whole and uses the original line ending for inserted lines', () => {
    expect(apply('🌙\r\ntail', '🌞\ntail')).toBe('🌞\r\ntail')
    expect(apply('one\r\ntail', 'one\nnew\ntail', { start: 4, end: 4 })).toBe('one\r\nnew\r\ntail')
  })

  it('uses the deleted span at a collapsed native before-input caret', () => {
    expect(promptTextInputEdit('aaa', 'aa', { start: 1, end: 1 }, 'deleteContentBackward')).toEqual({ range: { start: 0, end: 1 }, expectedText: 'a', text: '' })
    expect(promptTextInputEdit('aaa', 'aa', { start: 1, end: 1 }, 'deleteContentForward')).toEqual({ range: { start: 1, end: 2 }, expectedText: 'a', text: '' })
    expect(promptTextInputEdit('🌙🌙', '🌙', { start: 2, end: 2 }, 'deleteContentBackward')).toEqual({ range: { start: 0, end: 2 }, expectedText: '🌙', text: '' })
  })
})
