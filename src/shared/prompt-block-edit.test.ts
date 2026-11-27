import { describe, expect, it } from 'vitest'
import { parsePromptDocument } from './prompt-blocks'
import { applyPromptTextEdits, editPromptBlockWeight, validatePromptSyntax } from './prompt-block-edit'

describe('NovelAI guarded raw edits', () => {
  it.each(['{a]', '{{a}', '[a', 'a}', '"a, b', '1.2::a', 'a::', '1.2::2::a::::'])('refuses unsafe syntax without changing %s', source => {
    expect(validatePromptSyntax(source).length).toBeGreaterThan(0)
    const result = applyPromptTextEdits(source, [{ range: { start: 0, end: source.length }, expectedText: source, text: 'fixed' }])
    expect(result.ok).toBe(false)
    expect(result.text).toBe(source)
  })

  it('allows quoted delimiters, contractions and finite numeric groups', () => {
    const escapedQuote = String.fromCharCode(92) + '"'
    for (const source of ["girl's hair, 'a, b'", '"a ' + escapedQuote + 'b' + escapedQuote + ', c", sky', '1.3::{a, [b]}::, sky', '-2::flat color::']) {
      expect(validatePromptSyntax(source)).toEqual([])
    }
  })

  it.each(['NaN::sky::', 'Infinity::sky::', '1e3::sky::', 'a1.2::sky::', '1.2::::', '1.2::{sky::}', '“sky', 'sky”', '__bad_name__'])('diagnoses ambiguous delimiters in %s', source => {
    expect(validatePromptSyntax(source).length).toBeGreaterThan(0)
  })

  it('treats accepted random markers as atoms inside weights', () => {
    expect(validatePromptSyntax('{__palette, artist:1.2::[soft]{warm}__}, sky')).toEqual([])
    expect(validatePromptSyntax(String.raw`\{sky\}, 'girl's, hair', blue eyes`)).toEqual([])
  })

  it('checks parenthesis pairs and Unicode even inside quote and marker atoms', () => {
    expect(validatePromptSyntax('(legacy:1.1), artist (series)')).toEqual([])
    expect(validatePromptSyntax('(sky]')).not.toEqual([])
    expect(validatePromptSyntax('(sky')).not.toEqual([])
    expect(validatePromptSyntax('"\uD83C"')).not.toEqual([])
    expect(validatePromptSyntax('__\uD83C__')).not.toEqual([])
  })

  it('edits one exact range without canonicalizing unrelated raw', () => {
    const source = '  sky ,\tclouds,  '
    const block = parsePromptDocument(source).blocks[1]
    const result = applyPromptTextEdits(source, [{ range: block.range, expectedText: 'clouds', text: 'rain' }])
    expect(result).toMatchObject({ ok: true, text: '  sky ,\train,  ', changed: true })
  })

  it('preflights every edit and refuses stale text and overlaps atomically', () => {
    const source = 'one, two'
    const stale = applyPromptTextEdits(source, [
      { range: { start: 0, end: 3 }, expectedText: 'one', text: 'first' },
      { range: { start: 5, end: 8 }, expectedText: 'old', text: 'second' },
    ])
    expect(stale).toMatchObject({ ok: false, text: source, code: 'STALE_TEXT' })
    expect(applyPromptTextEdits(source, [
      { range: { start: 0, end: 3 }, expectedText: 'one', text: 'a' },
      { range: { start: 1, end: 3 }, expectedText: 'ne', text: 'b' },
    ])).toMatchObject({ ok: false, text: source, code: 'OVERLAPPING_EDITS' })
  })

  it('validates the final raw and rejects an edit splitting a Unicode pair', () => {
    expect(applyPromptTextEdits('sky, cloud', [{ range: { start: 0, end: 3 }, expectedText: 'sky', text: '{sky' }]))
      .toMatchObject({ ok: false, text: 'sky, cloud', code: 'INVALID_SYNTAX' })
    expect(applyPromptTextEdits('🌙, sky', [{ range: { start: 1, end: 2 }, expectedText: '🌙'[1], text: 'a' }]))
      .toMatchObject({ ok: false, text: '🌙, sky', code: 'INVALID_RANGE' })
  })

  it('applies several original ranges from right to left', () => {
    expect(applyPromptTextEdits('a, b, c', [
      { range: { start: 0, end: 1 }, expectedText: 'a', text: 'long' },
      { range: { start: 6, end: 7 }, expectedText: 'c', text: 'last' },
    ])).toMatchObject({ ok: true, text: 'long, b, last' })
  })

  it('refuses invalid coordinates, duplicate insertions and lone surrogate replacements', () => {
    for (const range of [{ start: -1, end: 1 }, { start: 1, end: 0 }, { start: 0.5, end: 1 }, { start: 0, end: 4 }]) {
      expect(applyPromptTextEdits('sky', [{ range, expectedText: 's', text: 'x' }])).toMatchObject({ ok: false, text: 'sky', code: 'INVALID_RANGE' })
    }
    expect(applyPromptTextEdits('sky', [
      { range: { start: 0, end: 0 }, expectedText: '', text: 'a' },
      { range: { start: 0, end: 0 }, expectedText: '', text: 'b' },
    ])).toMatchObject({ ok: false, text: 'sky', code: 'OVERLAPPING_EDITS' })
    expect(applyPromptTextEdits('sky', [{ range: { start: 0, end: 3 }, expectedText: 'sky', text: '\uD83C' }])).toMatchObject({ ok: false, text: 'sky' })
  })

  it('preserves CRLF and astral characters and reports exact no-ops', () => {
    const raw = '🌙,\r\nsky,  '
    const range = { start: 5, end: 8 }
    expect(applyPromptTextEdits(raw, [{ range, expectedText: 'sky', text: 'rain' }])).toMatchObject({ ok: true, text: '🌙,\r\nrain,  ' })
    expect(applyPromptTextEdits(raw, [{ range, expectedText: 'sky', text: 'sky' }])).toMatchObject({ ok: true, text: raw, changed: false })
  })

  it('uses five percentage points per NovelAI layer and keeps legacy weights separate', () => {
    expect(editPromptBlockWeight('  sky, [cloud]  ', 1, 'increase')).toMatchObject({ ok: true, text: '  sky, cloud  ' })
    expect(editPromptBlockWeight('sky, {{cloud}}', 1, 'decrease')).toMatchObject({ ok: true, text: 'sky, {cloud}' })
    expect(editPromptBlockWeight('sky', 0, 'increase')).toMatchObject({ ok: true, text: '{sky}' })
    expect(editPromptBlockWeight('sky', 0, 'decrease')).toMatchObject({ ok: true, text: '[sky]' })
    expect(editPromptBlockWeight('1.3::sky::', 0, 'numeric', 1.25)).toMatchObject({ ok: true, text: '1.25::sky::' })
    expect(editPromptBlockWeight('sky', 0, 'numeric', Number.NaN)).toMatchObject({ ok: false, text: 'sky' })
    expect(editPromptBlockWeight('1.3::sky::', 0, 'increase')).toMatchObject({ ok: true, text: '1.35::sky::' })
    expect(editPromptBlockWeight('{{sky}}', 0, 'numeric', -2)).toMatchObject({ ok: true, text: '-2::sky::' })
    expect(editPromptBlockWeight('sky', 9, 'increase')).toMatchObject({ ok: false, text: 'sky' })
  })
})
