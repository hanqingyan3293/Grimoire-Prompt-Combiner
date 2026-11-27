import { applyPromptTextEdits, isPromptTextBoundary, validatePromptSyntax, type PromptTextEdit } from '@shared/prompt-block-edit'
import { cloneNovelaiDocument, getNovelaiDocumentText, validateNovelaiDocument, type NovelaiDocument, type NovelaiJsonValue, type NovelaiTextTarget } from '@shared/novelai-document'
import { encodeWorkspaceEditorState, WORKSPACE_EDITOR_MAX_BYTES } from '@shared/workspace-editor-state'

export const NOVELAI_DRAFT_HISTORY_LIMIT = 100
export interface NovelaiDraftOptions { maxHistoryBytes?: number; maxReplayEntries?: number }
export type NovelaiDraftSource = 'user' | 'agent'
export type NovelaiDraftMode = 'typing' | 'guarded'
export type NovelaiDraftChange =
  | ({ kind: 'text'; target: NovelaiTextTarget } & PromptTextEdit)
  | { kind: 'field'; path: readonly string[]; expectedValue: NovelaiJsonValue; value: NovelaiJsonValue }
export type NovelaiDraftCommit = {
  expectedRevision: number; transactionId: string; source: NovelaiDraftSource; operation: string
  groupId?: string; mode?: NovelaiDraftMode
} & ({ nextDocument: NovelaiDocument; changes?: never } | { changes: readonly NovelaiDraftChange[]; nextDocument?: never })

export type NovelaiFieldSlot = { exists: false } | { exists: true; value: NovelaiJsonValue }
export type NovelaiJournalDelta =
  | { kind: 'text'; target: NovelaiTextTarget; start: number; before: string; after: string; uncertainOrigin?: { start: number; end: number } }
  | { kind: 'field'; path: string[]; before: NovelaiFieldSlot; after: NovelaiFieldSlot }
  | { kind: 'character-order'; before: string[]; after: string[] }
export interface NovelaiJournalEntry { transactionId: string; changes: NovelaiJournalDelta[] }
export interface NovelaiDraftGroup {
  id: string; groupId: string; source: NovelaiDraftSource; operation: string; mode: NovelaiDraftMode
  epoch: number; targetKey: string; kind: 'commit' | 'agentUndo'; agentGroupId?: string
  entries: NovelaiJournalEntry[]
}
export interface NovelaiDraftReceipt { transactionId: string; digest: string; revision: number }
export interface NovelaiDraftState {
  version: 1; document: NovelaiDocument; revision: number; groupEpoch: number
  history: NovelaiDraftGroup[]; redo: NovelaiDraftGroup[]; receipts: NovelaiDraftReceipt[]
  undoneAgentGroups: string[]; limits: { maxHistoryBytes: number; maxReplayEntries: number }
}
export type NovelaiDraftCode = 'INVALID_STATE' | 'UNSUPPORTED_STATE_VERSION' | 'STATE_TOO_LARGE' | 'INVALID_DOCUMENT'
  | 'INVALID_TRANSACTION' | 'INVALID_CHANGE' | 'INVALID_SYNTAX' | 'INVALID_RANGE' | 'STALE_TEXT' | 'STALE_FIELD'
  | 'OVERLAPPING_EDITS' | 'UNKNOWN_TEXT_TARGET' | 'STALE_REVISION' | 'TRANSACTION_CONFLICT' | 'HISTORY_CONFLICT' | 'AMBIGUOUS_EDIT'
export type NovelaiDraftResult =
  | { ok: true; state: NovelaiDraftState; changed: boolean; replayed?: boolean; historyTruncated?: boolean }
  | { ok: false; state: NovelaiDraftState; changed: false; code: NovelaiDraftCode }
export type NovelaiDraftValidation = { ok: true; state: NovelaiDraftState } | { ok: false; code: NovelaiDraftCode }

class DraftError extends Error { constructor(readonly code: NovelaiDraftCode) { super(code) } }
function fail(code: NovelaiDraftCode): never { throw new DraftError(code) }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const targetKey = (target: NovelaiTextTarget): string => typeof target === 'string' ? target : JSON.stringify([target.characterId, target.field])
const targetPath = (target: NovelaiTextTarget): string[] => typeof target === 'string' ? [target] : ['characters', target.characterId, target.field]
const validTarget = (value: unknown): value is NovelaiTextTarget => value === 'primary' || value === 'negative'
  || object(value) && nonempty(value.characterId) && (value.field === 'positive' || value.field === 'negative')
