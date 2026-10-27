// Prompt organisation (M6.5): pure, testable operations plus a strict JSON contract for the
// AI planner. Nothing here calls a model — the contract and the refusal paths are the product;
// a planner that returns a malformed plan must fail loudly instead of half-applying it.
import { parsePromptDocument, serializePromptDocument, type PromptBlock, type PromptDocument } from './prompt-blocks'

export type OrganizeOperation =
  | { readonly op: 'remove'; readonly index: number }
  | { readonly op: 'replace'; readonly index: number; readonly text: string }
  | { readonly op: 'move'; readonly from: number; readonly to: number }

export class OrganizePlanError extends Error {
  constructor(readonly code: 'NOT_JSON' | 'NOT_OBJECT' | 'NOT_ARRAY' | 'UNKNOWN_OP' | 'BAD_INDEX' | 'BAD_TEXT' | 'TOO_MANY', message: string) {
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

export function applyOrganizePlan(document: PromptDocument, operations: readonly OrganizeOperation[]): OrganizeResult {
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
  const text = leading + blocks.join(', ')
  return { text, changed: text !== serializePromptDocument(document), applied }
}

const normalise = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()

/** Remove exact duplicates (case- and whitespace-insensitive), keeping the first occurrence. */
export function dedupeBlocks(document: PromptDocument): OrganizeResult {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const block of document.blocks) {
    const key = normalise(block.raw)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(block.raw)
  }
  return { text: renderPromptBlocks(document, kept), changed: kept.length !== document.blocks.length, applied: document.blocks.length - kept.length }
}

/** Stable, case-insensitive alphabetical sort; the user's own grouping is not reordered beyond that. */
export function sortBlocks(document: PromptDocument): OrganizeResult {
  const ordered = document.blocks.map(block => block.raw).sort((a, b) => normalise(a).localeCompare(normalise(b)))
  const text = renderPromptBlocks(document, ordered)
  return { text, changed: text !== serializePromptDocument(document), applied: ordered.length }
}

/** Trim each block, drop empty ones, collapse internal whitespace. */
export function cleanupBlocks(document: PromptDocument): OrganizeResult {
  const cleaned = document.blocks.map(block => block.raw.trim().replace(/\s+/g, ' ')).filter(Boolean)
  // Cleanup also drops the leading indentation: keeping it would defeat the point.
  const text = renderPromptBlocks(document, cleaned, '')
  return { text, changed: text !== serializePromptDocument(document), applied: cleaned.length }
}

/** Convenience for callers that only have text. */
export function organizePromptText(text: string, task: { kind: 'dedupe' | 'sort' | 'cleanup' }): OrganizeResult {
  const document = parsePromptDocument(text)
  if (task.kind === 'dedupe') return dedupeBlocks(document)
  if (task.kind === 'sort') return sortBlocks(document)
  return cleanupBlocks(document)
}
