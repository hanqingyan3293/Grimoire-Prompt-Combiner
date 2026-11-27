import { applyPromptTextEdits, validatePromptSyntax, type PromptEditCode } from './prompt-block-edit'
import { hasWholeBracketWrapper, parsePromptDocument, parseRandomMarker, scanPromptSyntax, type PromptSyntaxDiagnostic, type TextRange } from './prompt-blocks'
import { encodeWorkspaceEditorState } from './workspace-editor-state'

export type NovelaiJsonValue = null | boolean | number | string | NovelaiJsonValue[] | NovelaiJsonObject
export interface NovelaiJsonObject { [key: string]: NovelaiJsonValue }
export type NovelaiTextTarget = 'primary' | 'negative' | { characterId: string; field: 'positive' | 'negative' }
export interface NovelaiCharacter { id: string; name: string; positive: string; negative: string }
export interface NovelaiBlockMeta { id: string; target: NovelaiTextTarget; range: TextRange; expectedText: string; name: string; ownLine: boolean }
export interface NovelaiRandomPool { id: string; name: string; options: string[] }
export interface NovelaiQuality { enabled: boolean; tokens: string[] }
export const NOVELAI_GENERATION_FIELDS = ['steps', 'cfg', 'seed', 'sampler', 'scheduler', 'width', 'height', 'model', 'checkpoint', 'loras'] as const
export type NovelaiGeneration = Record<typeof NOVELAI_GENERATION_FIELDS[number], string>
export interface NovelaiAssetInsertion {
  id: string; assetId: string; assetRevision: number; transactionId: string; kind: 'block' | 'character' | 'random-pool'
  target?: NovelaiTextTarget; range?: TextRange; expectedText?: string
}
export interface NovelaiProvenance { version: 1; insertions: NovelaiAssetInsertion[] }
export interface NovelaiDocument {
  version: 1
  primary: string
  negative: string
  characters: NovelaiCharacter[]
  blockMeta: NovelaiBlockMeta[]
  randomPools: NovelaiRandomPool[]
  quality: NovelaiQuality
  generation: NovelaiGeneration
  metadataUnknown: NovelaiJsonObject
  provenance: NovelaiProvenance
}

export interface NovelaiDocumentDiagnostic { readonly path: string; readonly message: string }
export type NovelaiDocumentCode = 'INVALID_DOCUMENT' | 'UNSUPPORTED_DOCUMENT_VERSION' | 'DOCUMENT_TOO_LARGE' | 'INVALID_JSON' | 'UNKNOWN_TEXT_TARGET' | 'INVALID_SYNTAX' | 'INVALID_QUALITY_TOKEN'
export type NovelaiDocumentValidation =
  | { readonly ok: true; readonly document: NovelaiDocument; readonly diagnostics: readonly NovelaiDocumentDiagnostic[] }
  | { readonly ok: false; readonly code: NovelaiDocumentCode; readonly diagnostics: readonly NovelaiDocumentDiagnostic[] }
export type NovelaiDocumentResult =
  | { readonly ok: true; readonly document: NovelaiDocument; readonly changed: boolean }
  | { readonly ok: false; readonly document: NovelaiDocument; readonly changed: false; readonly code: NovelaiDocumentCode; readonly diagnostics: readonly (NovelaiDocumentDiagnostic | PromptSyntaxDiagnostic)[] }

export class NovelaiDocumentError extends Error {
  constructor(readonly code: NovelaiDocumentCode, readonly diagnostics: readonly NovelaiDocumentDiagnostic[]) {
    super(code + ': ' + diagnostics.map(item => item.path + ' ' + item.message).join('; '))
    this.name = 'NovelaiDocumentError'
  }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
function invalid(path: string, message: string, code: NovelaiDocumentCode = 'INVALID_DOCUMENT'): never { throw new NovelaiDocumentError(code, [{ path, message }]) }

function validTarget(value: unknown, characters: readonly NovelaiCharacter[]): value is NovelaiTextTarget {
  return value === 'primary' || value === 'negative' || object(value) && typeof value.characterId === 'string'
    && (value.field === 'positive' || value.field === 'negative') && characters.some(character => character.id === value.characterId)
}
function validAnchor(value: Record<string, unknown>, path: string, characters: readonly NovelaiCharacter[]): void {
  if (!validTarget(value.target, characters)) invalid(path + '.target', '文本目标不存在')
  const range = value.range
  if (!object(range) || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || (range.start as number) < 0
    || (range.end as number) < (range.start as number) || typeof value.expectedText !== 'string' || value.expectedText.length !== (range.end as number) - (range.start as number)) invalid(path + '.range', '锚点需要UTF-16范围和对应expectedText')
  // Anchors are metadata, not another raw authority. Typing can make them stale; an editor must
  // match range + expectedText against the current target before using an anchor for a write.
}
function uniqueIds(items: readonly Record<string, unknown>[], path: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (!nonempty(item.id) || ids.has(item.id)) invalid(path + '.id', 'ID必须非空且唯一')
    ids.add(item.id)
  }
}
function validPools(value: unknown): asserts value is NovelaiRandomPool[] {
  if (!Array.isArray(value) || value.some(item => !object(item))) invalid('randomPools', '随机池必须是对象数组')
  uniqueIds(value, 'randomPools')
  const names = new Set<string>()
  for (const pool of value) {
    if (!nonempty(pool.name) || names.has(pool.name) || !Array.isArray(pool.options) || pool.options.some((option: unknown) => typeof option !== 'string')) invalid('randomPools', '名称必须唯一，选项必须是字符串数组')
    try { if (parseRandomMarker('__' + pool.name + '__').pool !== pool.name) invalid('randomPools.name', '名称不能带首尾空白') }
    catch { invalid('randomPools.name', '名称不符合随机块语法') }
    names.add(pool.name)
  }
}