const related = (a: readonly string[], b: readonly string[]): boolean => a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === b[index])
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)
const cloneJson = <T,>(value: T): T => JSON.parse(encodeWorkspaceEditorState(value)) as T
const refused = (state: NovelaiDraftState, code: NovelaiDraftCode): NovelaiDraftResult => ({ ok: false, state, changed: false, code })
const FIELD_ROOTS = ['characters', 'blockMeta', 'randomPools', 'quality', 'generation', 'metadataUnknown', 'provenance']
const validFieldPath = (path: readonly string[]): boolean => path.length > 0 && FIELD_ROOTS.includes(path[0]) && path.every(nonempty)

function fieldSlot(document: NovelaiDocument, path: readonly string[]): NovelaiFieldSlot {
  let current: unknown = document
  for (const key of path) {
    if (Array.isArray(current)) current = current.find(item => object(item) && item.id === key)
    else if (object(current) && Object.hasOwn(current, key)) current = current[key]
    else return { exists: false }
    if (current === undefined) return { exists: false }
  }
  return { exists: true, value: current as NovelaiJsonValue }
}
function writeField(document: NovelaiDocument, path: readonly string[], slot: NovelaiFieldSlot): void {
  if (!validFieldPath(path)) fail('INVALID_CHANGE')
  let parent: unknown = document
  for (const key of path.slice(0, -1)) {
    parent = Array.isArray(parent) ? parent.find(item => object(item) && item.id === key)
      : object(parent) && Object.hasOwn(parent, key) ? parent[key] : undefined
    if (!object(parent) && !Array.isArray(parent)) fail('INVALID_CHANGE')
  }
  const key = path[path.length - 1]
  if (!object(parent)) fail('INVALID_CHANGE')
  if (!slot.exists) delete parent[key]
  else Object.defineProperty(parent, key, { value: cloneJson(slot.value), enumerable: true, writable: true, configurable: true })
}
function writeText(document: NovelaiDocument, target: NovelaiTextTarget, text: string): void {
  if (target === 'primary' || target === 'negative') document[target] = text
  else {
    const character = document.characters.find(item => item.id === target.characterId)
    if (!character) fail('UNKNOWN_TEXT_TARGET')
    character![target.field] = text
  }
}

/** The smallest contiguous UTF-16 delta, including a whole surrogate pair at each boundary. */
function textDelta(target: NovelaiTextTarget, before: string, after: string): NovelaiJournalDelta | null {
  if (before === after) return null
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  while (!isPromptTextBoundary(before, start) || !isPromptTextBoundary(after, start)) start -= 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore -= 1; endAfter -= 1 }
  while (!isPromptTextBoundary(before, endBefore) || !isPromptTextBoundary(after, endAfter)) { endBefore += 1; endAfter += 1 }
  let suffix = 0
  while (suffix < before.length && suffix < after.length && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  let earliest = before.length - suffix - (endBefore - start)
  while (earliest >= 0 && (!isPromptTextBoundary(before, earliest) || !isPromptTextBoundary(after, earliest))) earliest++
  const uncertainOrigin = earliest >= 0 && earliest < start ? { start: earliest, end: endBefore } : undefined
  return { kind: 'text', target: cloneJson(target), start, before: before.slice(start, endBefore), after: after.slice(start, endAfter), ...(uncertainOrigin ? { uncertainOrigin } : {}) }
}
function diffFields(before: NovelaiFieldSlot, after: NovelaiFieldSlot, path: string[], output: NovelaiJournalDelta[]): void {
  if (equal(before, after)) return
  if (before.exists && after.exists && object(before.value) && object(after.value)) {
    for (const key of [...new Set([...Object.keys(before.value), ...Object.keys(after.value)])].sort()) {
      diffFields(Object.hasOwn(before.value, key) ? { exists: true, value: before.value[key] as NovelaiJsonValue } : { exists: false },
        Object.hasOwn(after.value, key) ? { exists: true, value: after.value[key] as NovelaiJsonValue } : { exists: false }, [...path, key], output)
    }
  } else output.push({ kind: 'field', path, before: cloneJson(before), after: cloneJson(after) })
}
function documentDeltas(before: NovelaiDocument, after: NovelaiDocument): NovelaiJournalDelta[] {
  const deltas: NovelaiJournalDelta[] = []
  for (const target of ['primary', 'negative'] as const) { const delta = textDelta(target, before[target], after[target]); if (delta) deltas.push(delta) }
  const beforeIds = before.characters.map(item => item.id); const afterIds = after.characters.map(item => item.id)
  if (equal([...beforeIds].sort(), [...afterIds].sort())) {
    if (!equal(beforeIds, afterIds)) deltas.push({ kind: 'character-order', before: beforeIds, after: afterIds })
    for (const character of before.characters) {
      const next = after.characters.find(item => item.id === character.id)!
      for (const field of ['positive', 'negative'] as const) {
        const delta = textDelta({ characterId: character.id, field }, character[field], next[field]); if (delta) deltas.push(delta)
      }
      diffFields({ exists: true, value: character.name }, { exists: true, value: next.name }, ['characters', character.id, 'name'], deltas)
    }
  } else deltas.push({ kind: 'field', path: ['characters'], before: { exists: true, value: cloneJson(before.characters) as unknown as NovelaiJsonValue }, after: { exists: true, value: cloneJson(after.characters) as unknown as NovelaiJsonValue } })
  for (const field of ['blockMeta', 'randomPools', 'quality', 'generation', 'metadataUnknown', 'provenance'] as const) {
    diffFields({ exists: true, value: before[field] as unknown as NovelaiJsonValue }, { exists: true, value: after[field] as unknown as NovelaiJsonValue }, [field], deltas)
  }
  return deltas
}
const inverted = (delta: NovelaiJournalDelta): NovelaiJournalDelta => delta.kind === 'text'
  ? { ...delta, before: delta.after, after: delta.before } : delta.kind === 'field'
    ? { ...delta, before: delta.after, after: delta.before } : { ...delta, before: delta.after, after: delta.before }

