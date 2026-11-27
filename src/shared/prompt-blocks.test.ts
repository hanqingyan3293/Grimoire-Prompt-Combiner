import { describe, expect, it } from 'vitest'
import { classifyPromptBlock, formatRandomMarker, parsePromptDocument, parseRandomMarker, promptWeightOf, serializePromptDocument } from './prompt-blocks'

const roundTrip = (source: string) => serializePromptDocument(parsePromptDocument(source))

describe('prompt blocks (M6.1)', () => {
  it('round-trips real prompts byte for byte', () => {
    const cases = [
      '1girl, solo, long hair',
      '  sky ,	clouds,  ',
      '1.3::artist:solara, watercolor::, -2::flat color::, {soft light}, [hard edges]',
      '__pools/lighting*2r~0.5-1.2/0.05__, rain, night',
      '他说“你好，世界”, second tag',
      "quote, 'inside, comma', tail",
      'a,,b,',
      '',
      'no-comma-single-block',
      '1girl\r\n, soft light,\r\n\r\n',
    ]
    for (const source of cases) expect(roundTrip(source)).toBe(source)
  })

  it('splits top-level commas only, and keeps quoted commas inside a block', () => {
    expect(parsePromptDocument('a, b, c').blocks.map(block => block.raw)).toEqual(['a', 'b', 'c'])
    expect(parsePromptDocument('"a, b", c').blocks.map(block => block.raw)).toEqual(['"a, b"', 'c'])
    expect(parsePromptDocument('{a, b}, c').blocks.map(block => block.raw)).toEqual(['{a, b}', 'c'])
    expect(parsePromptDocument('1.2::a, b::, c').blocks.map(block => block.raw)).toEqual(['1.2::a, b::', 'c'])
  })

  it('records weights for braces, brackets and numeric groups', () => {
    expect(promptWeightOf('{tag}')).toEqual({ kind: 'increase', value: 0.05 })
    expect(promptWeightOf('{{tag}}')?.value).toBeCloseTo(0.1)
    expect(promptWeightOf('[tag]')).toEqual({ kind: 'decrease', value: 0.05 })
    expect(promptWeightOf('1.3::tag::')).toEqual({ kind: 'numeric', value: 1.3 })
    expect(promptWeightOf('plain tag')).toBeUndefined()
  })

  it('classifies tags, paragraphs and random blocks the way the reference does', () => {
    expect(classifyPromptBlock('1girl')).toBe('tags')
    expect(classifyPromptBlock('long hair, blue eyes')).toBe('tags')
    expect(classifyPromptBlock('She walks through the rain, holding an umbrella, and the street lights reflect on the wet pavement.')).toBe('paragraph')
    expect(classifyPromptBlock('黄昏时分，少女独自站在雨中，远处的霓虹灯在积水里倒映成一条长长的光带。')).toBe('paragraph')
    const doc = parsePromptDocument('__lighting*2__, 1girl')
    expect(doc.blocks[0].type).toBe('random')
    expect(doc.blocks[0].random).toEqual({ pool: 'lighting', count: 2, repeat: false })
  })

  it('parses and formats random markers consistently', () => {
    expect(parseRandomMarker('__sky__')).toEqual({ pool: 'sky', count: 1, repeat: false })
    expect(parseRandomMarker('__sky*3r__')).toEqual({ pool: 'sky', count: 3, repeat: true })
    expect(parseRandomMarker('__sky*2~0.5-1.5/0.1__')).toEqual({ pool: 'sky', count: 2, repeat: false, weight: { min: 0.5, max: 1.5, step: 0.1 } })
    expect(formatRandomMarker({ pool: 'sky', count: 2, repeat: true })).toBe('__sky*2r__')
    expect(() => parseRandomMarker('__bad_name__')).toThrow()
    expect(() => parseRandomMarker('__sky*17__')).toThrow()
  })

  it('round-trips 300 generated prompts (fidelity is a property, not a case list)', () => {
    // Deterministic LCG: the corpus is reproducible, and a failure prints the exact string.
    let seed = 20261027
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
    const fragments = ['1girl', 'solo', 'long hair', 'blue eyes', 'soft light', '{bright}', '[dark]', '1.2::detailed::', '__pool__', '__pool*2r__', '"a, b"', '黄昏', '雨中的少女', 'She walks in the rain.', 'sky:', 'artist:someone', '']
    const separators = [', ', ',', ',  ', ',\t', '\n, ', '，']
    for (let index = 0; index < 300; index += 1) {
      const count = 1 + Math.floor(next() * 6)
      let source = next() < 0.3 ? ' ' : ''
      for (let part = 0; part < count; part += 1) {
        if (part > 0) source += pick(separators)
        source += pick(fragments)
      }
      if (next() < 0.2) source += pick([' ', '\n', ',', ', '])
      expect(roundTrip(source)).toBe(source)
    }
  })

  it('keeps offsets usable for editing a single block', () => {
    const source = '1girl, long hair, solo'
    const doc = parsePromptDocument(source)
    const block = doc.blocks[1]
    expect(source.slice(block.range.start, block.range.end)).toBe('long hair')
    expect(source.slice(0, block.range.start) + 'short hair' + source.slice(block.range.end)).toBe('1girl, short hair, solo')
  })

  it('keeps escaped quotes and apostrophes from swallowing later blocks', () => {
    const first = String.raw`"a \"quoted, word\", b"`
    expect(parsePromptDocument(first + ', tail').blocks.map(block => block.raw)).toEqual([first, 'tail'])
    expect(parsePromptDocument("girl's hair, blue eyes").blocks.map(block => block.raw)).toEqual(["girl's hair", 'blue eyes'])
  })

  it('does not present an unmatched or disjoint wrapper as a valid weight', () => {
    for (const raw of ['{{tag}', '[[tag]', '{[tag}', '{a}{b}', '[a][b]']) {
      expect(promptWeightOf(raw)).toBeUndefined()
    }
  })

  it('classifies the complete English sentence in the actual parsed blocks', () => {
    const sentence = 'She walks through the rain, holding an umbrella, and the street lights reflect on the wet pavement.'
    const document = parsePromptDocument(sentence)
    expect(document.blocks).toHaveLength(1)
    expect(document.blocks[0]).toMatchObject({ type: 'paragraph', raw: sentence, range: { start: 0, end: sentence.length } })
    const mixed = 'sky, ' + sentence + ', __lighting__, night'
    expect(parsePromptDocument(mixed).blocks.map(block => [block.type, block.raw])).toEqual([
      ['tags', 'sky'], ['paragraph', sentence], ['random', '__lighting__'], ['tags', 'night'],
    ])
    expect(roundTrip(mixed)).toBe(mixed)
  })

  it('keeps accepted random pool names atomic even with prompt delimiters', () => {
    const marker = '__palette, artist:1.2::[soft]{warm}(day)__'
    const source = '  ' + marker + ' ,\t🌙,\r\n'
    expect(parsePromptDocument(source).blocks.map(block => block.raw)).toEqual([marker, '🌙'])
    expect(parsePromptDocument(source).blocks[0].random?.pool).toBe('palette, artist:1.2::[soft]{warm}(day)')
    expect(roundTrip(source)).toBe(source)
  })

})
