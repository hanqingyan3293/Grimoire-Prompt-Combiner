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

export interface PromptSyntaxDiagnostic {
  readonly code: 'MISMATCHED_BRACKET' | 'UNCLOSED_BRACKET' | 'UNCLOSED_QUOTE' | 'INVALID_NUMERIC_WEIGHT' | 'UNCLOSED_NUMERIC_WEIGHT' | 'INVALID_RANDOM_MARKER' | 'DANGLING_ESCAPE' | 'INVALID_UNICODE'
  readonly range: TextRange
  readonly message: string
}

export interface ScannedRandomMarker { readonly range: TextRange; readonly raw: string; readonly marker?: RandomMarker }
export interface ScannedNumericWeight { readonly range: TextRange; readonly contentRange: TextRange; readonly value: number }
export interface PromptSyntaxScan {
  readonly commas: readonly number[]
  readonly diagnostics: readonly PromptSyntaxDiagnostic[]
  readonly randomMarkers: readonly ScannedRandomMarker[]
  readonly numericWeights: readonly ScannedNumericWeight[]
}

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
const SENTENCE_FINAL = /[.!?。！？]["'”’)]*$/

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
  const syntax = scanPromptSyntax(raw)
  if (syntax.diagnostics.length) return undefined
  const numeric = syntax.numericWeights.find(group => group.range.start === 0 && group.range.end === raw.length)
  if (numeric) return { kind: 'numeric', value: numeric.value }
  const kind = raw[0] === '{' ? 'increase' : raw[0] === '[' ? 'decrease' : undefined
  if (!kind) return undefined
  let content = raw
  let depth = 0
  while (content[0] === raw[0] && hasWholeBracketWrapper(content)) {
    depth += 1
    content = content.slice(1, -1).trim()
  }
  if (depth) return { kind, value: depth * 0.05 }
  return undefined
}

function isWordApostrophe(source: string, index: number): boolean {
  return (source[index] === "'" || source[index] === '’')
    && /[\p{L}\p{N}_]/u.test(source[index - 1] || '')
    && /[\p{L}\p{N}_]/u.test(source[index + 1] || '')
}

function quoteCloser(source: string, index: number): string | null {
  if (isWordApostrophe(source, index)) return null
  const char = source[index]
  if (char === '"' || char === "'") return char
  if (char === '“') return '”'
  if (char === '‘') return '’'
  return null
}

function escapedMarkerEnd(source: string, index: number): number {
  if (source.slice(index + 1, index + 3) !== '__') return index + 1
  const end = source.indexOf('__', index + 3)
  return end < 0 ? index + 1 : end + 1
}

export function hasWholeBracketWrapper(raw: string): boolean {
  if (raw[0] !== '{' && raw[0] !== '[') return false
  const stack: string[] = []
  let quote: string | null = null
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === '\\') { index = escapedMarkerEnd(raw, index); continue }
    if (quote) { if (char === quote && !isWordApostrophe(raw, index)) quote = null; continue }
    if (char === '_' && raw[index + 1] === '_') {
      const end = raw.indexOf('__', index + 2)
      if (end < 0) return false
      index = end + 1
      continue
    }
    quote = quoteCloser(raw, index)
    if (quote) continue
    if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']')
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char || (!stack.length && index !== raw.length - 1)) return false
    }
  }
  return stack.length === 0 && quote === null
}

/** One tolerant scan supplies both parser cuts and guarded-edit diagnostics. In particular,
 * pool names and quoted text are atoms, so their punctuation never enters the weight grammar. */
