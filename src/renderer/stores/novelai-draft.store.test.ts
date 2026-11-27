import { describe, expect, it } from 'vitest'
import { cloneNovelaiDocument, createNovelaiDocument } from '@shared/novelai-document'
import { commitNovelaiDraft, createNovelaiDraftState, redoNovelaiDraft, undoNovelaiAgent, undoNovelaiDraft, validateNovelaiDraftState, type NovelaiDraftState } from './novelai-draft.store'

const initial = (primary = 'sky') => createNovelaiDraftState(createNovelaiDocument({ primary }))
function textCommit(state: NovelaiDraftState, text: string, transactionId: string, source: 'user' | 'agent' = 'user', groupId = transactionId) {
  const document = cloneNovelaiDocument(state.document)
  document.primary = text
  return commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId, source, operation: 'edit primary', groupId, mode: source === 'user' ? 'typing' : 'guarded', nextDocument: document })
}
function saved(result: ReturnType<typeof commitNovelaiDraft>): NovelaiDraftState {
  if (!result.ok) throw new Error(result.code)
  return result.state
}

describe('NovelAI serializable local journal', () => {
  it('groups consecutive edits to the same target and undoes/redoes user and agent groups', () => {
    let state = initial()
    state = saved(textCommit(state, 'sky, a', 'u1', 'user', 'focus-primary'))
    state = saved(textCommit(state, 'sky, ab', 'u2', 'user', 'focus-primary'))
    expect(state.history).toHaveLength(1)
    state = saved(textCommit(state, 'sky, ab, {cloud}', 'a1', 'agent', 'agent-group'))
    expect(state.history).toHaveLength(2)
    state = saved(undoNovelaiDraft(state, state.revision))
    expect(state.document.primary).toBe('sky, ab')
    state = saved(undoNovelaiDraft(state, state.revision))
    expect(state.document.primary).toBe('sky')
    state = saved(redoNovelaiDraft(state, state.revision))
    expect(state.document.primary).toBe('sky, ab')
    state = saved(redoNovelaiDraft(state, state.revision))
    expect(state.document.primary).toBe('sky, ab, {cloud}')
  })

  it('does not merge across source, target, operation or an intervening event', () => {
    let state = saved(textCommit(initial(), 'sky, a', 'u1', 'user', 'focus'))
    let document = cloneNovelaiDocument(state.document)
    document.negative = 'lowres'
    state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'n1', source: 'user', operation: 'edit negative', groupId: 'focus', mode: 'typing', nextDocument: document }))
    state = saved(textCommit(state, 'sky, ab', 'u2', 'user', 'focus'))
    expect(state.history).toHaveLength(3)
    document = cloneNovelaiDocument(state.document); document.primary = '{sky}, ab'
    state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'weight', source: 'user', operation: 'weight', groupId: 'focus', nextDocument: document }))
    expect(state.history).toHaveLength(4)
  })

  it('does not advance revision for a no-op, preserves redo and guards stale revisions', () => {
    const zero = initial()
    const noop = textCommit(zero, 'sky', 'noop')
    expect(noop).toMatchObject({ ok: true, changed: false, state: { revision: 0, history: [] } })
    const changed = saved(textCommit(zero, 'rain', 'u1'))
    const undone = saved(undoNovelaiDraft(changed, changed.revision))
    const same = saved(textCommit(undone, 'sky', 'noop2'))
    expect(same.redo).toHaveLength(1)
    expect(commitNovelaiDraft(changed, { expectedRevision: 0, transactionId: 'stale', source: 'user', operation: 'edit', nextDocument: createNovelaiDocument({ primary: 'wrong' }) })).toMatchObject({ ok: false, code: 'STALE_REVISION', state: changed })
    expect(undoNovelaiDraft(changed, 0)).toMatchObject({ ok: false, code: 'STALE_REVISION', state: changed })
  })

  it('allows temporary bad typing but every guarded/agent commit requires valid old and new syntax', () => {
    const broken = saved(textCommit(initial(), '{typing', 'typing'))
    const fixed = createNovelaiDocument({ primary: 'fixed' })
    expect(commitNovelaiDraft(broken, { expectedRevision: broken.revision, transactionId: 'agent', source: 'agent', operation: 'fix', mode: 'typing', nextDocument: fixed })).toMatchObject({ ok: false, code: 'INVALID_SYNTAX', state: broken })
    expect(commitNovelaiDraft(initial(), { expectedRevision: 0, transactionId: 'guarded', source: 'user', operation: 'weight', nextDocument: createNovelaiDocument({ primary: '[broken' }) })).toMatchObject({ ok: false, code: 'INVALID_SYNTAX' })
    expect(saved(undoNovelaiDraft(broken, broken.revision)).document.primary).toBe('sky')
    expect(saved(redoNovelaiDraft(saved(undoNovelaiDraft(broken, broken.revision)), broken.revision + 1)).document.primary).toBe('{typing')
  })

  it('preflights exact-range changes and refuses the whole transaction on stale text', () => {
    const state = initial('one, two')
    const result = commitNovelaiDraft(state, { expectedRevision: 0, transactionId: 'batch', source: 'agent', operation: 'replace', changes: [
      { kind: 'text', target: 'primary', range: { start: 0, end: 3 }, expectedText: 'one', text: 'first' },
      { kind: 'text', target: 'primary', range: { start: 5, end: 8 }, expectedText: 'old', text: 'second' },
    ] })
    expect(result).toMatchObject({ ok: false, state, code: 'STALE_TEXT' })
    const ok = commitNovelaiDraft(state, { expectedRevision: 0, transactionId: 'field', source: 'user', operation: 'seed', changes: [{ kind: 'field', path: ['generation', 'seed'], expectedValue: '', value: '0007' }] })
    expect(ok).toMatchObject({ ok: true, state: { document: { generation: { seed: '0007' } } } })
  })

  it('selectively undoes the agent after a later user insertion before the same field', () => {
    let state = initial('sky, cloud')
    state = saved(textCommit(state, 'sky, {cloud}', 'a1', 'agent', 'cloud-weight'))
    state = saved(textCommit(state, '🌙, sky, {cloud}', 'u1'))
    const result = undoNovelaiAgent(state, state.revision)
    expect(result).toMatchObject({ ok: true, state: { document: { primary: '🌙, sky, cloud' } } })
    const undone = saved(result)
    expect(saved(undoNovelaiDraft(undone, undone.revision)).document.primary).toBe('🌙, sky, {cloud}')
    const ordinary = saved(undoNovelaiDraft(undone, undone.revision))
    expect(saved(redoNovelaiDraft(ordinary, ordinary.revision)).document.primary).toBe('🌙, sky, cloud')
    expect(undoNovelaiAgent(undone, undone.revision)).toMatchObject({ ok: true, changed: false })
  })

  it('refuses selective undo after overlapping user changes without touching any state', () => {
    let state = saved(textCommit(initial('sky, cloud'), 'sky, {cloud}', 'a1', 'agent'))
    state = saved(textCommit(state, 'sky, {rain}', 'u1'))
    const before = JSON.stringify(state)
    expect(undoNovelaiAgent(state, state.revision)).toMatchObject({ ok: false, code: 'HISTORY_CONFLICT', state })
    expect(JSON.stringify(state)).toBe(before)
  })

  it('handles grouped agent edits, CRLF and emoji boundaries during selective undo', () => {
    let state = initial('🌙,\r\nsky')
    state = saved(textCommit(state, '🌞,\r\nsky', 'a1', 'agent', 'agent-focus'))
    state = saved(textCommit(state, '🌞,\r\n{sky}', 'a2', 'agent', 'agent-focus'))
    state = saved(textCommit(state, 'user, 🌞,\r\n{sky}', 'u1'))
    expect(saved(undoNovelaiAgent(state, state.revision)).document.primary).toBe('user, 🌙,\r\nsky')
  })

  it('matches non-text fields individually and retains unrelated user parameter edits', () => {
    let state = initial()
    let document = cloneNovelaiDocument(state.document); document.generation.cfg = '7'
    state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'a1', source: 'agent', operation: 'cfg', nextDocument: document }))
    document = cloneNovelaiDocument(state.document); document.generation.seed = '0009'
    state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'u1', source: 'user', operation: 'seed', nextDocument: document }))
    expect(saved(undoNovelaiAgent(state, state.revision)).document.generation).toMatchObject({ cfg: '', seed: '0009' })
    document = cloneNovelaiDocument(state.document); document.generation.cfg = '8'
    const overlap = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'u2', source: 'user', operation: 'cfg', nextDocument: document }))
    expect(undoNovelaiAgent(overlap, overlap.revision)).toMatchObject({ ok: false, code: 'HISTORY_CONFLICT', state: overlap })
  })

  it('addresses character text by stable ID and leaves other character and metadata fields alone', () => {
    let state = createNovelaiDraftState(createNovelaiDocument({ characters: [
      { id: 'alice', name: 'Alice', positive: 'coat', negative: '' }, { id: 'bob', name: 'Bob', positive: 'hat', negative: '' },
    ], metadataUnknown: { foreign: { a: 1, b: 2 } } }))
    let document = cloneNovelaiDocument(state.document); document.characters[0].positive = '{coat}'
    state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'a1', source: 'agent', operation: 'coat', nextDocument: document }))
    document = cloneNovelaiDocument(state.document); document.characters[0].positive = 'user, {coat}'; document.characters[1].negative = 'lowres'
    state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId: 'u1', source: 'user', operation: 'characters', mode: 'typing', nextDocument: document }))
    const result = saved(undoNovelaiAgent(state, state.revision))
    expect(result.document.characters[0].positive).toBe('user, coat')
    expect(result.document.characters[1].negative).toBe('lowres')
    expect(result.document.metadataUnknown).toEqual({ foreign: { a: 1, b: 2 } })
  })

  it('replays IDs after JSON round-trip without reverting later user work and refuses conflicting payloads', () => {
    const first = initial()
    const nextDocument = createNovelaiDocument({ primary: '{sky}' })
    const input = { expectedRevision: 0, transactionId: 'asset-insertion', source: 'agent' as const, operation: 'insert', nextDocument }
    let state = saved(commitNovelaiDraft(first, input))
    state = saved(textCommit(state, 'user, {sky}', 'u1'))
    const restored = JSON.parse(JSON.stringify(state)) as NovelaiDraftState
    expect(validateNovelaiDraftState(restored).ok).toBe(true)
    expect(commitNovelaiDraft(restored, input)).toMatchObject({ ok: true, changed: false, replayed: true, state: restored })
    expect(commitNovelaiDraft(restored, { ...input, nextDocument: createNovelaiDocument({ primary: 'other' }) })).toMatchObject({ ok: false, code: 'TRANSACTION_CONFLICT', state: restored })
    expect(saved(undoNovelaiAgent(restored, restored.revision)).document.primary).toBe('user, sky')
  })

  it('bounds history to 100 groups and records a small actual delta for a large document', () => {
    let state = initial()
    for (let index = 0; index < 105; index += 1) state = saved(textCommit(state, 'sky-' + index, 'u-' + index))
    expect(state.history).toHaveLength(100)
    expect(validateNovelaiDraftState(JSON.parse(JSON.stringify(state))).ok).toBe(true)
    const raw = 'x'.repeat(4 * 1024 * 1024)
    const large = saved(textCommit(initial(raw), raw + 'y', 'one-key', 'user', 'focus'))
    expect(JSON.stringify(large.history).length).toBeLessThan(1500)
    expect(JSON.stringify(large).length).toBeLessThan(raw.length + 5000)
    expect(saved(undoNovelaiDraft(large, large.revision)).document.primary).toBe(raw)
  })

  it('rejects future or corrupted journal DTOs and leaves input documents immutable', () => {
    const state = initial()
    const before = JSON.stringify(state)
    saved(textCommit(state, 'rain', 'u1'))
    expect(JSON.stringify(state)).toBe(before)
    expect(validateNovelaiDraftState({ ...state, version: 2 }).ok).toBe(false)
    expect(validateNovelaiDraftState({ ...state, history: [{ id: 'bad' }] }).ok).toBe(false)
  })

  it('keeps the explicit origin of repeated text and refuses undo after that region was edited', () => {
    let state = initial('a')
    state = saved(commitNovelaiDraft(state, { expectedRevision: 0, transactionId: 'prepend-a', source: 'agent', operation: 'insert', changes: [{ kind: 'text', target: 'primary', range: { start: 0, end: 0 }, expectedText: '', text: 'a' }] }))
    state = saved(commitNovelaiDraft(state, { expectedRevision: 1, transactionId: 'replace-owned', source: 'user', operation: 'type', mode: 'typing', changes: [{ kind: 'text', target: 'primary', range: { start: 0, end: 1 }, expectedText: 'a', text: 'b' }] }))
    expect(undoNovelaiAgent(state, state.revision)).toMatchObject({ ok: false, code: 'HISTORY_CONFLICT', state })
    expect(state.document.primary).toBe('ba')
  })

  it('undoes the actual repeated-text insertion while preserving a change to the original character', () => {
    let state = initial('a')
    state = saved(commitNovelaiDraft(state, { expectedRevision: 0, transactionId: 'insert', source: 'agent', operation: 'insert', changes: [{ kind: 'text', target: 'primary', range: { start: 0, end: 0 }, expectedText: '', text: 'a' }] }))
    state = saved(commitNovelaiDraft(state, { expectedRevision: 1, transactionId: 'user-tail', source: 'user', operation: 'tail', mode: 'typing', changes: [{ kind: 'text', target: 'primary', range: { start: 1, end: 2 }, expectedText: 'a', text: 'b' }] }))
    expect(saved(undoNovelaiAgent(state, state.revision)).document.primary).toBe('b')
  })

  it('undoes and redoes exact batches with different-length disjoint edits', () => {
    const state = saved(commitNovelaiDraft(initial('a, b, c'), { expectedRevision: 0, transactionId: 'batch', source: 'agent', operation: 'batch', changes: [
      { kind: 'text', target: 'primary', range: { start: 0, end: 1 }, expectedText: 'a', text: 'alpha' },
      { kind: 'text', target: 'primary', range: { start: 6, end: 7 }, expectedText: 'c', text: 'charlie' },
    ] }))
    expect(state.history[0].entries[0].changes).toHaveLength(2)
    const undone = saved(undoNovelaiDraft(state, state.revision))
    expect(undone.document.primary).toBe('a, b, c')
    expect(saved(redoNovelaiDraft(undone, undone.revision)).document.primary).toBe('alpha, b, charlie')
    const later = saved(textCommit(state, 'alpha, user b, charlie', 'middle'))
    expect(saved(undoNovelaiAgent(later, later.revision)).document.primary).toBe('a, user b, c')
  })

  it('does not undo a user field choice after the value changed away and back', () => {
    let state = initial()
    for (const [transactionId, source, value] of [['agent', 'agent', '7'], ['u1', 'user', '8'], ['u2', 'user', '7']] as const) {
      state = saved(commitNovelaiDraft(state, { expectedRevision: state.revision, transactionId, source, operation: 'cfg', changes: [{ kind: 'field', path: ['generation', 'cfg'], expectedValue: state.document.generation.cfg, value }] }))
    }
    expect(undoNovelaiAgent(state, state.revision)).toMatchObject({ ok: false, code: 'HISTORY_CONFLICT', state })
    expect(state.document.generation.cfg).toBe('7')
  })

  it('preserves a later character order while undoing text by stable ID', () => {
    let state = createNovelaiDraftState(createNovelaiDocument({ characters: [{ id: 'a', name: 'A', positive: 'x', negative: '' }, { id: 'b', name: 'B', positive: 'y', negative: '' }] }))
    const document = cloneNovelaiDocument(state.document); document.characters[0].positive = '{x}'
    state = saved(commitNovelaiDraft(state, { expectedRevision: 0, transactionId: 'agent', source: 'agent', operation: 'weight', nextDocument: document }))
    const reordered = cloneNovelaiDocument(state.document); reordered.characters.reverse()
    state = saved(commitNovelaiDraft(state, { expectedRevision: 1, transactionId: 'order', source: 'user', operation: 'order', nextDocument: reordered }))
    const result = saved(undoNovelaiAgent(state, state.revision))
    expect(result.document.characters.map(character => character.id)).toEqual(['b', 'a'])
    expect(result.document.characters.find(character => character.id === 'a')?.positive).toBe('x')
    const ordinary = saved(undoNovelaiDraft(state, state.revision))
    expect(ordinary.document.characters.map(character => character.id)).toEqual(['a', 'b'])
  })

  it('rejects impossible field journal paths before accepting a recovered state', () => {
    const state = saved(textCommit(initial('a'), 'b', 'user'))
    state.history[0].entries[0].changes = [{ kind: 'field', path: ['primary'], before: { exists: true, value: 'a' }, after: { exists: true, value: 'b' } }]
    expect(validateNovelaiDraftState(state)).toMatchObject({ ok: false, code: 'INVALID_STATE' })
  })

  it('refuses an ambiguous Agent snapshot and requires its actual edit ranges', () => {
    const state = initial('a')
    expect(textCommit(state, 'aa', 'ambiguous', 'agent')).toMatchObject({ ok: false, code: 'AMBIGUOUS_EDIT', state })
    expect(state.revision).toBe(0)
  })

  it('undoes successive Agent groups after the later group was compensated', () => {
    let state = saved(textCommit(initial('a'), 'b', 'agent-1', 'agent'))
    state = saved(textCommit(state, 'c', 'agent-2', 'agent'))
    state = saved(textCommit(state, 'user, c', 'user-prefix'))
    state = saved(undoNovelaiAgent(state, state.revision))
    expect(state.document.primary).toBe('user, b')
    state = saved(undoNovelaiAgent(state, state.revision))
    expect(state.document.primary).toBe('user, a')
    const undone = saved(undoNovelaiDraft(state, state.revision))
    expect(undone.document.primary).toBe('user, b')
    expect(saved(redoNovelaiDraft(undone, undone.revision)).document.primary).toBe('user, a')
  })

  it('keeps a valid surrogate pair atomic when adjacent exact edits form it', () => {
    const state = saved(commitNovelaiDraft(initial('ab'), { expectedRevision: 0, transactionId: 'emoji', source: 'agent', operation: 'emoji', changes: [
      { kind: 'text', target: 'primary', range: { start: 0, end: 1 }, expectedText: 'a', text: '\uD83D' },
      { kind: 'text', target: 'primary', range: { start: 1, end: 2 }, expectedText: 'b', text: '\uDE00' },
    ] }))
    expect(state.document.primary).toBe('😀')
    expect(saved(undoNovelaiDraft(state, state.revision)).document.primary).toBe('ab')
    expect(saved(undoNovelaiAgent(state, state.revision)).document.primary).toBe('ab')
  })

  it('restores a removed character and its anchors as one valid inverse transaction', () => {
    const document = createNovelaiDocument({ characters: [{ id: 'c', name: '', positive: 'x', negative: '' }], blockMeta: [{ id: 'm', target: { characterId: 'c', field: 'positive' }, range: { start: 0, end: 1 }, expectedText: 'x', name: '', ownLine: false }] })
    const state = saved(commitNovelaiDraft(createNovelaiDraftState(document), { expectedRevision: 0, transactionId: 'remove', source: 'agent', operation: 'remove character', nextDocument: { ...document, characters: [], blockMeta: [] } }))
    expect(saved(undoNovelaiDraft(state, state.revision)).document).toEqual(document)
    expect(saved(undoNovelaiAgent(state, state.revision)).document).toEqual(document)
  })
})
