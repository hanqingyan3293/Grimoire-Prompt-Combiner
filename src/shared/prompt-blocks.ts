// Prompt block document model (M6.1).
//
// Behavioural parity target: NovelAI Prompt Studio 1.9.4 `promptDocument.ts` — block splitting,
// block classification, weight groups and random markers — reimplemented for Grimoire (no code
// copied; the thresholds below exist so the same text classifies the same way).
//
// The non-negotiable rule is fidelity: `serializePromptDocument(parsePromptDocument(text))`
// must return `text` byte-for-byte, including odd whitespace and trailing separators. Blocks
// therefore carry the exact text around them instead of reconstructing separators.

export type PromptBlockType = 'tags' | 'paragraph' | 'random'

export interface TextRange { readonly start: number; readonly end: number }

export interface PromptWeight {
  readonly kind: 'increase' | 'decrease' | 'numeric'
  readonly value: number
}

export interface RandomMarker {
  readonly pool: string
  readonly count: number
  readonly repeat: boolean
  readonly weight?: { readonly min: number; readonly max: number; readonly step: number }
}

export interface PromptBlock {
  readonly type: PromptBlockType
  /** Exact characters before the block content since the previous block ended (whitespace + comma). */
  readonly prefix: string
  /** Exact block content, trimmed of the surrounding whitespace that lives in `prefix`/`suffix`. */
  readonly raw: string
  readonly range: TextRange
  readonly weight?: PromptWeight
  readonly random?: RandomMarker
}

export interface PromptDocument {
  readonly source: string
  readonly blocks: readonly PromptBlock[]
  /** Whitespace after the final block, kept so the round trip is exact. */
  readonly trailing: string
}

export const PROMPT_BLOCK_LIMITS = Object.freeze({
  maxTagPhraseWords: 12,
  maxTagPhraseCharacters: 100,
  minSentenceClauseWords: 8,
  minParagraphHanCharacters: 16,
  minParagraphHanCharactersPerItem: 4,
  minParagraphFunctionWordItems: 3,
  minParagraphFunctionWordRatio: 0.3,
  minLongTagListItems: 20,
  maxLongTagListOutlierRatio: 0.1,
  minLongTagListAllowedOutliers: 1,
  maxLongTagListItemWords: 24,
  maxLongTagListFunctionWordRatio: 0.2,
})

const ENGLISH_FUNCTION_WORDS = /\b(?:a|an|the|she|he|her|his|him|they|them|their|it|its|i|my|we|our|you|your|is|are|was|were)\b/i
const SENTENCE_END = /[.!?。！？](?:["'”’)]|\s|$)/
const NUMERIC_WEIGHT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)::[\s\S]*?::$/

const hanCount = (text: string): number => (text.match(/\p{Script=Han}/gu) || []).length

/** Classify one block's content. Mirrors the reference's decision order on purpose so the same
 * prompt produces the same block types in both tools. */
export function classifyPromptBlock(content: string): PromptBlockType {
  const withoutWeights = content.replace(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)::[\s\S]*?::/g, 'weighted_group')
  const commaItems = withoutWeights.split(/[,，]+/).map(item => item.trim()).filter(Boolean)
  const han = hanCount(content)
  const functionWords = commaItems.filter(item => ENGLISH_FUNCTION_WORDS.test(item)).length
  if (
    commaItems.length >= PROMPT_BLOCK_LIMITS.minLongTagListItems &&
    commaItems.every(item => item.split(/\s+/).length <= PROMPT_BLOCK_LIMITS.maxLongTagListItemWords) &&
    han < PROMPT_BLOCK_LIMITS.minParagraphHanCharacters &&
    functionWords < commaItems.length * PROMPT_BLOCK_LIMITS.maxLongTagListFunctionWordRatio
  ) {
    const outliers = commaItems.filter(item => {
      const words = item.split(/\s+/).length
      return words > PROMPT_BLOCK_LIMITS.maxTagPhraseWords
        || item.length > PROMPT_BLOCK_LIMITS.maxTagPhraseCharacters
        || (SENTENCE_END.test(item) && words >= PROMPT_BLOCK_LIMITS.minSentenceClauseWords)
    }).length
    const allowed = Math.max(
      PROMPT_BLOCK_LIMITS.minLongTagListAllowedOutliers,
      Math.floor(commaItems.length * PROMPT_BLOCK_LIMITS.maxLongTagListOutlierRatio),
    )
    if (outliers <= allowed) return 'tags'
  }
  const hanItems = commaItems.map(item => hanCount(item)).filter(count => count > 0)
  if (
    (han >= PROMPT_BLOCK_LIMITS.minParagraphHanCharacters && hanItems.length > 0
      && hanItems.reduce((sum, count) => sum + count, 0) >= hanItems.length * PROMPT_BLOCK_LIMITS.minParagraphHanCharactersPerItem) ||
    (functionWords >= PROMPT_BLOCK_LIMITS.minParagraphFunctionWordItems
      && functionWords >= commaItems.length * PROMPT_BLOCK_LIMITS.minParagraphFunctionWordRatio)
  ) return 'paragraph'
  const phrases = withoutWeights.split(/[,，\r\n]+/).map(item => item.trim()).filter(Boolean)
  const hanClauses = withoutWeights.split(/[,，\r\n。！？!?]/)
  if (
    (/[。！？]/.test(withoutWeights) && han >= PROMPT_BLOCK_LIMITS.minParagraphHanCharacters) ||
    hanClauses.some(clause => hanCount(clause) >= PROMPT_BLOCK_LIMITS.minParagraphHanCharacters)
  ) return 'paragraph'
  if (phrases.some(phrase => SENTENCE_END.test(phrase) && phrase.split(/\s+/).length >= PROMPT_BLOCK_LIMITS.minSentenceClauseWords)) return 'paragraph'
  if (phrases.length && phrases.every(phrase => phrase.length <= PROMPT_BLOCK_LIMITS.maxTagPhraseCharacters && phrase.split(/\s+/).length <= PROMPT_BLOCK_LIMITS.maxTagPhraseWords)) return 'tags'
  return 'paragraph'
}

