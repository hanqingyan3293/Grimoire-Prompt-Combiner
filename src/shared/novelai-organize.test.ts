import { describe, expect, it } from 'vitest'
import { parsePromptDocument } from './prompt-blocks'
import {
  OrganizePlanError,
  applyOrganizePlan,
  cleanupBlocks,
  dedupeBlocks,
  organizePromptText,
  parseOrganizePlan,
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
})