function orderedDeltas(deltas: readonly NovelaiJournalDelta[]): NovelaiJournalDelta[] {
  const text = deltas.filter((delta): delta is Extract<NovelaiJournalDelta, { kind: 'text' }> => delta.kind === 'text')
    .sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)) || b.start - a.start)
  return [...deltas.filter(delta => delta.kind !== 'text'), ...text]
}

function checkedHistoryDocument(document: NovelaiDocument): NovelaiDocument {
  const checked = validateNovelaiDocument(document)
  if (!checked.ok) fail('HISTORY_CONFLICT')
  return checked.document
}

function applyDeltas(document: NovelaiDocument, deltas: readonly NovelaiJournalDelta[], inverse = false, validateResult = true): NovelaiDocument {
  if (inverse) {
    let next = document
    for (const delta of orderedDeltas(deltas).reverse()) next = applyDeltas(next, [inverted(delta)], false, false)
    return validateResult ? checkedHistoryDocument(next) : next
  }
  const changes = deltas
  for (const delta of changes) {
    if (delta.kind === 'field') { if (!equal(fieldSlot(document, delta.path), delta.before)) fail('HISTORY_CONFLICT') }
    else if (delta.kind === 'character-order') { if (!equal(document.characters.map(character => character.id), delta.before)) fail('HISTORY_CONFLICT') }
    else {
      const raw = getNovelaiDocumentText(document, delta.target)
      if (raw === undefined || !isPromptTextBoundary(raw, delta.start) || !isPromptTextBoundary(raw, delta.start + delta.before.length)
        || raw.slice(delta.start, delta.start + delta.before.length) !== delta.before) fail('HISTORY_CONFLICT')
    }
  }
  const next = cloneJson(document)
  for (const delta of orderedDeltas(changes)) {
    if (delta.kind === 'field') writeField(next, delta.path, delta.after)
    else if (delta.kind === 'character-order') next.characters = delta.after.map(id => next.characters.find(character => character.id === id)!)
    else { const raw = getNovelaiDocumentText(next, delta.target)!; writeText(next, delta.target, raw.slice(0, delta.start) + delta.after + raw.slice(delta.start + delta.before.length)) }
  }
  return validateResult ? checkedHistoryDocument(next) : next
}
function applyGroup(document: NovelaiDocument, group: NovelaiDraftGroup, inverse: boolean): NovelaiDocument {
  let next = document
  for (const entry of inverse ? [...group.entries].reverse() : group.entries) next = applyDeltas(next, entry.changes, inverse)
  return next
}
function assertSyntax(document: NovelaiDocument): void {
  const raws = [document.primary, document.negative, ...document.characters.flatMap(character => [character.positive, character.negative])]
  if (raws.some(raw => validatePromptSyntax(raw).length)) fail('INVALID_SYNTAX')
}

