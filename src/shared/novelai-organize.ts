// Prompt organisation (M6.5): pure, testable operations plus a strict JSON contract for the
// AI planner. Nothing here calls a model — the contract and the refusal paths are the product;
// a planner that returns a malformed plan must fail loudly instead of half-applying it.
import { parsePromptDocument, promptWeightOf, serializePromptDocument, type PromptBlock, type PromptDocument } from './prompt-blocks'
import { applyPromptTextEdits, validatePromptSyntax } from './prompt-block-edit'

export type OrganizeOperation =
  | { readonly op: 'remove'; readonly index: number }
  | { readonly op: 'replace'; readonly index: number; readonly text: string }
  | { readonly op: 'move'; readonly from: number; readonly to: number }

export class OrganizePlanError extends Error {
  constructor(readonly code: 'NOT_JSON' | 'NOT_OBJECT' | 'NOT_ARRAY' | 'UNKNOWN_OP' | 'BAD_INDEX' | 'BAD_TEXT' | 'TOO_MANY' | 'DUPLICATE_BLOCK' | 'UNSAFE_CHANGE' | 'STALE_SUGGESTION' | 'INVALID_SYNTAX', message: string) {
    super(message)
    this.name = 'OrganizePlanError'
  }
}

const MAX_OPERATIONS = 500

/** Validate an untrusted planner payload. Unknown fields are ignored; unknown ops and
 * out-of-range indices are refused rather than skipped, because a partly-applied plan is a
 * prompt the user never saw. */
export function parseOrganizePlan(payload: unknown, blockCount: number): OrganizeOperation[] {
  let value = payload
  if (typeof payload === 'string') {
    try { value = JSON.parse(payload) } catch { throw new OrganizePlanError('NOT_JSON', 'plan is not valid JSON') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrganizePlanError('NOT_OBJECT', 'plan must be an object')
  const operations = (value as { operations?: unknown }).operations
  if (!Array.isArray(operations)) throw new OrganizePlanError('NOT_ARRAY', 'plan.operations must be an array')
  if (operations.length > MAX_OPERATIONS) throw new OrganizePlanError('TOO_MANY', 'plan has too many operations')
  const index = (raw: unknown, label: string): number => {
    if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) >= blockCount) throw new OrganizePlanError('BAD_INDEX', label + ' is out of range')
    return raw as number
  }
  return operations.map((raw, position) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OrganizePlanError('NOT_OBJECT', 'operation ' + position + ' must be an object')
    const op = raw as Record<string, unknown>
    switch (op.op) {
      case 'remove': return { op: 'remove' as const, index: index(op.index, 'remove.index') }
      case 'replace':
        if (typeof op.text !== 'string') throw new OrganizePlanError('BAD_TEXT', 'replace.text must be a string')
        return { op: 'replace' as const, index: index(op.index, 'replace.index'), text: op.text }
      case 'move': return { op: 'move' as const, from: index(op.from, 'move.from'), to: index(op.to, 'move.to') }
      default: throw new OrganizePlanError('UNKNOWN_OP', 'unknown operation ' + String(op.op))
    }
  })
}

export interface RenderedPrompt { readonly text: string; readonly blocks: readonly string[] }

/** Render blocks as a plain prompt: the original leading whitespace, a canonical `, ` separator,
 * and no trailing separator. Organise operations are allowed to change the text — unlike the
 * parser, whose job is byte-exact round-tripping. */
export function renderPromptBlocks(document: PromptDocument, blocks: readonly string[], leading?: string): string {
  const prefix = leading !== undefined ? leading : (document.blocks.length ? document.blocks[0].prefix : '')
  return prefix + blocks.join(', ')
}

function snapshot(document: PromptDocument): { leading: string; blocks: PromptBlock[] } {
  return { leading: document.blocks.length ? document.blocks[0].prefix : '', blocks: [...document.blocks] }
}

export interface OrganizeResult { readonly text: string; readonly changed: boolean; readonly applied: number }

function requireSyntax(text: string): void {
  if (validatePromptSyntax(text).length) throw new OrganizePlanError('INVALID_SYNTAX', 'the draft contains incomplete or ambiguous syntax')
}

const sameBlocks = (document: PromptDocument, blocks: readonly string[]): boolean =>
  blocks.length === document.blocks.length && blocks.every((text, index) => text === document.blocks[index].raw)

