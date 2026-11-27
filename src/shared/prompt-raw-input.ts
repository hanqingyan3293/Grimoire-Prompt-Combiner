import { isPromptTextBoundary, type PromptTextEdit } from './prompt-block-edit'
import type { TextRange } from './prompt-blocks'

/** Textarea values normalize CR/CRLF to LF. Map only the actual changed span back to raw so
 * typing in one line cannot rewrite every original line ending. Before-input selection, when
 * available, preserves the origin of insertions next to repeated text. */
export function promptTextInputEdit(raw: string, value: string, selection?: TextRange, inputType?: string): PromptTextEdit {
  const before = raw.replace(/\r\n?/g, '\n')
  const after = value.replace(/\r\n?/g, '\n')
  if (before === after) return { range: { start: raw.length, end: raw.length }, expectedText: '', text: '' }
  if (selection?.start === selection?.end && selection && before.length > after.length) {
    const deleted = before.length - after.length
    if (inputType?.endsWith('Backward')) selection = { start: selection.start - deleted, end: selection.end }
    else if (inputType?.endsWith('Forward')) selection = { start: selection.start, end: selection.end + deleted }
  }
  let start = 0; let endBefore = before.length; let endAfter = after.length
  const anchor = selection && selection.start <= selection.end && isPromptTextBoundary(before, selection.start) && isPromptTextBoundary(before, selection.end)
    && after.startsWith(before.slice(0, selection.start)) && after.endsWith(before.slice(selection.end))
    && selection.start + before.length - selection.end <= after.length
    ? selection : undefined
  const selected = anchor !== undefined
  if (anchor) { start = anchor.start; endBefore = anchor.end; endAfter = after.length - (before.length - anchor.end) }
  else {
    while (start < before.length && start < after.length && before[start] === after[start]) start++
    while (!isPromptTextBoundary(before, start) || !isPromptTextBoundary(after, start)) start--
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter-- }
    while (!isPromptTextBoundary(before, endBefore) || !isPromptTextBoundary(after, endAfter)) { endBefore++; endAfter++ }
  }
  const offsets: number[] = [0]
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '\r' && raw[index + 1] === '\n') index++
    offsets.push(index + 1)
  }
  const range = { start: offsets[start], end: offsets[endBefore] }
  const lineEnding = raw.includes('\r\n') ? '\r\n' : raw.includes('\r') ? '\r' : '\n'
  let suffix = 0
  if (!selected) while (suffix < before.length && suffix < after.length && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  let earliest = before.length - suffix - (endBefore - start)
  while (earliest >= 0 && (!isPromptTextBoundary(before, earliest) || !isPromptTextBoundary(after, earliest))) earliest++
  const uncertainOrigin = !selected && earliest >= 0 && earliest < start ? { start: offsets[earliest], end: range.end } : undefined
  return { range, expectedText: raw.slice(range.start, range.end), text: after.slice(start, endAfter).replace(/\n/g, lineEnding), ...(uncertainOrigin ? { uncertainOrigin } : {}) }
}