function validDelta(value: unknown): boolean {
  if (!object(value)) return false
  if (value.kind === 'text') return validTarget(value.target) && integer(value.start) && typeof value.before === 'string' && typeof value.after === 'string'
    && (value.uncertainOrigin === undefined || object(value.uncertainOrigin) && integer(value.uncertainOrigin.start) && integer(value.uncertainOrigin.end)
      && value.uncertainOrigin.start <= value.start && value.uncertainOrigin.end >= value.start + value.before.length)
  if (value.kind === 'character-order') return Array.isArray(value.before) && Array.isArray(value.after) && value.before.every(nonempty) && value.after.every(nonempty)
    && new Set(value.before).size === value.before.length && equal([...value.before].sort(), [...value.after].sort())
  const slot = (item: unknown) => object(item) && (item.exists === false || item.exists === true && Object.hasOwn(item, 'value'))
  return value.kind === 'field' && Array.isArray(value.path) && validFieldPath(value.path) && slot(value.before) && slot(value.after)
}
function validGroup(value: unknown): boolean {
  if (!object(value) || !nonempty(value.id) || !nonempty(value.groupId) || !nonempty(value.operation) || !integer(value.epoch) || typeof value.targetKey !== 'string'
    || !['user', 'agent'].includes(value.source as string) || !['typing', 'guarded'].includes(value.mode as string)
    || !['commit', 'agentUndo'].includes(value.kind as string) || value.kind === 'agentUndo' && !nonempty(value.agentGroupId)
    || !Array.isArray(value.entries) || !value.entries.length) return false
  return value.entries.every(entry => object(entry) && nonempty(entry.transactionId) && Array.isArray(entry.changes) && entry.changes.every(validDelta))
}
export function validateNovelaiDraftState(value: unknown): NovelaiDraftValidation {
  try {
    if (!object(value)) fail('INVALID_STATE')
    if (value.version !== 1) fail('UNSUPPORTED_STATE_VERSION')
    let state: NovelaiDraftState
    try { state = cloneJson(value) as unknown as NovelaiDraftState } catch (error) { fail(String(error).includes('EDITOR_STATE_TOO_LARGE') ? 'STATE_TOO_LARGE' : 'INVALID_STATE') }
    const document = validateNovelaiDocument(state!.document)
    if (!document.ok) fail('INVALID_DOCUMENT')
    if (!integer(state!.revision) || !integer(state!.groupEpoch) || !Array.isArray(state!.history) || !Array.isArray(state!.redo)
      || state!.history.length + state!.redo.length > NOVELAI_DRAFT_HISTORY_LIMIT || ![...state!.history, ...state!.redo].every(validGroup)
      || !object(state!.limits) || !integer(state!.limits.maxHistoryBytes) || state!.limits.maxHistoryBytes > WORKSPACE_EDITOR_MAX_BYTES
      || !integer(state!.limits.maxReplayEntries) || !state!.limits.maxReplayEntries || state!.limits.maxReplayEntries > 10000
      || !Array.isArray(state!.receipts) || state!.receipts.length > state!.limits.maxReplayEntries
      || state!.receipts.some(receipt => !object(receipt) || !nonempty(receipt.transactionId) || typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest) || !integer(receipt.revision) || receipt.revision > state!.revision)
      || new Set(state!.receipts.map(receipt => receipt.transactionId)).size !== state!.receipts.length
      || !Array.isArray(state!.undoneAgentGroups) || !state!.undoneAgentGroups.every(nonempty)
      || new TextEncoder().encode(JSON.stringify([state!.history, state!.redo])).byteLength > state!.limits.maxHistoryBytes) fail('INVALID_STATE')
    state!.document = document.ok ? document.document : state!.document
    return { ok: true, state: state! }
  } catch (error) { return { ok: false, code: error instanceof DraftError ? error.code : 'INVALID_STATE' } }
}
export function createNovelaiDraftState(document: NovelaiDocument, options: NovelaiDraftOptions = {}): NovelaiDraftState {
  const state: NovelaiDraftState = { version: 1, document: cloneNovelaiDocument(document), revision: 0, groupEpoch: 0,
    history: [], redo: [], receipts: [], undoneAgentGroups: [], limits: { maxHistoryBytes: options.maxHistoryBytes ?? 256 * 1024, maxReplayEntries: options.maxReplayEntries ?? 1024 } }
  const checked = validateNovelaiDraftState(state)
  if (!checked.ok) fail(checked.code)
  return checked.ok ? checked.state : state
}
function bounded(state: NovelaiDraftState): { state: NovelaiDraftState; truncated: boolean } {
  let truncated = false
  const drop = () => { if (state.history.length) state.history.shift(); else if (state.redo.length) state.redo.shift(); else return false; truncated = true; return true }
  while (state.history.length + state.redo.length > NOVELAI_DRAFT_HISTORY_LIMIT) drop()
  while (new TextEncoder().encode(JSON.stringify([state.history, state.redo])).byteLength > state.limits.maxHistoryBytes) if (!drop()) fail('STATE_TOO_LARGE')
  state.receipts = state.receipts.slice(-state.limits.maxReplayEntries)
  state.undoneAgentGroups = state.undoneAgentGroups.filter(id => [...state.history, ...state.redo].some(group => group.id === id))
  for (;;) {
    try { encodeWorkspaceEditorState(state); break }
    catch (error) {
      if (!String(error).includes('EDITOR_STATE_TOO_LARGE')) fail('INVALID_STATE')
      if (!drop()) { if (state.receipts.length) state.receipts.shift(); else fail('STATE_TOO_LARGE') }
    }
  }
  return { state, truncated }
}

