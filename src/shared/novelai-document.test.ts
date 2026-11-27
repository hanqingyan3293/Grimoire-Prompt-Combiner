import { describe, expect, it } from 'vitest'
import { WORKSPACE_EDITOR_MAX_BYTES } from './workspace-editor-state'
import {
  appendNovelaiQualityTokens, cloneNovelaiDocument, createNovelaiDocument, getNovelaiDocumentText,
  migrateLegacyNovelaiDraft, sampleNovelaiRandomPools, setNovelaiDocumentText, validateNovelaiDocument,
} from './novelai-document'

describe('NovelAI v1 authoritative document', () => {
  it('round-trips the complete document without normalizing any raw or empty generation field', () => {
    const primary = '  sky ,\t🌙,\r\n'
    const document = createNovelaiDocument({
      primary, negative: ' lowres,  ',
      characters: [
        { id: 'alice', name: 'Alice', positive: "girl's hair, blue eyes", negative: '[bad hands]' },
        { id: 'bob', name: 'Bob', positive: '1.2::coat::', negative: '' },
      ],
      blockMeta: [{ id: 'sky-label', target: 'primary', range: { start: 2, end: 5 }, expectedText: 'sky', name: '天空', ownLine: true }],
      randomPools: [{ id: 'lighting', name: 'lights', options: ['soft light', 'sunlight'] }],
      quality: { enabled: true, tokens: ['best quality'] },
      generation: { steps: '', cfg: '0', seed: '0007', sampler: '', scheduler: 'normal', width: '', height: '1024', model: '', checkpoint: 'x', loras: '[]' },
      metadataUnknown: { foreign: { a: [1, null, true, '原样'] }, translations: { version: 1, language: 'zh' } },
      provenance: { version: 1, insertions: [{ id: 'insert-1', assetId: 'asset-a', assetRevision: 3, transactionId: 'tx-a', kind: 'block', target: 'primary', range: { start: 2, end: 5 }, expectedText: 'sky' }] },
    })
    const validation = validateNovelaiDocument(JSON.parse(JSON.stringify(document)))
    expect(validation).toMatchObject({ ok: true, document })
    expect(document.primary).toBe(primary)
    const clone = cloneNovelaiDocument(document)
    clone.characters[0].positive = 'changed'
    expect(document.characters[0].positive).toBe("girl's hair, blue eyes")
    expect(document.characters.map(character => character.id)).toEqual(['alice', 'bob'])
  })

  it('uses explicit empty legacy defaults and never guesses characters or parameters from the prompt', () => {
    const document = migrateLegacyNovelaiDraft({ draft: '2girls, Alice, Bob', metadata: { negativePrompt: 'bad', steps: '', seed: '0009', unknown: { foreign: 1 } } })
    expect(document.primary).toBe('2girls, Alice, Bob')
    expect(document.negative).toBe('bad')
    expect(document.characters).toEqual([])
    expect(document.generation).toEqual({ steps: '', cfg: '', seed: '0009', sampler: '', scheduler: '', width: '', height: '', model: '', checkpoint: '', loras: '' })
    expect(document.metadataUnknown).toEqual({ foreign: 1 })
    expect(document.blockMeta).toEqual([])
  })

  it('can retain incomplete typing but rejects future versions, invalid JSON and duplicate stable IDs', () => {
    const document = createNovelaiDocument({ primary: '{typing' })
    expect(validateNovelaiDocument(document).ok).toBe(true)
    expect(validateNovelaiDocument({ ...document, version: 2 })).toMatchObject({ ok: false, code: 'UNSUPPORTED_DOCUMENT_VERSION' })
    expect(validateNovelaiDocument({ ...document, generation: { ...document.generation, steps: 0 } }).ok).toBe(false)
    expect(validateNovelaiDocument({ ...document, metadataUnknown: { n: Number.NaN } }).ok).toBe(false)
    expect(validateNovelaiDocument({ ...document, characters: [
      { id: 'same', name: '', positive: '', negative: '' }, { id: 'same', name: '', positive: '', negative: '' },
    ] }).ok).toBe(false)
    expect(validateNovelaiDocument({ ...document, provenance: { version: 2, insertions: [] } }).ok).toBe(false)
    expect(validateNovelaiDocument({ ...document, primary: 'x'.repeat(WORKSPACE_EDITOR_MAX_BYTES) })).toMatchObject({ ok: false, code: 'DOCUMENT_TOO_LARGE' })
  })

  it('rejects untracked character extension fields rather than changing them outside history', () => {
    const document = createNovelaiDocument()
    expect(validateNovelaiDocument({ ...document, characters: [{ id: 'a', name: '', positive: '', negative: '', extra: 0 }] })).toMatchObject({ ok: false, code: 'INVALID_DOCUMENT' })
  })

  it('addresses characters by stable ID and keeps labels outside raw even after reordering', () => {
    const document = createNovelaiDocument({ characters: [
      { id: 'a', name: 'A', positive: 'first', negative: 'bad-a' }, { id: 'b', name: 'B', positive: 'second', negative: '' },
    ] })
    document.characters.reverse()
    expect(getNovelaiDocumentText(document, { characterId: 'a', field: 'negative' })).toBe('bad-a')
    const updated = setNovelaiDocumentText(document, { characterId: 'a', field: 'positive' }, '{typing')
    expect(updated).toMatchObject({ ok: true, changed: true })
    if (!updated.ok) throw new Error(updated.code)
    expect(updated.document.characters.find(character => character.id === 'a')?.positive).toBe('{typing')
    expect(updated.document.characters.find(character => character.id === 'b')?.positive).toBe('second')
    expect(setNovelaiDocumentText(document, { characterId: 'missing', field: 'positive' }, 'x')).toMatchObject({ ok: false, code: 'UNKNOWN_TEXT_TARGET' })
    expect(setNovelaiDocumentText(document, 'primary', '{typing', { guarded: true })).toMatchObject({ ok: false, code: 'INVALID_SYNTAX' })
    expect(setNovelaiDocumentText(document, 'primary', '')).toMatchObject({ ok: true, changed: false })
  })
})