export function applyOrganizePlan(document: PromptDocument, operations: readonly OrganizeOperation[]): OrganizeResult {
  requireSyntax(document.source)
  const { leading } = snapshot(document)
  let blocks = document.blocks.map(block => block.raw)
  let applied = 0
  for (const operation of operations) {
    if (operation.op === 'remove') {
      if (operation.index >= blocks.length) throw new OrganizePlanError('BAD_INDEX', 'remove.index is out of range')
      blocks = blocks.filter((_, position) => position !== operation.index)
    } else if (operation.op === 'replace') {
      if (operation.index >= blocks.length) throw new OrganizePlanError('BAD_INDEX', 'replace.index is out of range')
      blocks = blocks.map((block, position) => (position === operation.index ? operation.text : block))
    } else {
      if (operation.from >= blocks.length || operation.to >= blocks.length) throw new OrganizePlanError('BAD_INDEX', 'move index is out of range')
      const [moved] = blocks.splice(operation.from, 1)
      blocks.splice(operation.to, 0, moved)
    }
    applied += 1
  }
  if (sameBlocks(document, blocks)) return { text: document.source, changed: false, applied: 0 }
  const text = leading + blocks.join(', ')
  requireSyntax(text)
  return { text, changed: text !== document.source, applied }
}

/** One reviewable change to a single block. `before` is derived from the draft by the parser,
 * never trusted from the model, so a suggestion can only be applied to the text it was made for. */
export interface OrganizeSuggestion {
  readonly block: number
  readonly before: string
  readonly after: string
  readonly title: string
  readonly reason: string
}

function closeSyntax(text: string): string {
  let result = text
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    let depth = 0
    for (const char of result) {
      if (char === open) depth += 1
      else if (char === close) depth -= 1
    }
    if (depth > 0) result += close.repeat(depth)
    if (depth < 0) result = open.repeat(-depth) + result
  }
  if ((result.match(/::/g)?.length ?? 0) % 2) result += '::'
  return result
}

function numericWeights(text: string): string[] {
  return text.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*::/g) ?? []
}

/** Keep the reference tool's two hard safety rules: a suggestion may not add a tag or change a
 * numeric weight. Structural repairs (closing `}`/`]`/`::`) are still allowed. */
function keepsTagsAndWeights(before: string, after: string): boolean {
  const beforeWeights = numericWeights(before)
  const afterWeights = numericWeights(after)
  if (beforeWeights.length !== afterWeights.length) return false
  if (beforeWeights.some((weight, index) => weight !== afterWeights[index])) return false
  const beforeWeight = promptWeightOf(before.trim())
  const afterWeight = promptWeightOf(after.trim())
  if (beforeWeight && afterWeight) return beforeWeight.kind === afterWeight.kind && beforeWeight.value === afterWeight.value
  if (!beforeWeight && !afterWeight) return true
  return after.trim() === closeSyntax(before.trim())
}

/** Validate an untrusted per-block proposal. Every malformed entry rejects the whole response:
 * applying a subset the user never reviewed is the failure mode this contract exists to stop. */