function typingEdits(raw: string, edits: readonly PromptTextEdit[]): string {
  for (const edit of edits) {
    if (!edit?.range || !isPromptTextBoundary(raw, edit.range.start) || !isPromptTextBoundary(raw, edit.range.end) || edit.range.end < edit.range.start
      || typeof edit.expectedText !== 'string' || typeof edit.text !== 'string') fail('INVALID_RANGE')
    if (raw.slice(edit.range.start, edit.range.end) !== edit.expectedText) fail('STALE_TEXT')
    if (edit.uncertainOrigin !== undefined) {
      const origin = edit.uncertainOrigin
      if (!origin || !isPromptTextBoundary(raw, origin.start) || !isPromptTextBoundary(raw, origin.end) || origin.start > edit.range.start || origin.end < edit.range.end) fail('INVALID_RANGE')
    }
  }
  const ordered = [...edits].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end)
  for (let index = 1; index < ordered.length; index += 1) {
    const a = ordered[index - 1].range; const b = ordered[index].range
    if (b.start < a.end || b.start === a.end && (a.start === a.end || b.start === b.end)) fail('OVERLAPPING_EDITS')
  }
  let next = raw
  for (const edit of ordered.reverse()) next = next.slice(0, edit.range.start) + edit.text + next.slice(edit.range.end)
  return next
}
function changedDocument(document: NovelaiDocument, changes: readonly NovelaiDraftChange[], guarded: boolean): NovelaiDocument {
  if (!Array.isArray(changes)) fail('INVALID_CHANGE')
  const text = new Map<string, { target: NovelaiTextTarget; edits: PromptTextEdit[] }>()
  const fields: Extract<NovelaiDraftChange, { kind: 'field' }>[] = []
  for (const rawChange of changes) {
    if (!object(rawChange)) fail('INVALID_CHANGE')
    const change = rawChange as NovelaiDraftChange
    if (change.kind === 'text' && validTarget(change.target)) {
      const key = targetKey(change.target); const bucket = text.get(key) || { target: change.target, edits: [] }
      bucket.edits.push(change); text.set(key, bucket)
    } else if (change.kind === 'field' && Array.isArray(change.path) && change.path.length && change.path.every(nonempty)
      && Object.hasOwn(change, 'expectedValue') && Object.hasOwn(change, 'value')) fields.push(change)
    else fail('INVALID_CHANGE')
  }
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (fields.slice(0, index).some(previous => related(previous.path, field.path)) || [...text.values()].some(bucket => related(field.path, targetPath(bucket.target)))) fail('OVERLAPPING_EDITS')
    if (!equal(fieldSlot(document, field.path), { exists: true, value: field.expectedValue })) fail('STALE_FIELD')
  }
  const next = cloneNovelaiDocument(document)
  for (const bucket of text.values()) {
    const raw = getNovelaiDocumentText(document, bucket.target)
    if (raw === undefined) fail('UNKNOWN_TEXT_TARGET')
    if (guarded) {
      const result = applyPromptTextEdits(raw!, bucket.edits)
      if (!result.ok) fail(result.code as NovelaiDraftCode)
      writeText(next, bucket.target, result.text)
    } else writeText(next, bucket.target, typingEdits(raw!, bucket.edits))
  }
  for (const field of fields) writeField(next, field.path, { exists: true, value: field.value })
  return next
}