describe('quality and independent seeded sampling', () => {
  it('appends enabled quality tokens once, retaining the exact old raw prefix', () => {
    const document = createNovelaiDocument({ primary: '  sky,  ', quality: { enabled: true, tokens: ['best quality', 'best quality', 'very aesthetic'] } })
    const once = appendNovelaiQualityTokens(document)
    expect(once).toMatchObject({ ok: true, document: { primary: '  sky,  best quality, very aesthetic' } })
    if (!once.ok) throw new Error(once.code)
    expect(appendNovelaiQualityTokens(once.document)).toMatchObject({ ok: true, changed: false, document: once.document })
    expect(document.primary).toBe('  sky,  ')
    expect(appendNovelaiQualityTokens(createNovelaiDocument({ primary: '{{best quality}}', quality: { enabled: true, tokens: ['best quality'] } }))).toMatchObject({ ok: true, changed: false })
    expect(appendNovelaiQualityTokens(createNovelaiDocument({ primary: 'sky' }))).toMatchObject({ ok: true, changed: false })
  })

  it('does not append quality tokens twice when paragraph classification merges adjacent tags', () => {
    const document = createNovelaiDocument({ primary: 'x '.repeat(13).trim(), quality: { enabled: true, tokens: ['best quality'] } })
    const once = appendNovelaiQualityTokens(document)
    if (!once.ok) throw new Error(once.code)
    expect(appendNovelaiQualityTokens(once.document)).toMatchObject({ ok: true, changed: false, document: once.document })
  })

  it('refuses quality insertion into malformed raw or malformed fixed tokens atomically', () => {
    const document = createNovelaiDocument({ primary: '{sky', quality: { enabled: true, tokens: ['best quality'] } })
    expect(appendNovelaiQualityTokens(document)).toMatchObject({ ok: false, code: 'INVALID_SYNTAX', document })
    const badToken = createNovelaiDocument({ primary: 'sky', quality: { enabled: true, tokens: ['best quality', '{broken'] } })
    expect(appendNovelaiQualityTokens(badToken)).toMatchObject({ ok: false, document: badToken })
  })

  const pools = [
    { id: 'sky-id', name: 'sky', options: ['sun', 'rain', 'clouds'] },
    { id: 'light-id', name: 'lighting', options: ['soft light', 'hard light'] },
  ]

  it('selects exactly one option at each occurrence, reproduces a seed and leaves pool data intact', () => {
    const raw = '  __sky__,\r\n__lighting__, __sky__, tail,  '
    const first = sampleNovelaiRandomPools(raw, pools, '0007')
    expect(first.ok).toBe(true)
    expect(first).toEqual(sampleNovelaiRandomPools(raw, pools, '0007'))
    if (!first.ok) throw new Error(first.code)
    expect(first.selections).toHaveLength(3)
    expect(first.selections.map(selection => selection.poolId)).toEqual(['sky-id', 'light-id', 'sky-id'])
    expect(first.text).toMatch(/^  (sun|rain|clouds),\r\n(soft light|hard light), (sun|rain|clouds), tail,  $/)
    expect(pools[0].options).toEqual(['sun', 'rain', 'clouds'])
  })

  it.each([
    ['__sky__, __unknown__', pools, 'UNKNOWN_RANDOM_POOL'],
    ['__sky__, __empty__', [...pools, { id: 'empty', name: 'empty', options: [] }], 'EMPTY_RANDOM_POOL'],
    ['__sky*2__, __lighting__', pools, 'UNSUPPORTED_RANDOM_MARKER'],
    ['__sky~0.5-1.5__', pools, 'UNSUPPORTED_RANDOM_MARKER'],
    ['__sky__, __lighting__', [...pools.slice(0, 1), { id: 'light-id', name: 'lighting', options: [''] }], 'EMPTY_RANDOM_POOL'],
  ] as const)('keeps the entire raw on pool/marker failure: %s', (raw, supplied, code) => {
    expect(sampleNovelaiRandomPools(raw, supplied, 7)).toMatchObject({ ok: false, text: raw, changed: false, code })
  })

  it('samples punctuation-bearing names atomically and does not sample quoted or escaped markers', () => {
    const name = 'palette, artist:1.2::[soft]{warm}'
    const raw = '__' + name + '__, "__sky__", ' + String.raw`\__sky__`
    expect(sampleNovelaiRandomPools(raw, [{ id: 'palette', name, options: ['warm light'] }], 3)).toMatchObject({ ok: true, text: 'warm light, "__sky__", ' + String.raw`\__sky__` })
  })
})