/** Clone through the existing JSON/5MiB codec before inspecting a persisted or untrusted DTO.
 * Raw syntax is deliberately not a document-validity condition: incomplete typing is savable. */
export function validateNovelaiDocument(value: unknown): NovelaiDocumentValidation {
  try {
    if (!object(value)) invalid('', '文档必须是JSON对象')
    if (value.version !== 1) invalid('version', '只支持文档版本1', 'UNSUPPORTED_DOCUMENT_VERSION')
    let copy: Record<string, unknown>
    try { copy = JSON.parse(encodeWorkspaceEditorState(value)) }
    catch (error) { invalid('', String(error), String(error).includes('EDITOR_STATE_TOO_LARGE') ? 'DOCUMENT_TOO_LARGE' : 'INVALID_JSON') }
    const fields = ['version', 'primary', 'negative', 'characters', 'blockMeta', 'randomPools', 'quality', 'generation', 'metadataUnknown', 'provenance']
    if (Object.keys(copy!).some(key => !fields.includes(key))) invalid('', '未知文档字段应保存在metadataUnknown')
    if (typeof copy!.primary !== 'string' || typeof copy!.negative !== 'string') invalid('primary/negative', '原文必须是字符串')
    if (!Array.isArray(copy!.characters) || copy!.characters.some(character => !object(character)
      || Object.keys(character).some(key => !['id', 'name', 'positive', 'negative'].includes(key))
      || typeof character.name !== 'string' || typeof character.positive !== 'string' || typeof character.negative !== 'string')) invalid('characters', '角色需要ID、名称、正面和负面原文；扩展数据放入metadataUnknown')
    uniqueIds(copy!.characters as Record<string, unknown>[], 'characters')
    const characters = copy!.characters as NovelaiCharacter[]
    if (!Array.isArray(copy!.blockMeta) || copy!.blockMeta.some(meta => !object(meta) || typeof meta.name !== 'string' || typeof meta.ownLine !== 'boolean')) invalid('blockMeta', '块元数据需要名称和独立成行标记')
    uniqueIds(copy!.blockMeta as Record<string, unknown>[], 'blockMeta')
    for (const meta of copy!.blockMeta as Record<string, unknown>[]) validAnchor(meta, 'blockMeta', characters)
    validPools(copy!.randomPools)
    if (!object(copy!.quality) || typeof copy!.quality.enabled !== 'boolean' || !Array.isArray(copy!.quality.tokens) || copy!.quality.tokens.some(token => typeof token !== 'string')) invalid('quality', '质量设置需要开关和字符串词列表')
    if (!object(copy!.generation) || NOVELAI_GENERATION_FIELDS.some(key => typeof (copy!.generation as Record<string, unknown>)[key] !== 'string')
      || Object.keys(copy!.generation).some(key => !(NOVELAI_GENERATION_FIELDS as readonly string[]).includes(key))) invalid('generation', '全部已知参数必须保留为字符串，未知参数放入metadataUnknown')
    if (!object(copy!.metadataUnknown)) invalid('metadataUnknown', '未知元数据必须是JSON对象')
    if (!object(copy!.provenance) || copy!.provenance.version !== 1) invalid('provenance.version', '只支持素材插入元数据版本1', 'UNSUPPORTED_DOCUMENT_VERSION')
    if (!Array.isArray(copy!.provenance.insertions) || copy!.provenance.insertions.some(item => !object(item) || !nonempty(item.assetId) || !nonempty(item.transactionId)
      || !Number.isSafeInteger(item.assetRevision) || (item.assetRevision as number) < 0 || !['block', 'character', 'random-pool'].includes(item.kind as string))) invalid('provenance.insertions', '素材插入记录格式不正确')
    uniqueIds(copy!.provenance.insertions, 'provenance.insertions')
    for (const item of copy!.provenance.insertions) if (item.target !== undefined || item.range !== undefined || item.expectedText !== undefined) validAnchor(item, 'provenance.insertions', characters)
    return { ok: true, document: copy! as unknown as NovelaiDocument, diagnostics: [] }
  } catch (error) {
    if (error instanceof NovelaiDocumentError) return { ok: false, code: error.code, diagnostics: error.diagnostics }
    return { ok: false, code: 'INVALID_DOCUMENT', diagnostics: [{ path: '', message: String(error) }] }
  }
}