function exactTextDeltas(changes: readonly Extract<NovelaiDraftChange, { kind: 'text' }>[]): NovelaiJournalDelta[] {
  const result: Extract<NovelaiJournalDelta, { kind: 'text' }>[] = []
  const ordered = changes.filter(change => change.expectedText !== change.text).sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)) || a.range.start - b.range.start)
  for (const change of ordered) {
    const previous = result.at(-1)
    if (previous && targetKey(previous.target) === targetKey(change.target) && previous.start + previous.before.length === change.range.start) {
      previous.before += change.expectedText; previous.after += change.text
      if (previous.uncertainOrigin || change.uncertainOrigin) previous.uncertainOrigin = { start: Math.min(previous.uncertainOrigin?.start ?? previous.start, change.uncertainOrigin?.start ?? change.range.start), end: Math.max(previous.start + previous.before.length, previous.uncertainOrigin?.end ?? 0, change.uncertainOrigin?.end ?? 0) }
    } else result.push({ kind: 'text', target: cloneJson(change.target), start: change.range.start, before: change.expectedText, after: change.text, ...(change.uncertainOrigin ? { uncertainOrigin: cloneJson(change.uncertainOrigin) } : {}) })
  }
  return result
}

export function commitNovelaiDraft(state: NovelaiDraftState, input: NovelaiDraftCommit): NovelaiDraftResult {
  try {
    const checked = validateNovelaiDraftState(state)
    if (!checked.ok) fail(checked.code)
    if (!input || !integer(input.expectedRevision) || !nonempty(input.transactionId) || !nonempty(input.operation)
      || !['user', 'agent'].includes(input.source) || input.groupId !== undefined && !nonempty(input.groupId)
      || input.mode !== undefined && !['typing', 'guarded'].includes(input.mode)
      || (input.nextDocument !== undefined) === (input.changes !== undefined)) fail('INVALID_TRANSACTION')
    const mode = input.source === 'agent' ? 'guarded' : input.mode ?? 'guarded'
    const groupId = input.groupId ?? input.transactionId
    const payload = { expectedRevision: input.expectedRevision, transactionId: input.transactionId, source: input.source, operation: input.operation, groupId, mode: input.mode ?? 'guarded',
      ...(input.nextDocument !== undefined ? { nextDocument: input.nextDocument } : { changes: input.changes }) }
    const digest = sha256(canonical(cloneJson(payload)))
    const receipt = checked.ok ? checked.state.receipts.find(item => item.transactionId === input.transactionId) : undefined
    if (receipt) return receipt.digest === digest ? { ok: true, state, changed: false, replayed: true } : refused(state, 'TRANSACTION_CONFLICT')
    if (input.expectedRevision !== state.revision) fail('STALE_REVISION')
    const current = checked.ok ? checked.state : state
    if (mode === 'guarded') assertSyntax(current.document)
    const next = input.nextDocument !== undefined ? validateNovelaiDocument(input.nextDocument) : validateNovelaiDocument(changedDocument(current.document, input.changes!, mode === 'guarded'))
    if (!next.ok) fail(next.code === 'DOCUMENT_TOO_LARGE' ? 'STATE_TOO_LARGE' : 'INVALID_DOCUMENT')
    if (mode === 'guarded') assertSyntax(next.document)
    let deltas = documentDeltas(current.document, next.document)
    if (input.changes) {
      const explicit = input.changes.filter((change): change is Extract<NovelaiDraftChange, { kind: 'text' }> => change.kind === 'text')
      const targets = new Set(explicit.map(change => targetKey(change.target)))
      deltas = [...deltas.filter(delta => delta.kind !== 'text' || !targets.has(targetKey(delta.target))),
        ...exactTextDeltas(explicit)]
    }
    if (input.source === 'agent' && deltas.some(delta => delta.kind === 'text' && delta.uncertainOrigin)) fail('AMBIGUOUS_EDIT')
    const revision = current.revision + (deltas.length ? 1 : 0)
    if (!integer(revision)) fail('INVALID_STATE')
    const entry: NovelaiJournalEntry = { transactionId: input.transactionId, changes: deltas }
    const keys = [...new Set(deltas.map(delta => delta.kind === 'text' ? 'text:' + targetKey(delta.target) : delta.kind === 'field' ? 'field:' + JSON.stringify(delta.path) : 'order:characters'))].sort().join('|')
    if (deltas.length) {
      const last = current.history.at(-1)
      if (!current.redo.length && last?.kind === 'commit' && last.epoch === current.groupEpoch && last.groupId === groupId && last.source === input.source
        && last.operation === input.operation && last.mode === mode && last.targetKey === keys) last.entries.push(entry)
      else current.history.push({ id: input.transactionId, groupId, source: input.source, operation: input.operation, mode, epoch: current.groupEpoch, targetKey: keys, kind: 'commit', entries: [entry] })
      current.redo = []
    }
    current.document = next.document; current.revision = revision
    current.receipts.push({ transactionId: input.transactionId, digest, revision })
    const result = bounded(current)
    return { ok: true, state: result.state, changed: !!deltas.length, ...(result.truncated ? { historyTruncated: true } : {}) }
  } catch (error) { return refused(state, error instanceof DraftError ? error.code : 'INVALID_TRANSACTION') }
}