export function parseOrganizeSuggestions(payload: unknown, document: PromptDocument): OrganizeSuggestion[] {
  let value = payload
  if (typeof payload === 'string') {
    try { value = JSON.parse(payload) } catch { throw new OrganizePlanError('NOT_JSON', 'proposal is not valid JSON') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrganizePlanError('NOT_OBJECT', 'proposal must be an object')
  const rawChanges = (value as { changes?: unknown }).changes
  if (!Array.isArray(rawChanges)) throw new OrganizePlanError('NOT_ARRAY', 'proposal.changes must be an array')
  if (rawChanges.length > MAX_OPERATIONS) throw new OrganizePlanError('TOO_MANY', 'proposal has too many changes')
  const seen = new Set<number>()
  const suggestions: OrganizeSuggestion[] = []
  for (const [position, raw] of rawChanges.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OrganizePlanError('NOT_OBJECT', 'change ' + position + ' must be an object')
    const change = raw as Record<string, unknown>
    if (!Number.isInteger(change.block) || (change.block as number) < 0 || (change.block as number) >= document.blocks.length) {
      throw new OrganizePlanError('BAD_INDEX', 'change ' + position + '.block is out of range')
    }
    const block = change.block as number
    if (seen.has(block)) throw new OrganizePlanError('DUPLICATE_BLOCK', 'block ' + block + ' has more than one change')
    seen.add(block)
    if (typeof change.after !== 'string') throw new OrganizePlanError('BAD_TEXT', 'change ' + position + '.after must be a string')
    if (typeof change.title !== 'string' || !change.title.trim() || change.title.length > 500) throw new OrganizePlanError('BAD_TEXT', 'change ' + position + '.title must be a short non-empty string')
    if (typeof change.reason !== 'string' || !change.reason.trim() || change.reason.length > 500) throw new OrganizePlanError('BAD_TEXT', 'change ' + position + '.reason must be a short non-empty string')
    const source = document.blocks[block]
    const after = change.after.trim()
    if (!after) throw new OrganizePlanError('BAD_TEXT', 'change ' + position + '.after must not be empty')
    if (source.type === 'random') throw new OrganizePlanError('UNSAFE_CHANGE', 'random blocks cannot be rewritten')
    if (parsePromptDocument(after).blocks.length > 1) throw new OrganizePlanError('UNSAFE_CHANGE', 'a suggestion must stay inside one block')
    if (!keepsTagsAndWeights(source.raw, after)) throw new OrganizePlanError('UNSAFE_CHANGE', 'a suggestion may not add tags or change weights')
    if (after === source.raw) continue
    suggestions.push({ block, before: source.raw, after, title: change.title.trim(), reason: change.reason.trim() })
  }
  return suggestions
}

/** Apply only accepted suggestions to a draft. The caller saves explicitly with the work's
 * `expectedRevision`; this function never writes a version on its own. */
export function applyOrganizeSuggestions(document: PromptDocument, suggestions: readonly OrganizeSuggestion[]): OrganizeResult {
  if (!suggestions.length) return { text: document.source, changed: false, applied: 0 }
  requireSyntax(document.source)
  const seen = new Set<number>()
  const edits = suggestions.map(suggestion => {
    const block = document.blocks[suggestion.block]
    if (!Number.isInteger(suggestion.block) || !block) throw new OrganizePlanError('BAD_INDEX', 'suggestion block is out of range')
    if (seen.has(suggestion.block)) throw new OrganizePlanError('DUPLICATE_BLOCK', 'a block has more than one accepted change')
    seen.add(suggestion.block)
    if (block.raw !== suggestion.before) throw new OrganizePlanError('STALE_SUGGESTION', 'the draft changed since this suggestion was made')
    return { range: block.range, expectedText: suggestion.before, text: suggestion.after }
  })
  const result = applyPromptTextEdits(document.source, edits)
  if (!result.ok) throw new OrganizePlanError(result.code === 'STALE_TEXT' ? 'STALE_SUGGESTION' : 'INVALID_SYNTAX', result.code)
  return { text: result.text, changed: result.changed, applied: suggestions.filter(suggestion => suggestion.before !== suggestion.after).length }
}

const normalise = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()

/** Remove exact duplicates (case- and whitespace-insensitive), keeping the first occurrence. */
export function dedupeBlocks(document: PromptDocument): OrganizeResult {
  requireSyntax(document.source)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const block of document.blocks) {
    const key = normalise(block.raw)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(block.raw)
  }
  if (kept.length === document.blocks.length) return { text: document.source, changed: false, applied: 0 }
  return { text: renderPromptBlocks(document, kept), changed: true, applied: document.blocks.length - kept.length }
}

/** Stable, case-insensitive alphabetical sort; the user's own grouping is not reordered beyond that. */
export function sortBlocks(document: PromptDocument): OrganizeResult {
  requireSyntax(document.source)
  const ordered = document.blocks.map(block => block.raw).sort((a, b) => normalise(a).localeCompare(normalise(b)))
  if (sameBlocks(document, ordered)) return { text: document.source, changed: false, applied: 0 }
  const text = renderPromptBlocks(document, ordered)
  return { text, changed: text !== serializePromptDocument(document), applied: ordered.length }
}

/** Trim each block, drop empty ones, collapse internal whitespace. */
export function cleanupBlocks(document: PromptDocument): OrganizeResult {
  requireSyntax(document.source)
  const cleaned = document.blocks.map(block => block.raw.trim().replace(/\s+/g, ' ')).filter(Boolean)
  // Cleanup also drops the leading indentation: keeping it would defeat the point.
  const text = renderPromptBlocks(document, cleaned, '')
  requireSyntax(text)
  return { text, changed: text !== document.source, applied: cleaned.length }
}

/** Convenience for callers that only have text. */
export function organizePromptText(text: string, task: { kind: 'dedupe' | 'sort' | 'cleanup' }): OrganizeResult {
  const document = parsePromptDocument(text)
  if (task.kind === 'dedupe') return dedupeBlocks(document)
  if (task.kind === 'sort') return sortBlocks(document)
  return cleanupBlocks(document)
}
