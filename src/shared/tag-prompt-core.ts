// 魔导书 Grimoire v7 — 提示词解析/序列化核心（渲染器与主进程共用）
// Weight algorithm ported from BooruDatasetTagManager `PromptParser.cs` (MIT,
// copyright (c) 2024 starik222): round brackets scale by 1.1 per level, square
// brackets divide by 1.1 per level, an explicit `(tag:1.3)` weight replaces the
// inner value (outer brackets still scale it), `BREAK` separates segments, and
// duplicate names merge by summing weight deltas. Values clamp to the Grimoire
// [0.1, 2.0] range shared with prompts.store.
//
// `serializePrompt` must stay byte-identical to the historical prompts.store
// `getFullPrompt` output: bare name at weight 1, `(name:weight)` otherwise,
// ", " joined, "--neg " prefix for the negative segment, "\n" between segments.

export interface PromptToken {
  /** Tag text without decorators. */
  text: string
  /** Effective weight after brackets/explicit/merge, clamped to [0.1, 2.0], 2 decimals. */
  weight: number
  /** Signed bracket depth: positive = round brackets, negative = square brackets. */
  depth: number
  /** True when the token appeared after a `--neg` marker. */
  negative: boolean
  /** True when the token carried an explicit `(tag:w)` weight. */
  explicit: boolean
  /** True when a `BREAK` separator preceded this token. */
  breakBefore: boolean
}

export const PROMPT_BRACKET_STEP = 1.1
export const PROMPT_WEIGHT_MIN = 0.1
export const PROMPT_WEIGHT_MAX = 2.0

export function clampPromptWeight(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(PROMPT_WEIGHT_MAX, Math.max(PROMPT_WEIGHT_MIN, Math.round(value * 100) / 100))
}

export function formatPromptWeight(weight: number): string {
  return String(Math.round(weight * 100) / 100)
}

export function bracketStep(weight: number, direction: 1 | -1): number {
  const next = direction === 1 ? weight * PROMPT_BRACKET_STEP : weight / PROMPT_BRACKET_STEP
  return clampPromptWeight(next)
}

export interface DecomposedPromptPart {
  text: string
  depth: number
  /** Effective weight after bracket and explicit handling, clamped to [0.1, 2.0]. */
  weight: number
  /** True when the part carried an explicit `(tag:w)` weight. */
  explicit: boolean
}

export function decomposePromptPart(raw: string): DecomposedPromptPart | null {
  let work = raw.trim()
  if (!work) return null
  let explicitValue: number | null = null
  let depth = 0
  for (let guard = 0; guard < 64; guard++) {
    if (explicitValue === null) {
      const match = work.match(/^\((.+):(\d+(?:\.\d+)?)\)$/)
      if (match) {
        explicitValue = Number(match[2])
        work = match[1].trim()
        if (!work) return null
        continue
      }
    }
    if (work.length >= 2 && work.startsWith('(') && work.endsWith(')')) {
      depth += 1
      work = work.slice(1, -1).trim()
      if (!work) return null
      continue
    }
    if (work.length >= 2 && work.startsWith('[') && work.endsWith(']')) {
      depth -= 1
      work = work.slice(1, -1).trim()
      if (!work) return null
      continue
    }
    break
  }
  if (!work) return null
  const multiplier = Math.pow(PROMPT_BRACKET_STEP, depth)
  const weight = clampPromptWeight(explicitValue !== null ? explicitValue * multiplier : multiplier)
  return { text: work, depth, weight, explicit: explicitValue !== null }
}

export function parsePromptText(text: string): { tokens: PromptToken[] } {
  const tokens: PromptToken[] = []
  let negative = false
  let pendingBreak = false
  for (const rawPart of String(text ?? '').replace(/\r/g, '').split(/[,\n]/)) {
    let part = rawPart.trim()
    if (!part) continue
    if (part === '--neg') {
      negative = true
      continue
    }
    if (part.startsWith('--neg ')) {
      negative = true
      part = part.slice(6).trim()
      if (!part) continue
    }
    if (part.toUpperCase() === 'BREAK') {
      pendingBreak = true
      continue
    }
    const decomposed = decomposePromptPart(part)
    if (!decomposed) continue
    tokens.push({
      text: decomposed.text,
      weight: decomposed.weight,
      depth: decomposed.depth,
      negative,
      explicit: decomposed.explicit,
      breakBefore: pendingBreak,
    })
    pendingBreak = false
  }
  return { tokens }
}

/**
 * Merges tokens with the same (case-insensitive) name inside the same polarity.
 * Weights combine by summing their deltas from 1 (`1 + Σ(w − 1)`), matching the
 * BDTM duplicate-merge intent and A1111 additive-attention behavior; the result
 * clamps to [0.1, 2.0].
 */
export function mergeDuplicates(tokens: PromptToken[]): PromptToken[] {
  const merged: PromptToken[] = []
  const index = new Map<string, number>()
  for (const token of tokens) {
    const key = (token.negative ? 'n:' : 'p:') + token.text.trim().toLowerCase()
    const existing = index.get(key)
    if (existing === undefined) {
      index.set(key, merged.length)
      merged.push({ ...token })
      continue
    }
    const target = merged[existing]
    target.weight = clampPromptWeight(target.weight + token.weight - 1)
    target.explicit = true
    target.depth = 0
    target.breakBefore = target.breakBefore || token.breakBefore
  }
  return merged
}

export function serializePrompt(tokens: PromptToken[], nameOf: (token: PromptToken) => string): string {
  const render = (list: PromptToken[]) =>
    list
      .map(token => {
        const name = nameOf(token)
        const base = token.weight === 1 ? name : `(${name}:${formatPromptWeight(token.weight)})`
        return token.breakBefore ? `BREAK, ${base}` : base
      })
      .join(', ')
  const positive = tokens.filter(token => !token.negative)
  const negative = tokens.filter(token => token.negative)
  let result = positive.length ? render(positive) : ''
  if (negative.length) {
    if (result) result += '\n'
    result += '--neg ' + render(negative)
  }
  return result
}