function undoRedo(state: NovelaiDraftState, expectedRevision: number, redo: boolean): NovelaiDraftResult {
  try {
    const checked = validateNovelaiDraftState(state); if (!checked.ok) fail(checked.code)
    if (!integer(expectedRevision) || expectedRevision !== state.revision) fail('STALE_REVISION')
    const next = checked.ok ? checked.state : state
    const source = redo ? next.redo : next.history; const destination = redo ? next.history : next.redo
    const group = source.at(-1); if (!group) return { ok: true, state, changed: false }
    const document = applyGroup(next.document, group, !redo)
    const changed = !equal(next.document, document)
    source.pop(); destination.push(group); next.document = document; next.revision += changed ? 1 : 0; next.groupEpoch += 1
    if (group.kind === 'agentUndo') {
      next.undoneAgentGroups = redo ? [...new Set([...next.undoneAgentGroups, group.agentGroupId!])] : next.undoneAgentGroups.filter(id => id !== group.agentGroupId)
    }
    const result = bounded(next)
    return { ok: true, state: result.state, changed, ...(result.truncated ? { historyTruncated: true } : {}) }
  } catch (error) { return refused(state, error instanceof DraftError ? error.code : 'HISTORY_CONFLICT') }
}
export function undoNovelaiDraft(state: NovelaiDraftState, expectedRevision: number): NovelaiDraftResult { return undoRedo(state, expectedRevision, false) }
export function redoNovelaiDraft(state: NovelaiDraftState, expectedRevision: number): NovelaiDraftResult { return undoRedo(state, expectedRevision, true) }

/** Transform an exact inverse through the later edits. Also transform those later edits onto
 * the document with this inverse applied, so the next inverse retains its original coordinates.
 * A later choice of the same field conflicts even if its value changed away and back. */
function rebaseSelectiveInverse(original: NovelaiJournalDelta, later: readonly NovelaiJournalDelta[]): { inverse: NovelaiJournalDelta; later: NovelaiJournalDelta[] } {
  const inverse = cloneJson(original)
  const rebased = later.map(previous => {
    const change = cloneJson(previous)
    if (inverse.kind === 'field') {
      if (change.kind === 'field' && related(inverse.path, change.path)
        || change.kind === 'text' && related(inverse.path, targetPath(change.target))
        || change.kind === 'character-order' && inverse.path.length === 1 && inverse.path[0] === 'characters') fail('HISTORY_CONFLICT')
    } else if (inverse.kind === 'character-order') {
      if (change.kind === 'character-order' || change.kind === 'field' && change.path.length === 1 && change.path[0] === 'characters') fail('HISTORY_CONFLICT')
    } else {
      if (change.kind === 'field' && related(change.path, targetPath(inverse.target))) fail('HISTORY_CONFLICT')
      if (change.kind !== 'text' || targetKey(change.target) !== targetKey(inverse.target)) return change
      const start = inverse.start; const end = start + inverse.before.length
      const changedEnd = change.start + change.before.length
      if (change.uncertainOrigin && (start === end ? change.uncertainOrigin.start <= start && change.uncertainOrigin.end >= start : change.uncertainOrigin.start < end && change.uncertainOrigin.end > start)) fail('HISTORY_CONFLICT')
      const moveLater = () => {
        const shift = inverse.after.length - inverse.before.length
        change.start += shift
        if (change.uncertainOrigin) change.uncertainOrigin = { start: change.uncertainOrigin.start + shift, end: change.uncertainOrigin.end + shift }
      }
      if (change.before.length === 0) {
        if (start === end && change.start === start) fail('HISTORY_CONFLICT')
        if (change.start <= start) inverse.start += change.after.length
        else if (change.start >= end) moveLater()
        else fail('HISTORY_CONFLICT')
      } else if (changedEnd <= start) inverse.start += change.after.length - change.before.length
      else if (change.start >= end) moveLater()
      else fail('HISTORY_CONFLICT')
    }
    return change
  })
  return { inverse, later: rebased }
}

/** A completed selective undo cancels its original Agent group. Rebase the intervening edits
 * before removing the pair; their user choices remain in history, including ABA changes. */
