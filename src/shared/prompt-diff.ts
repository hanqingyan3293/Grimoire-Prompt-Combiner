import { parsePromptDocument, type PromptBlock } from './prompt-blocks'

// Version diff (M6).
//
// Blocks are compared by content, not by position: adding a tag at the top should not report every
// later block as changed. A block that survives with a different weight is reported separately,
// because "same tag, stronger emphasis" is not the same edit as "tag replaced".
export interface PromptDiffEntry { readonly text: string; readonly weight?: string }

export interface PromptDiff {
  readonly added: PromptDiffEntry[]
  readonly removed: PromptDiffEntry[]
  readonly reweighted: Array<{ text: string; before: string; after: string }>
  readonly unchanged: number
  readonly summary: string
}

// Weight syntax is stripped before comparison: `{x}` → `{{x}}` is the SAME tag with more emphasis, and
// treating it as remove+add would drown the actually-new tags in noise.
function contentOf(raw: string): string {
  return raw
    .replace(/^[+-]?\d*\.?\d+::/, '')
    .replace(/::$/, '')
    .replace(/^\{+/, '')
    .replace(/\}+$/, '')
    .replace(/^\[+/, '')
    .replace(/\]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function keyOf(block: PromptBlock): string {
  // Whitespace and the surrounding comma live in `prefix`, so the comparison uses `raw` only.
  return block.type + '\u0000' + contentOf(block.raw)
}

function weightLabel(block: PromptBlock): string | undefined {
  if (!block.weight) return undefined
  // `increase`/`decrease` are brace/bracket weights, `numeric` is the `1.3::x::` form; the kind is kept
  // in the label so 1.3::x:: and {x} are not treated as the same edit.
  return block.weight.kind + ':' + block.weight.value
}

export function diffPromptVersions(before: string, after: string): PromptDiff {
  const left = parsePromptDocument(before).blocks
  const right = parsePromptDocument(after).blocks
  const leftMap = new Map<string, PromptBlock[]>()
  for (const block of left) {
    const key = keyOf(block)
    leftMap.set(key, [...(leftMap.get(key) ?? []), block])
  }
  const added: PromptDiffEntry[] = []
  const reweighted: Array<{ text: string; before: string; after: string }> = []
  let unchanged = 0
  for (const block of right) {
    const key = keyOf(block)
    const bucket = leftMap.get(key)
    if (!bucket || bucket.length === 0) {
      added.push({ text: block.raw, ...(weightLabel(block) ? { weight: weightLabel(block) } : {}) })
      continue
    }
    const match = bucket.shift() as PromptBlock
    const beforeWeight = weightLabel(match)
    const afterWeight = weightLabel(block)
    if (beforeWeight !== afterWeight) reweighted.push({ text: block.raw, before: beforeWeight ?? 'none', after: afterWeight ?? 'none' })
    else unchanged += 1
  }
  const removed: PromptDiffEntry[] = []
  for (const bucket of leftMap.values()) {
    for (const block of bucket) removed.push({ text: block.raw, ...(weightLabel(block) ? { weight: weightLabel(block) } : {}) })
  }
  const summary = '+' + added.length + ' / -' + removed.length + ' / ~' + reweighted.length + ' / =' + unchanged
  return { added, removed, reweighted, unchanged, summary }
}
