import { describe, expect, it } from 'vitest'
import { parsePromptDocument } from './prompt-blocks'
import {
  OrganizePlanError,
  applyOrganizeSuggestions,
  applyOrganizePlan,
  cleanupBlocks,
  dedupeBlocks,
  organizePromptText,
  parseOrganizePlan,
  parseOrganizeSuggestions,
  sortBlocks,
} from './novelai-organize'

describe('prompt organisation (M6.5)', () => {
  it('removes case- and whitespace-insensitive duplicates, keeping the first', () => {
    const document = parsePromptDocument('1girl, Long  Hair, 1girl, long hair, solo')
    const result = dedupeBlocks(document)
    expect(result.text).toBe('1girl, Long  Hair, solo')
    expect(result.applied).toBe(2)
  })

  it('sorts blocks case-insensitively and stably', () => {
    const document = parsePromptDocument('sky, Apple, apple, clouds')
    expect(sortBlocks(document).text).toBe('Apple, apple, clouds, sky')
  })

  it('trims blocks, drops empties and collapses whitespace', () => {
    const document = parsePromptDocument('  1girl ,  , long   hair ,')
    expect(cleanupBlocks(document).text).toBe('1girl, long hair')
  })

  it('organises by task kind through one entry point', () => {
    expect(organizePromptText('b, a, b', { kind: 'dedupe' }).text).toBe('b, a')
    expect(organizePromptText('b, a, b', { kind: 'sort' }).text).toBe('a, b, b')
    expect(organizePromptText(' b ,  a ', { kind: 'cleanup' }).text).toBe('b, a')
  })

  it('accepts a valid planner payload (object or JSON string)', () => {
    const plan = [{ op: 'remove', index: 1 }, { op: 'replace', index: 0, text: '1girl, solo' }, { op: 'move', from: 2, to: 0 }]
    expect(parseOrganizePlan({ operations: plan }, 3)).toEqual(plan)
    expect(parseOrganizePlan(JSON.stringify({ operations: plan }), 3)).toEqual(plan)
  })

  it('refuses malformed plans instead of applying half of them', () => {
    const cases: Array<[unknown, string]> = [
      ['not json', 'NOT_JSON'],
      [42, 'NOT_OBJECT'],
      [{}, 'NOT_ARRAY'],
      [{ operations: [{ op: 'explode', index: 0 }] }, 'UNKNOWN_OP'],
      [{ operations: [{ op: 'remove', index: 9 }] }, 'BAD_INDEX'],
      [{ operations: [{ op: 'replace', index: 0 }] }, 'BAD_TEXT'],
      [{ operations: [{ op: 'move', from: 0, to: 9 }] }, 'BAD_INDEX'],
      [{ operations: new Array(501).fill({ op: 'remove', index: 0 }) }, 'TOO_MANY'],
    ]
    for (const [payload, code] of cases) {
      try {
        parseOrganizePlan(payload, 3)
        throw new Error('expected refusal for ' + JSON.stringify(payload).slice(0, 40))
      } catch (error) {
        expect(error).toBeInstanceOf(OrganizePlanError)
        expect((error as OrganizePlanError).code).toBe(code)
      }
    }
  })

  it('applies remove/replace/move in order and reports what changed', () => {
    const document = parsePromptDocument('a, b, c, d')
    const result = applyOrganizePlan(document, [
      { op: 'remove', index: 3 },
      { op: 'replace', index: 0, text: 'alpha' },
      { op: 'move', from: 2, to: 0 },
    ])
    expect(result.text).toBe('c, alpha, b')
    expect(result.applied).toBe(3)
    expect(result.changed).toBe(true)
  })

  it('reports no change when the plan reproduces the current prompt', () => {
    const document = parsePromptDocument('a, b')
    const result = applyOrganizePlan(document, [{ op: 'move', from: 0, to: 0 }])
    expect(result.text).toBe('a, b')
    expect(result.changed).toBe(false)
  })

  it('parses per-block before/after suggestions and derives before from the draft', () => {
    const document = parsePromptDocument('1girl, long  hair, solo')
    const result = parseOrganizeSuggestions({
      changes: [{ block: 1, after: 'long hair', title: '合并空格', reason: '多余的空白' }],
    }, document)
    expect(result).toEqual([
      { block: 1, before: 'long  hair', after: 'long hair', title: '合并空格', reason: '多余的空白' },
    ])
    // Unknown fields are ignored; a no-op suggestion is dropped rather than shown as a change.
    expect(parseOrganizeSuggestions({ changes: [{ block: 0, after: '1girl', title: 't', reason: 'r', extra: 1 }] }, document)).toEqual([])
  })

  it('refuses malformed, out-of-range and unsafe suggestion payloads', () => {
    const document = parsePromptDocument('1girl, 1.2::blue hair::, __sky*2__')
    const cases: Array<[unknown, string]> = [
      ['not json', 'NOT_JSON'],
      [[], 'NOT_OBJECT'],
      [{ changes: {} }, 'NOT_ARRAY'],
      [{ changes: [{ block: 9, after: 'x', title: 't', reason: 'r' }] }, 'BAD_INDEX'],
      [{ changes: [{ block: 0, after: 42, title: 't', reason: 'r' }] }, 'BAD_TEXT'],
      [{ changes: [{ block: 0, after: 'x', title: '', reason: 'r' }] }, 'BAD_TEXT'],
      [{ changes: [{ block: 0, after: 'x', title: 't', reason: '' }] }, 'BAD_TEXT'],
      [{ changes: [
        { block: 0, after: 'x', title: 't', reason: 'r' },
        { block: 0, after: 'y', title: 't', reason: 'r' },
      ] }, 'DUPLICATE_BLOCK'],
      [{ changes: [{ block: 0, after: '1girl, solo', title: 't', reason: 'r' }] }, 'UNSAFE_CHANGE'],
      [{ changes: [{ block: 1, after: '1.3::blue hair::', title: 't', reason: 'r' }] }, 'UNSAFE_CHANGE'],
      [{ changes: [{ block: 2, after: '__rain*2__', title: 't', reason: 'r' }] }, 'UNSAFE_CHANGE'],
      [{ changes: new Array(501).fill({ block: 0, after: 'x', title: 't', reason: 'r' }) }, 'TOO_MANY'],
    ]
    for (const [payload, code] of cases) {
      try {
        parseOrganizeSuggestions(payload, document)
        throw new Error('expected refusal for ' + JSON.stringify(payload).slice(0, 60))
      } catch (error) {
        expect(error).toBeInstanceOf(OrganizePlanError)
        expect((error as OrganizePlanError).code).toBe(code)
      }
    }
  })

  it('applies only the accepted suggestions and refuses a stale draft', () => {
    const document = parsePromptDocument('1girl, long  hair, solo')
    const suggestions = parseOrganizeSuggestions({
      changes: [
        { block: 0, after: '1girl', title: 't', reason: 'r' },
        { block: 1, after: 'long hair', title: 't', reason: 'r' },
      ],
    }, document).filter(change => change.block === 1)
    const result = applyOrganizeSuggestions(document, suggestions)
    expect(result.text).toBe('1girl, long hair, solo')
    expect(result.applied).toBe(1)
    expect(result.changed).toBe(true)

    const edited = parsePromptDocument('1girl, short hair, solo')
    try {
      applyOrganizeSuggestions(edited, suggestions)
      throw new Error('expected stale suggestion refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(OrganizePlanError)
      expect((error as OrganizePlanError).code).toBe('STALE_SUGGESTION')
    }
  })

  it('reports no change when every parsed suggestion is a no-op', () => {
    const document = parsePromptDocument('a, b')
    expect(applyOrganizeSuggestions(document, [])).toEqual({ text: 'a, b', changed: false, applied: 0 })
  })

  it('changes only the accepted block range and preserves every unrelated separator', () => {
    const source = '  sky ,\r\nlong  hair, \t🌙,  '
    const document = parsePromptDocument(source)
    const suggestions = parseOrganizeSuggestions({ changes: [{ block: 1, after: 'long hair', title: '空格', reason: '整理' }] }, document)
    expect(applyOrganizeSuggestions(document, suggestions)).toEqual({ text: '  sky ,\r\nlong hair, \t🌙,  ', changed: true, applied: 1 })
  })

  it('refuses accepted edits on malformed syntax and duplicate accepted ranges', () => {
    const invalid = parsePromptDocument('{sky')
    expect(() => applyOrganizeSuggestions(invalid, [{ block: 0, before: '{sky', after: '{sky}', title: '修复', reason: '括号' }])).toThrow(OrganizePlanError)
    const document = parsePromptDocument('long  hair, sky')
    const suggestion = { block: 0, before: 'long  hair', after: 'long hair', title: '空格', reason: '整理' }
    expect(() => applyOrganizeSuggestions(document, [suggestion, suggestion])).toThrow(OrganizePlanError)
    expect(() => organizePromptText('{sky', { kind: 'cleanup' })).toThrow(OrganizePlanError)
  })

  it('returns the original raw for organize operations that make no actual change', () => {
    const source = '  cloud ,\tsky,  '
    const document = parsePromptDocument(source)
    expect(dedupeBlocks(document)).toMatchObject({ text: source, changed: false })
    expect(sortBlocks(document)).toMatchObject({ text: source, changed: false })
    expect(applyOrganizePlan(document, [])).toMatchObject({ text: source, changed: false })
  })
})
