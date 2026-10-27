import { describe, expect, it } from 'vitest'
import { bracketStep, parsePromptText, decomposePromptPart, mergeDuplicates, serializePrompt, formatPromptWeight } from './tag-prompt-core'

const name = (token: { text: string }) => token.text

describe('tag prompt core', () => {
  it('parses bare and explicit weights and roundtrips byte-identically', () => {
    const { tokens } = parsePromptText('masterpiece, (blue eyes:1.2)')
    expect(tokens.map(token => [token.text, token.weight, token.explicit])).toEqual([
      ['masterpiece', 1, false],
      ['blue eyes', 1.2, true],
    ])
    expect(serializePrompt(tokens, name)).toBe('masterpiece, (blue eyes:1.2)')
  })

  it('applies bracket multipliers (round x1.1, square /1.1) with clamping', () => {
    expect(decomposePromptPart('(masterpiece)')?.weight).toBe(1.1)
    expect(decomposePromptPart('((masterpiece))')?.weight).toBe(1.21)
    expect(decomposePromptPart('[masterpiece]')?.weight).toBe(0.91)
    expect(decomposePromptPart('[(masterpiece)]')?.weight).toBe(1)
    expect(decomposePromptPart('(((((tag)))))')?.weight).toBe(1.61)
    expect(decomposePromptPart('((((((((tag))))))))')?.weight).toBe(2)
    expect(decomposePromptPart('((tag:1.3))')?.weight).toBe(1.43)
    expect(decomposePromptPart('[(((tag)))]')?.weight).toBe(1.21)
  })

  it('parses BREAK and negative segments and serializes them back', () => {
    const { tokens } = parsePromptText('a, BREAK, b\n--neg c')
    expect(tokens.map(token => [token.text, token.negative, token.breakBefore])).toEqual([
      ['a', false, false],
      ['b', false, true],
      ['c', true, false],
    ])
    expect(serializePrompt(tokens, name)).toBe('a, BREAK, b\n--neg c')
  })

  it('merges duplicate names by summing weight deltas within one polarity', () => {
    const { tokens } = parsePromptText('(a:1.2), (a:1.3), --neg a')
    const merged = mergeDuplicates(tokens)
    expect(merged.map(token => [token.text, token.weight, token.negative])).toEqual([
      ['a', 1.5, false],
      ['a', 1, true],
    ])
    expect(serializePrompt(merged, name)).toBe('(a:1.5)\n--neg a')
  })

  it('steps weights by one bracket level with two-decimal clamping', () => {
    expect(bracketStep(1, 1)).toBe(1.1)
    expect(bracketStep(1.1, 1)).toBe(1.21)
    expect(bracketStep(2, 1)).toBe(2)
    expect(bracketStep(0.1, -1)).toBe(0.1)
    expect(bracketStep(1.21, -1)).toBe(1.1)
    expect(formatPromptWeight(1.5)).toBe('1.5')
    expect(formatPromptWeight(0.91)).toBe('0.91')
  })

  it('keeps serialization byte-compatible with the historical store format', () => {
    const sparse = parsePromptText('masterpiece, (blue eyes:1.3)').tokens
    expect(serializePrompt(sparse, name)).toBe('masterpiece, (blue eyes:1.3)')
    const empty = serializePrompt([], name)
    expect(empty).toBe('')
    const negativeOnly = parsePromptText('--neg bad hands').tokens
    expect(serializePrompt(negativeOnly, name)).toBe('--neg bad hands')
  })
})