export function cloneNovelaiDocument(document: NovelaiDocument): NovelaiDocument {
  const result = validateNovelaiDocument(document)
  if (!result.ok) throw new NovelaiDocumentError(result.code, result.diagnostics)
  return result.document
}
export type NovelaiDocumentInitial = Omit<Partial<NovelaiDocument>, 'generation'> & { generation?: Partial<NovelaiGeneration> }
export function createNovelaiDocument(initial: NovelaiDocumentInitial = {}): NovelaiDocument {
  if (!object(initial) || initial.generation !== undefined && !object(initial.generation)) invalid('', '初始文档和参数必须是对象')
  const generation = Object.fromEntries(NOVELAI_GENERATION_FIELDS.map(key => [key, ''])) as NovelaiGeneration
  return cloneNovelaiDocument({
    version: 1, primary: '', negative: '', characters: [], blockMeta: [], randomPools: [],
    quality: { enabled: false, tokens: [] }, metadataUnknown: {}, provenance: { version: 1, insertions: [] },
    ...initial, generation: { ...generation, ...initial.generation },
  })
}

export interface LegacyNovelaiDraft { draft?: string; metadata?: Partial<NovelaiGeneration> & { negativePrompt?: string; unknown?: NovelaiJsonObject } }
export function migrateLegacyNovelaiDraft(legacy: LegacyNovelaiDraft): NovelaiDocument {
  const generation: Partial<NovelaiGeneration> = {}
  for (const field of NOVELAI_GENERATION_FIELDS) if (legacy.metadata?.[field] !== undefined) generation[field] = legacy.metadata[field]
  return createNovelaiDocument({ primary: legacy.draft === undefined ? '' : legacy.draft, negative: legacy.metadata?.negativePrompt === undefined ? '' : legacy.metadata.negativePrompt, generation, metadataUnknown: legacy.metadata?.unknown === undefined ? {} : legacy.metadata.unknown })
}

export function getNovelaiDocumentText(document: NovelaiDocument, target: NovelaiTextTarget): string | undefined {
  if (target === 'primary' || target === 'negative') return document[target]
  if (target.field !== 'positive' && target.field !== 'negative') return undefined
  return document.characters.find(character => character.id === target.characterId)?.[target.field]
}
const refused = (document: NovelaiDocument, code: NovelaiDocumentCode, diagnostics: readonly (NovelaiDocumentDiagnostic | PromptSyntaxDiagnostic)[] = []): NovelaiDocumentResult => ({ ok: false, document, changed: false, code, diagnostics })
export function setNovelaiDocumentText(document: NovelaiDocument, target: NovelaiTextTarget, text: string, options: { guarded?: boolean } = {}): NovelaiDocumentResult {
  const checked = validateNovelaiDocument(document)
  if (!checked.ok) return refused(document, checked.code, checked.diagnostics)
  const before = getNovelaiDocumentText(document, target)
  if (before === undefined) return refused(document, 'UNKNOWN_TEXT_TARGET')
  if (typeof text !== 'string') return refused(document, 'INVALID_DOCUMENT')
  if (options.guarded) {
    const diagnostics = [...validatePromptSyntax(before), ...validatePromptSyntax(text)]
    if (diagnostics.length) return refused(document, 'INVALID_SYNTAX', diagnostics)
  }
  if (before === text) return { ok: true, document, changed: false }
  const next = checked.document
  if (target === 'primary' || target === 'negative') next[target] = text
  else next.characters.find(character => character.id === target.characterId)![target.field] = text
  const final = validateNovelaiDocument(next)
  return final.ok ? { ok: true, document: final.document, changed: true } : refused(document, final.code, final.diagnostics)
}