const POOL_NAME = /^[^_*~\r\n]+$/

export function parseRandomMarker(source: string): RandomMarker {
  const match = /^__([^_*~\r\n]+?)(?:\*(\d+)(r)?)?(?:~(\d*\.?\d+)-(\d*\.?\d+)(?:\/(\d*\.?\d+))?)?__$/.exec(source)
  if (!match) throw new Error('随机块格式不正确')
  const pool = match[1].trim()
  if (!pool || !POOL_NAME.test(pool)) throw new Error('随机池名称不能为空或包含 _ * ~ 换行')
  const count = Number(match[2] || 1)
  if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('随机块抽取数量必须为 1～16')
  const weight = match[4]
    ? { min: Number(match[4]), max: Number(match[5]), step: Number(match[6] || 0.05) }
    : undefined
  if (weight && (weight.min < 0.1 || weight.max > 3 || weight.min > weight.max || weight.step < 0.01 || weight.step > 1)) {
    throw new Error('随机权重范围为 0.1～3，步长为 0.01～1')
  }
  return { pool, count, repeat: !!match[3], ...(weight ? { weight } : {}) }
}

export function formatRandomMarker(marker: Partial<RandomMarker> & { pool: string }): string {
  const { pool, count = 1, repeat = false, weight } = marker
  const source = '__' + pool.trim()
    + (count !== 1 || repeat ? '*' + count + (repeat ? 'r' : '') : '')
    + (weight ? '~' + weight.min + '-' + weight.max + '/' + weight.step : '')
    + '__'
  parseRandomMarker(source)
  return source
}

/** Numeric weight group (`1.3::content::`) or brace/bracket weighting (`{x}` / `[x]`). */
export function promptWeightOf(raw: string): PromptWeight | undefined {
  const numeric = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))::[\s\S]*::$/.exec(raw)
  if (numeric) return { kind: 'numeric', value: Number(numeric[1]) }
  const increase = /^\{+[\s\S]*\}+$/.test(raw)
  const decrease = /^\[+[\s\S]*\]+$/.test(raw)
  if (increase) return { kind: 'increase', value: (raw.match(/^\{+/) || [''])[0].length * 0.05 }
  if (decrease) return { kind: 'decrease', value: (raw.match(/^\[+/) || [''])[0].length * 0.05 }
  return undefined
}

function topLevelCommas(source: string): number[] {
  const cuts: number[] = []
  let depth = 0
  let quote: string | null = null
  let numericOpen = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) { if (char === quote) quote = null; continue }
    if (char === '"' || char === "'" || char === '“' || char === '”') { quote = char === '“' ? '”' : char; continue }
    if (!numericOpen && char === ':' && source[index + 1] === ':') {
      const head = source.slice(cuts.length ? cuts[cuts.length - 1] + 1 : 0, index)
      if (/[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(head)) { numericOpen = true; index += 1; continue }
    }
    if (numericOpen) {
      if (char === ':' && source[index + 1] === ':') { numericOpen = false; index += 1 }
      continue
    }
    if (char === '{' || char === '[') { depth += 1; continue }
    if (char === '}' || char === ']') { if (depth > 0) depth -= 1; continue }
    if ((char === ',' || char === '，') && depth === 0) cuts.push(index)
  }
  return cuts
}

export function parsePromptDocument(source: string): PromptDocument {
  // Blocks are located by ranges on the ORIGINAL string; everything between them (commas,
  // odd whitespace, empty segments) is preserved as `prefix`/`trailing`, so the round trip is
  // exact by construction instead of by careful reconstruction.
  const cuts = topLevelCommas(source)
  const bounds: Array<[number, number]> = []
  let start = 0
  for (const cut of cuts) { bounds.push([start, cut]); start = cut + 1 }
  bounds.push([start, source.length])
  const blocks: PromptBlock[] = []
  let previousEnd = 0
  for (const [chunkStart, chunkEnd] of bounds) {
    const text = source.slice(chunkStart, chunkEnd)
    const leading = (text.match(/^\s*/) || [''])[0].length
    const trimmed = text.replace(/\s*$/, '')
    const contentStart = chunkStart + leading
    const contentEnd = chunkStart + trimmed.length
    if (!trimmed.slice(leading)) continue
    const raw = source.slice(contentStart, contentEnd)
    const type: PromptBlockType = /^__[\s\S]*__$/.test(raw) ? 'random' : classifyPromptBlock(raw)
    const random = type === 'random' ? safeMarker(raw) : undefined
    const weight = promptWeightOf(raw)
    blocks.push({
      type,
      prefix: source.slice(previousEnd, contentStart),
      raw,
      range: { start: contentStart, end: contentEnd },
      ...(weight ? { weight } : {}),
      ...(random ? { random } : {}),
    })
    previousEnd = contentEnd
  }
  return { source, blocks, trailing: source.slice(previousEnd) }
}
function safeMarker(raw: string): RandomMarker | undefined {
  try { return parseRandomMarker(raw) } catch { return undefined }
}

export function serializePromptDocument(document: PromptDocument): string {
  if (!document.blocks.length) return document.trailing
  return document.blocks.map(block => block.prefix + block.raw).join('') + document.trailing
}
