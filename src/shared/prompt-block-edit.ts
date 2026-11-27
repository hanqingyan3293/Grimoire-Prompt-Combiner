import { hasWholeBracketWrapper, parsePromptDocument, scanPromptSyntax, type PromptSyntaxDiagnostic, type TextRange } from './prompt-blocks'

export interface PromptTextEdit { readonly range: TextRange; readonly expectedText: string; readonly text: string; readonly uncertainOrigin?: TextRange }
export type PromptEditCode = 'INVALID_SYNTAX' | 'INVALID_RANGE' | 'STALE_TEXT' | 'OVERLAPPING_EDITS' | 'INVALID_BLOCK' | 'INVALID_WEIGHT' | 'AMBIGUOUS_EDIT'
export type PromptEditResult =
  | { readonly ok: true; readonly text: string; readonly changed: boolean; readonly diagnostics: readonly PromptSyntaxDiagnostic[] }
  | { readonly ok: false; readonly text: string; readonly changed: false; readonly code: PromptEditCode; readonly diagnostics: readonly PromptSyntaxDiagnostic[] }

export function validatePromptSyntax(raw: string): readonly PromptSyntaxDiagnostic[] { return scanPromptSyntax(raw).diagnostics }

export function isPromptTextBoundary(raw: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > raw.length) return false
  const before = raw.charCodeAt(offset - 1)
  const after = raw.charCodeAt(offset)
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF)
}

const refused = (text: string, code: PromptEditCode, diagnostics: readonly PromptSyntaxDiagnostic[] = []): PromptEditResult => ({ ok: false, text, changed: false, code, diagnostics })

/** All coordinates refer to the original raw. No partial edits escape if any precondition fails. */
export function applyPromptTextEdits(raw: string, edits: readonly PromptTextEdit[]): PromptEditResult {
  const diagnostics = validatePromptSyntax(raw)
  if (diagnostics.length) return refused(raw, 'INVALID_SYNTAX', diagnostics)
  for (const edit of edits) {
    if (edit?.uncertainOrigin !== undefined) return refused(raw, 'AMBIGUOUS_EDIT')
    if (!edit?.range || !isPromptTextBoundary(raw, edit.range.start) || !isPromptTextBoundary(raw, edit.range.end)
      || edit.range.start > edit.range.end || typeof edit.expectedText !== 'string' || typeof edit.text !== 'string') return refused(raw, 'INVALID_RANGE')
    if (raw.slice(edit.range.start, edit.range.end) !== edit.expectedText) return refused(raw, 'STALE_TEXT')
  }
  const ordered = [...edits].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].range
    const current = ordered[index].range
    if (current.start < previous.end || (current.start === previous.end && (previous.start === previous.end || current.start === current.end))) return refused(raw, 'OVERLAPPING_EDITS')
  }
  let text = raw
  for (const edit of ordered.reverse()) text = text.slice(0, edit.range.start) + edit.text + text.slice(edit.range.end)
  const finalDiagnostics = validatePromptSyntax(text)
  if (finalDiagnostics.length) return refused(raw, 'INVALID_SYNTAX', finalDiagnostics)
  return { ok: true, text, changed: text !== raw, diagnostics: [] }
}

export function editPromptBlockWeight(raw: string, index: number, operation: 'increase' | 'decrease' | 'numeric', value?: number): PromptEditResult {
  const syntax = validatePromptSyntax(raw)
  if (syntax.length) return refused(raw, 'INVALID_SYNTAX', syntax)
  const block = parsePromptDocument(raw).blocks[index]
  if (!Number.isInteger(index) || !block) return refused(raw, 'INVALID_BLOCK')
  if (!['increase', 'decrease', 'numeric'].includes(operation) || (operation === 'numeric' && (typeof value !== 'number' || !Number.isFinite(value)))) return refused(raw, 'INVALID_WEIGHT')
  const numeric = scanPromptSyntax(block.raw).numericWeights.find(group => group.range.start === 0 && group.range.end === block.raw.length)
  let text: string
  if (operation === 'numeric' || numeric) {
    let content = numeric ? block.raw.slice(numeric.contentRange.start, numeric.contentRange.end) : block.raw
    if (operation === 'numeric') while (hasWholeBracketWrapper(content)) content = content.slice(1, -1)
    const weight = operation === 'numeric' ? value! : Number((numeric!.value + (operation === 'increase' ? 0.05 : -0.05)).toFixed(12))
    if (!Number.isFinite(weight) || /e/i.test(String(weight))) return refused(raw, 'INVALID_WEIGHT')
    text = String(weight) + '::' + content + '::'
  } else {
    const opposite = operation === 'increase' ? '[' : '{'
    text = block.raw[0] === opposite && hasWholeBracketWrapper(block.raw) ? block.raw.slice(1, -1)
      : operation === 'increase' ? '{' + block.raw + '}' : '[' + block.raw + ']'
  }
  return applyPromptTextEdits(raw, [{ range: block.range, expectedText: block.raw, text }])
}