function qualityKey(raw: string): string {
  let content = raw.trim()
  const numeric = scanPromptSyntax(content).numericWeights.find(group => group.range.start === 0 && group.range.end === content.length)
  if (numeric) content = content.slice(numeric.contentRange.start, numeric.contentRange.end).trim()
  while (hasWholeBracketWrapper(content)) content = content.slice(1, -1).trim()
  return content.replace(/\s+/g, ' ').toLowerCase()
}
export function appendNovelaiQualityTokens(document: NovelaiDocument, target: NovelaiTextTarget = 'primary'): NovelaiDocumentResult {
  const checked = validateNovelaiDocument(document)
  if (!checked.ok) return refused(document, checked.code, checked.diagnostics)
  const raw = getNovelaiDocumentText(document, target)
  if (raw === undefined) return refused(document, 'UNKNOWN_TEXT_TARGET')
  if (!document.quality.enabled) return { ok: true, document, changed: false }
  const commas = scanPromptSyntax(raw).commas
  const seen = new Set([0, ...commas.map(position => position + 1)].map((start, index) => qualityKey(raw.slice(start, commas[index] ?? raw.length))))
  const missing: string[] = []
  for (const token of document.quality.tokens) {
    const syntax = scanPromptSyntax(token)
    if (!token.trim() || syntax.diagnostics.length || syntax.randomMarkers.length || parsePromptDocument(token).blocks.length !== 1) return refused(document, 'INVALID_QUALITY_TOKEN', syntax.diagnostics)
    const key = qualityKey(token)
    if (!seen.has(key)) { missing.push(token); seen.add(key) }
  }
  const separator = !raw.trim() || /[,，]\s*$/.test(raw) ? '' : ', '
  const result = applyPromptTextEdits(raw, missing.length ? [{ range: { start: raw.length, end: raw.length }, expectedText: '', text: separator + missing.join(', ') }] : [])
  if (!result.ok) return refused(document, 'INVALID_SYNTAX', result.diagnostics)
  return setNovelaiDocumentText(document, target, result.text)
}

export interface NovelaiRandomSelection { readonly range: TextRange; readonly poolId: string; readonly optionIndex: number; readonly text: string }
export type NovelaiSamplingCode = PromptEditCode | 'INVALID_SEED' | 'INVALID_RANDOM_POOLS' | 'UNKNOWN_RANDOM_POOL' | 'EMPTY_RANDOM_POOL' | 'UNSUPPORTED_RANDOM_MARKER' | 'UNSUPPORTED_RANDOM_OPTION'
export type NovelaiSamplingResult =
  | { readonly ok: true; readonly text: string; readonly changed: boolean; readonly selections: readonly NovelaiRandomSelection[] }
  | { readonly ok: false; readonly text: string; readonly changed: false; readonly code: NovelaiSamplingCode; readonly diagnostics: readonly PromptSyntaxDiagnostic[] }
export function sampleNovelaiRandomPools(raw: string, pools: readonly { id: string; name: string; options: readonly string[] }[], seed: string | number): NovelaiSamplingResult {
  const fail = (code: NovelaiSamplingCode, diagnostics: readonly PromptSyntaxDiagnostic[] = []): NovelaiSamplingResult => ({ ok: false, text: raw, changed: false, code, diagnostics })
  const syntax = scanPromptSyntax(raw)
  if (syntax.diagnostics.length) return fail('INVALID_SYNTAX', syntax.diagnostics)
  if (typeof seed !== 'string' && typeof seed !== 'number' || typeof seed === 'number' && !Number.isFinite(seed) || typeof seed === 'string' && !seed.length) return fail('INVALID_SEED')
  try { encodeWorkspaceEditorState(pools); validPools(pools) } catch { return fail('INVALID_RANDOM_POOLS') }
  const byName = new Map(pools.map(pool => [pool.name, pool]))
  for (const occurrence of syntax.randomMarkers) {
    const marker = occurrence.marker!
    if (marker.count !== 1 || marker.repeat || marker.weight) return fail('UNSUPPORTED_RANDOM_MARKER')
    const pool = byName.get(marker.pool)
    if (!pool) return fail('UNKNOWN_RANDOM_POOL')
    if (!pool.options.length || pool.options.some(option => !option.trim())) return fail('EMPTY_RANDOM_POOL')
    if (pool.options.some(option => { const scan = scanPromptSyntax(option); return scan.diagnostics.length || scan.randomMarkers.length })) return fail('UNSUPPORTED_RANDOM_OPTION')
  }
  let random = 2166136261
  for (const char of String(seed)) random = Math.imul(random ^ char.charCodeAt(0), 16777619) >>> 0
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296 }
  const selections = syntax.randomMarkers.map(occurrence => {
    const pool = byName.get(occurrence.marker!.pool)!
    const optionIndex = Math.floor(next() * pool.options.length)
    return { range: occurrence.range, poolId: pool.id, optionIndex, text: pool.options[optionIndex] }
  })
  const result = applyPromptTextEdits(raw, selections.map((selection, index) => ({ range: selection.range, expectedText: syntax.randomMarkers[index].raw, text: selection.text })))
  return result.ok ? { ok: true, text: result.text, changed: result.changed, selections } : fail(result.code, result.diagnostics)
}