function effectiveLaterChanges(groups: readonly NovelaiDraftGroup[], undoneAgentGroups: readonly string[]): NovelaiJournalDelta[] {
  let effective: Array<{ group: NovelaiDraftGroup; changes: NovelaiJournalDelta[] }> = []
  for (const group of groups) {
    const changes = group.entries.flatMap(entry => orderedDeltas(entry.changes))
    const index = group.kind === 'agentUndo' && undoneAgentGroups.includes(group.agentGroupId!) ? effective.findIndex(item => item.group.id === group.agentGroupId) : -1
    if (index < 0) { effective.push({ group, changes }); continue }
    const cancelled = effective[index]
    const between = effective.slice(index + 1)
    let later = between.flatMap(item => item.changes)
    const inverses: NovelaiJournalDelta[] = []
    for (const delta of [...cancelled.changes].reverse()) {
      const rebased = rebaseSelectiveInverse(inverted(delta), later)
      later = rebased.later; inverses.push(rebased.inverse)
    }
    if (!equal(changes, inverses)) fail('HISTORY_CONFLICT')
    let offset = 0
    const rebasedBetween = between.map(item => { const next = { group: item.group, changes: later.slice(offset, offset + item.changes.length) }; offset += item.changes.length; return next })
    effective = [...effective.slice(0, index), ...rebasedBetween]
  }
  return effective.flatMap(item => item.changes)
}

/** A selective undo is a compensating journal group. Ordinary undo/redo can therefore undo or
 * redo that action without rewriting old user entries or restoring an old document snapshot. */
export function undoNovelaiAgent(state: NovelaiDraftState, expectedRevision: number, groupId?: string): NovelaiDraftResult {
  try {
    const checked = validateNovelaiDraftState(state); if (!checked.ok) fail(checked.code)
    if (!integer(expectedRevision) || expectedRevision !== state.revision) fail('STALE_REVISION')
    const next = checked.ok ? checked.state : state
    let index = next.history.length - 1
    while (index >= 0) { const group = next.history[index]; if (group.kind === 'commit' && group.source === 'agent' && !next.undoneAgentGroups.includes(group.id) && (groupId === undefined || group.groupId === groupId || group.id === groupId)) break; index -= 1 }
    if (index < 0) return { ok: true, state, changed: false }
    assertSyntax(next.document)
    const group = next.history[index]
    let later = effectiveLaterChanges(next.history.slice(index + 1), next.undoneAgentGroups)
    let document = next.document
    const inverses: NovelaiJournalDelta[] = []
    for (const entry of [...group.entries].reverse()) for (const delta of orderedDeltas(entry.changes).reverse()) {
      const result = rebaseSelectiveInverse(inverted(delta), later)
      document = applyDeltas(document, [result.inverse], false, false)
      later = result.later
      inverses.push(result.inverse)
    }
    document = checkedHistoryDocument(document)
    assertSyntax(document)
    next.undoneAgentGroups.push(group.id)
    next.groupEpoch += 1
    if (equal(next.document, document)) return { ok: true, state: next, changed: false }
    next.revision += 1; next.document = document; next.redo = []
    const id = 'undo-agent:' + next.revision + ':' + group.id
    next.history.push({ id, groupId: id, source: 'user', operation: 'undo Agent: ' + group.operation, mode: 'guarded', epoch: next.groupEpoch, targetKey: '', kind: 'agentUndo', agentGroupId: group.id, entries: inverses.map((delta, position) => ({ transactionId: id + ':' + position, changes: [delta] })) })
    const result = bounded(next)
    return { ok: true, state: result.state, changed: true, ...(result.truncated ? { historyTruncated: true } : {}) }
  } catch (error) { return refused(state, error instanceof DraftError ? error.code : 'HISTORY_CONFLICT') }
}

// Synchronous SHA-256 keeps reducers browser-compatible and receipts independent of raw copies.
function sha256(text: string): string {
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
  const bytes = new TextEncoder().encode(text)
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64); padded.set(bytes); padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
  const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  const words = new Uint32Array(64); const rotate = (value: number, count: number) => value >>> count | value << 32 - count
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) { const a = words[index - 15]; const b = words[index - 2]; words[index] = words[index - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + words[index - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10) }
    let [a,b,c,d,e,f,g,h] = state
    for (let index = 0; index < 64; index += 1) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[index] + words[index]) >>> 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0
    }
    for (const [index, value] of [a,b,c,d,e,f,g,h].entries()) state[index] = (state[index] + value) >>> 0
  }
  return state.map(value => value.toString(16).padStart(8, '0')).join('')
}