export function scanPromptSyntax(source: string): PromptSyntaxScan {
  const cuts: number[] = []
  const diagnostics: PromptSyntaxDiagnostic[] = []
  const randomMarkers: ScannedRandomMarker[] = []
  const numericWeights: ScannedNumericWeight[] = []
  const brackets: Array<{ close: string; start: number }> = []
  let quote: string | null = null
  let quoteStart = 0
  let numeric: { start: number; contentStart: number; depth: number; value: number } | null = null
  const diagnose = (code: PromptSyntaxDiagnostic['code'], start: number, end: number, message: string) => {
    diagnostics.push({ code, range: { start, end }, message })
  }
  // Unicode validity applies inside every atom, including literal/escaped marker text.
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index)
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = source.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) index += 1
      else diagnose('INVALID_UNICODE', index, index + 1, 'UTF-16代理对不完整')
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) diagnose('INVALID_UNICODE', index, index + 1, 'UTF-16代理对不完整')
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      if (index + 1 === source.length) diagnose('DANGLING_ESCAPE', index, index + 1, '转义符后缺少字符')
      index = escapedMarkerEnd(source, index)
      continue
    }
    if (quote) { if (char === quote && !isWordApostrophe(source, index)) quote = null; continue }
    if (char === '_' && source[index + 1] === '_') {
      const end = source.indexOf('__', index + 2)
      const raw = source.slice(index, end < 0 ? source.length : end + 2)
      let marker: RandomMarker | undefined
      try { marker = parseRandomMarker(raw) } catch { diagnose('INVALID_RANDOM_MARKER', index, index + raw.length, '随机块格式不正确') }
      randomMarkers.push({ range: { start: index, end: index + raw.length }, raw, ...(marker ? { marker } : {}) })
      index = end < 0 ? source.length : end + 1
      continue
    }
    quote = quoteCloser(source, index)
    if (quote) { quoteStart = index; continue }
    if ((char === '”' || char === '’') && !isWordApostrophe(source, index)) {
      diagnose('UNCLOSED_QUOTE', index, index + 1, '引号没有对应的起始符')
      continue
    }
    if (char === ':' && source[index + 1] === ':') {
      if (numeric) {
        if (brackets.length !== numeric.depth || !source.slice(numeric.contentStart, index).trim()) {
          diagnose('INVALID_NUMERIC_WEIGHT', numeric.start, index + 2, '数字权重内容为空或括号跨越权重边界')
        }
        numericWeights.push({ range: { start: numeric.start, end: index + 2 }, contentRange: { start: numeric.contentStart, end: index }, value: numeric.value })
        numeric = null
      } else {
        let start = index
        while (start > 0 && /[\d.+-]/.test(source[start - 1])) start -= 1
        const head = source.slice(start, index)
        const boundary = source[start - 1] || ''
        const value = Number(head)
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(head) || /[\p{L}\p{N}_:.]/u.test(boundary) || !Number.isFinite(value)) {
          diagnose('INVALID_NUMERIC_WEIGHT', start, index + 2, '数字权重必须是独立的有限十进制数')
        } else numeric = { start, contentStart: index + 2, depth: brackets.length, value }
      }
      index += 1
      continue
    }
    if (char === '{' || char === '[' || char === '(') { brackets.push({ close: char === '{' ? '}' : char === '[' ? ']' : ')', start: index }); continue }
    if (char === '}' || char === ']' || char === ')') {
      if (brackets.pop()?.close !== char) diagnose('MISMATCHED_BRACKET', index, index + 1, '括号不匹配')
      continue
    }
    if ((char === ',' || char === '，') && brackets.length === 0 && !numeric) cuts.push(index)
  }
  if (quote) diagnose('UNCLOSED_QUOTE', quoteStart, source.length, '引号未闭合')
  for (const bracket of brackets) diagnose('UNCLOSED_BRACKET', bracket.start, source.length, '括号未闭合')
  if (numeric) diagnose('UNCLOSED_NUMERIC_WEIGHT', numeric.start, source.length, '数字权重缺少结束::')
  return { commas: cuts, diagnostics, randomMarkers, numericWeights }
}

export function parsePromptDocument(source: string): PromptDocument {
  // Blocks are located by ranges on the ORIGINAL string; everything between them (commas,
  // odd whitespace, empty segments) is preserved as `prefix`/`trailing`, so the round trip is
  // exact by construction instead of by careful reconstruction.
  const cuts = scanPromptSyntax(source).commas
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
  return { source, blocks: mergeParagraphClauses(source, blocks), trailing: source.slice(previousEnd) }
}

/** Commas inside prose separate clauses, not tag blocks. Derive the classification from the
 * complete original range; weights, random pools and line boundaries remain independent. */
function mergeParagraphClauses(source: string, blocks: readonly PromptBlock[]): PromptBlock[] {
  const merged: PromptBlock[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const first = blocks[index]
    const proseStart = first.type === 'paragraph' || /^\p{Script=Han}/u.test(first.raw)
      || (/^[a-z]/i.test(first.raw) && first.raw.split(/\s+/).length >= 3 && ENGLISH_FUNCTION_WORDS.test(first.raw))
    if (!proseStart || first.weight || first.type === 'random' || SENTENCE_FINAL.test(first.raw)) { merged.push(first); continue }
    let last = index
    while (last + 1 < blocks.length) {
      const next = blocks[last + 1]
      if (next.type === 'random' || next.weight || /[\r\n]/.test(next.prefix)) break
      last += 1
      if (SENTENCE_FINAL.test(next.raw)) break
    }
    const raw = source.slice(first.range.start, blocks[last].range.end)
    if (last > index && classifyPromptBlock(raw) === 'paragraph') {
      merged.push({ type: 'paragraph', prefix: first.prefix, raw, range: { start: first.range.start, end: blocks[last].range.end } })
      index = last
    } else merged.push(first)
  }
  return merged
}
function safeMarker(raw: string): RandomMarker | undefined {
  try { return parseRandomMarker(raw) } catch { return undefined }
}

export function serializePromptDocument(document: PromptDocument): string {
  if (!document.blocks.length) return document.trailing
  return document.blocks.map(block => block.prefix + block.raw).join('') + document.trailing
}
