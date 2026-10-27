// 魔导书 Grimoire — 图片生成元数据解析（SD Image Sorter 解析规则的 TS 移植，PARTIAL_EXTRACTION）
// 纯函数、零外部依赖（仅 node:zlib）；解析不到的字段统一用 '' / null / [] 填充。

import zlib from 'node:zlib'

export interface ParsedGenerationMetadata {
  origin: '' | 'webui' | 'novelai' | 'comfyui-embedded' | 'comfyui-grimoire' | 'api-grimoire'
  prompt: string
  negativePrompt: string
  checkpoint: string
  loras: string[]
  seed: number | null
  sampler: string
  scheduler: string
  steps: number | null
  cfg: number | null
  width: number | null
  height: number | null
  modelHash: string
  raw: Record<string, unknown>
}

const MAX_RAW_CHARS = 200_000
const MAX_INFLATE_BYTES = 64 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }

function emptyMetadata(origin: ParsedGenerationMetadata['origin']): ParsedGenerationMetadata {
  return { origin, prompt: '', negativePrompt: '', checkpoint: '', loras: [], seed: null, sampler: '', scheduler: '', steps: null, cfg: null, width: null, height: null, modelHash: '', raw: {} }
}

function truncateRaw(value: string): string {
  return value.length > MAX_RAW_CHARS ? value.slice(0, MAX_RAW_CHARS) : value
}

// 超过上限时退化为截断的原文预览，避免 raw 字段无限膨胀
function capRawValue(source: string, value: unknown): unknown {
  return source.length <= MAX_RAW_CHARS ? value : truncateRaw(source)
}

// tEXt/zTXt 规范为 Latin-1，但大量工具（含 A1111）写入 UTF-8：先按 UTF-8 解码，出现替换符再回退
function decodeText(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8')
  return utf8.includes('�') ? bytes.toString('latin1') : utf8
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

// ---------- PNG 文本块 ----------

function splitKeyword(data: Buffer): { keyword: string; rest: Buffer } | null {
  const nul = data.indexOf(0)
  if (nul <= 0 || nul > 79) return null
  return { keyword: data.toString('latin1', 0, nul), rest: data.subarray(nul + 1) }
}

function inflateText(bytes: Buffer): Buffer | null {
  try { return zlib.inflateSync(bytes, { maxOutputLength: MAX_INFLATE_BYTES }) } catch { return null }
}

function parseITxtChunk(data: Buffer): { keyword: string; text: string } | null {
  const entry = splitKeyword(data)
  if (!entry || entry.rest.length < 2) return null
  const compressed = entry.rest[0] === 1
  const languageEnd = entry.rest.indexOf(0, 2)
  if (languageEnd < 0) return null
  const translatedEnd = entry.rest.indexOf(0, languageEnd + 1)
  if (translatedEnd < 0) return null
  const textBytes = entry.rest.subarray(translatedEnd + 1)
  const bytes = compressed ? inflateText(textBytes) : textBytes
  if (!bytes) return null
  return { keyword: entry.keyword, text: bytes.toString('utf8') }
}

/** 依次读取 PNG 中的 tEXt / iTXt / zTXt 文本块（不校验 CRC，块损坏时跳过并继续） */
export function readPngTextChunks(buffer: Buffer): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return result
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IEND') break
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) break
    const data = buffer.subarray(dataStart, dataEnd)
    try {
      if (type === 'tEXt') {
        const entry = splitKeyword(data)
        if (entry) result[entry.keyword] = decodeText(entry.rest)
      } else if (type === 'zTXt') {
        const entry = splitKeyword(data)
        // rest = [压缩方法 1 字节][zlib 数据]
        if (entry && entry.rest.length >= 1 && entry.rest[0] === 0) {
          const inflated = inflateText(entry.rest.subarray(1))
          if (inflated) result[entry.keyword] = decodeText(inflated)
        }
      } else if (type === 'iTXt') {
        const parsed = parseITxtChunk(data)
        if (parsed) result[parsed.keyword] = parsed.text
      }
    } catch { /* 单个文本块损坏时忽略 */ }
    offset = dataEnd + 4
  }
  return result
}

// ---------- JPEG EXIF UserComment ----------

interface TiffEntry { type: number; count: number; valueField: number }

function readTiffEntry(tiff: Buffer, ifdOffset: number, little: boolean, tag: number): TiffEntry | null {
  try {
    if (ifdOffset <= 0 || ifdOffset + 2 > tiff.length) return null
    const count = little ? tiff.readUInt16LE(ifdOffset) : tiff.readUInt16BE(ifdOffset)
    for (let index = 0; index < count; index++) {
      const base = ifdOffset + 2 + index * 12
      if (base + 12 > tiff.length) return null
      const current = little ? tiff.readUInt16LE(base) : tiff.readUInt16BE(base)
      if (current !== tag) continue
      return {
        type: little ? tiff.readUInt16LE(base + 2) : tiff.readUInt16BE(base + 2),
        count: little ? tiff.readUInt32LE(base + 4) : tiff.readUInt32BE(base + 4),
        valueField: base + 8,
      }
    }
    return null
  } catch { return null }
}

function readTiffBytes(tiff: Buffer, entry: TiffEntry | null, little: boolean): Buffer | null {
  if (!entry) return null
  const unit = TIFF_TYPE_SIZES[entry.type] ?? 1
  const total = entry.count * unit
  if (total <= 0 || !Number.isFinite(total)) return null
  if (total <= 4) return tiff.subarray(entry.valueField, entry.valueField + total)
  try {
    const offset = little ? tiff.readUInt32LE(entry.valueField) : tiff.readUInt32BE(entry.valueField)
    if (offset < 0 || offset + total > tiff.length) return null
    return tiff.subarray(offset, offset + total)
  } catch { return null }
}

function decodeUtf16(bytes: Buffer, tiffLittle: boolean): string {
  let start = 0
  let little = tiffLittle
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { little = true; start = 2 } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { little = false; start = 2 } else if (bytes.length >= 2) {
    // 无 BOM：按 NUL 分布猜字节序（ASCII 文本在 LE 下高位字节位于索引 1；piexif 固定写 utf-16-be）
    if (bytes[0] === 0 && bytes[1] !== 0) little = false
    else if (bytes[0] !== 0 && bytes[1] === 0) little = true
  }
  const end = start + ((bytes.length - start) & ~1)
  const body = bytes.subarray(start, end)
  if (little) return body.toString('utf16le')
  const swapped = Buffer.from(body)
  swapped.swap16()
  return swapped.toString('utf16le')
}

function decodeUserComment(bytes: Buffer, tiffLittle: boolean): string {
  const prefix = bytes.subarray(0, 8).toString('latin1')
  if (prefix.startsWith('ASCII')) return decodeText(bytes.subarray(8))
  if (prefix.startsWith('UNICODE')) return decodeUtf16(bytes.subarray(8), tiffLittle).replace(/\u0000+$/, '')
  if (prefix.startsWith('JIS')) return decodeText(bytes.subarray(8))
  // 无字符集前缀：尽力按 UTF-8/Latin-1 解码
  return decodeText(bytes).replace(/\u0000+$/, '')
}

function readExifUserComment(tiff: Buffer): string | null {
  try {
    const order = tiff.toString('latin1', 0, 2)
    const little = order === 'II'
    if (!little && order !== 'MM') return null
    const magic = little ? tiff.readUInt16LE(2) : tiff.readUInt16BE(2)
    if (magic !== 42) return null
    const ifd0Offset = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4)
    // IFD0 → ExifIFD(0x8769) → UserComment(0x9286)，ExifIFD 缺失时回退到 IFD0 本体
    const exifPointer = readTiffEntry(tiff, ifd0Offset, little, 0x8769)
    let bytes: Buffer | null = null
    if (exifPointer) {
      const exifOffset = little ? tiff.readUInt32LE(exifPointer.valueField) : tiff.readUInt32BE(exifPointer.valueField)
      bytes = readTiffBytes(tiff, readTiffEntry(tiff, exifOffset, little, 0x9286), little)
    }
    if (!bytes) bytes = readTiffBytes(tiff, readTiffEntry(tiff, ifd0Offset, little, 0x9286), little)
    if (!bytes || bytes.length === 0) return null
    const text = decodeUserComment(bytes, little)
    return text.trim() ? text : null
  } catch { return null }
}

/** 最小 JPEG APP1/EXIF 读取器：定位 UserComment(0x9286) 并处理 ASCII/UNICODE/JIS 前缀 */
export function readJpegExifUserComment(buffer: Buffer): string | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    if (marker === 0xff) { offset += 1; continue }
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    if (marker === 0xda || marker === 0xd9) break // 压缩数据开始后不会再出现 EXIF
    const size = buffer.readUInt16BE(offset + 2)
    if (size < 2) break
    const payloadStart = offset + 4
    const payloadEnd = offset + 2 + size
    if (payloadEnd > buffer.length) break
    if (marker === 0xe1 && payloadStart + 6 <= payloadEnd && buffer.toString('latin1', payloadStart, payloadStart + 6) === 'Exif\u0000\u0000') {
      const comment = readExifUserComment(buffer.subarray(payloadStart + 6, payloadEnd))
      if (comment) return comment
    }
    offset = payloadEnd
  }
  return null
}

// ---------- A1111 'parameters' ----------

const A1111_TAIL_LINE = /^[ \t]*Steps:\s*\d/i

function matchNumber(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text)
  return match?.[1] ? toNumber(match[1]) : null
}

function matchText(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  return match?.[1]?.trim() ?? ''
}

/** 解析 A1111/Forge 'parameters' 文本块：正段落直到 'Negative prompt:'，尾行为逗号分隔的键值对 */
export function parseA1111Parameters(text: string): ParsedGenerationMetadata | null {
  const source = String(text ?? '')
  if (!source.trim()) return null
  const lines = source.split(/\r?\n/)
  // 参数尾行在文本末尾：从后往前找最后一行 'Steps: ...'（大小写/顺序容错）
  let tailIndex = -1
  for (let index = lines.length - 1; index >= 0; index--) {
    if (A1111_TAIL_LINE.test(lines[index])) { tailIndex = index; break }
  }
  const promptSection = tailIndex >= 0 ? lines.slice(0, tailIndex).join('\n') : source
  const tailLine = tailIndex >= 0 ? lines[tailIndex] : ''
  const result = emptyMetadata('webui')
  const negativeMatch = /^[ \t]*Negative prompt:[ \t]?/im.exec(promptSection)
  if (negativeMatch) {
    result.prompt = promptSection.slice(0, negativeMatch.index).trim()
    result.negativePrompt = promptSection.slice(negativeMatch.index + negativeMatch[0].length).trim()
  } else {
    result.prompt = promptSection.trim()
  }
  if (tailLine) {
    // 键值按逗号分隔；未知键（Forge 的 VAE/Denoising strength/Clip skip 等）静默忽略
    result.steps = matchNumber(tailLine, /(?:^|,\s*)Steps:\s*(\d+)/i)
    result.sampler = matchText(tailLine, /(?:^|,\s*)Sampler:\s*([^,]+)/i)
    result.cfg = matchNumber(tailLine, /(?:^|,\s*)CFG scale:\s*(-?[\d.]+)/i)
    result.seed = matchNumber(tailLine, /(?:^|,\s*)Seed:\s*(-?\d+)/i)
    const sizeMatch = /(?:^|,\s*)Size:\s*(\d+)\s*[x×]\s*(\d+)/i.exec(tailLine)
    if (sizeMatch) {
      result.width = toNumber(sizeMatch[1])
      result.height = toNumber(sizeMatch[2])
    }
    result.modelHash = matchText(tailLine, /(?:^|,\s*)Model hash:\s*([^,]+)/i)
    result.checkpoint = matchText(tailLine, /(?:^|,\s*)Model:\s*([^,]+)/i)
  }
  result.raw = { a1111: truncateRaw(source) }
  return result
}

// ---------- NovelAI Comment JSON ----------

const NOVELAI_KEYS = ['prompt', 'uc', 'steps', 'sampler', 'seed', 'width', 'height', 'scale', 'model']

/** 解析 NovelAI 'Comment' JSON：uc 为负向、scale 为 CFG；字段缺失容忍，非法 JSON 返回 null */
export function parseNovelAICaption(text: string): ParsedGenerationMetadata | null {
  const source = String(text ?? '').trim()
  if (!source) return null
  let value: unknown
  try { value = JSON.parse(source) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  // 完全不含 NovelAI 已知字段的空壳对象视为非 NAI 数据
  if (!NOVELAI_KEYS.some(key => record[key] !== undefined)) return null
  const result = emptyMetadata('novelai')
  result.prompt = toText(record.prompt)
  result.negativePrompt = toText(record.uc)
  result.steps = toNumber(record.steps)
  result.sampler = toText(record.sampler)
  result.seed = toNumber(record.seed)
  result.width = toNumber(record.width)
  result.height = toNumber(record.height)
  result.cfg = toNumber(record.scale)
  result.checkpoint = toText(record.model)
  result.raw = { nai: capRawValue(source, record) }
  return result
}

// ---------- ComfyUI prompt / workflow 图 ----------

interface ComfyNode {
  key: string
  type: string
  api: boolean
  inputs: Record<string, unknown>
  widgets: unknown[]
  links: Record<string, number>
}

interface ComfyGraph {
  nodes: ComfyNode[]
  byId: Map<string, ComfyNode>
  linkSources: Map<number, string>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isLinkRef(value: unknown): value is [string | number, number] {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number'
}

function buildComfyGraph(value: unknown): ComfyGraph | null {
  if (!isPlainRecord(value)) return null
  // API 格式：{ "3": { class_type: "KSampler", inputs: {...} }, ... }
  const apiEntries = Object.entries(value).filter(([, node]) => isPlainRecord(node) && typeof node.class_type === 'string')
  if (apiEntries.length > 0) {
    const nodes: ComfyNode[] = apiEntries.map(([key, node]) => {
      const record = node as Record<string, unknown>
      return { key, type: String(record.class_type), api: true, inputs: isPlainRecord(record.inputs) ? record.inputs : {}, widgets: [], links: {} }
    })
    return { nodes, byId: new Map(nodes.map(node => [node.key, node])), linkSources: new Map() }
  }
  // workflow 格式：{ nodes: [...], links: [[linkId, originId, ...], ...] }
  if (!Array.isArray(value.nodes)) return null
  const linkSources = new Map<number, string>()
  if (Array.isArray(value.links)) {
    for (const link of value.links) {
      if (Array.isArray(link) && link.length >= 2) linkSources.set(Number(link[0]), String(link[1]))
      else if (isPlainRecord(link)) {
        const id = Number(link.id ?? link.link_id)
        const origin = link.origin_id ?? link.source_id ?? link.source
        if (Number.isFinite(id) && origin !== undefined && origin !== null) linkSources.set(id, String(origin))
      }
    }
  }
  const nodes: ComfyNode[] = []
  for (const raw of value.nodes) {
    if (!isPlainRecord(raw) || raw.id === undefined || typeof raw.type !== 'string') continue
    const links: Record<string, number> = {}
    if (Array.isArray(raw.inputs)) {
      for (const input of raw.inputs) {
        if (isPlainRecord(input) && typeof input.name === 'string' && typeof input.link === 'number') links[input.name] = input.link
      }
    }
    nodes.push({ key: String(raw.id), type: raw.type, api: false, inputs: {}, widgets: Array.isArray(raw.widgets_values) ? raw.widgets_values : [], links })
  }
  if (nodes.length === 0) return null
  return { nodes, byId: new Map(nodes.map(node => [node.key, node])), linkSources }
}

const SOURCE_LITERAL_FIELDS = ['value', 'string', 'text', 'seed', 'noise_seed', 'steps', 'cfg', 'ckpt_name', 'lora_name']

// 沿输入链接回溯到源节点的字面值（数字/字符串），用于上游被转为输入（convert-to-input）的场景
function sourceLiteral(graph: ComfyGraph, key: string, visited: Set<string>): unknown {
  if (!key || visited.has(key)) return undefined
  visited.add(key)
  const node = graph.byId.get(key)
  if (!node) return undefined
  if (node.api) {
    for (const field of SOURCE_LITERAL_FIELDS) {
      const value = node.inputs[field]
      if (typeof value === 'string' || typeof value === 'number') return value
      if (isLinkRef(value)) {
        const literal = sourceLiteral(graph, String(value[0]), visited)
        if (literal !== undefined) return literal
      }
    }
    return undefined
  }
  for (const field of SOURCE_LITERAL_FIELDS) {
    const linkId = node.links[field]
    if (typeof linkId === 'number') {
      const origin = graph.linkSources.get(linkId)
      const literal = origin ? sourceLiteral(graph, origin, visited) : undefined
      if (literal !== undefined) return literal
    }
  }
  return node.widgets.find(widget => typeof widget === 'string' || typeof widget === 'number')
}

function fieldScalar(graph: ComfyGraph, node: ComfyNode, fields: string[], widgetFallback: boolean): unknown {
  const visited = new Set<string>()
  for (const field of fields) {
    if (node.api) {
      const value = node.inputs[field]
      if (typeof value === 'string' || typeof value === 'number') return value
      if (isLinkRef(value)) {
        const literal = sourceLiteral(graph, String(value[0]), visited)
        if (literal !== undefined) return literal
      }
    } else {
      const linkId = node.links[field]
      if (typeof linkId === 'number') {
        const origin = graph.linkSources.get(linkId)
        const literal = origin ? sourceLiteral(graph, origin, visited) : undefined
        if (literal !== undefined) return literal
      }
    }
  }
  if (widgetFallback && !node.api) {
    return node.widgets.find(widget => typeof widget === 'string' || typeof widget === 'number')
  }
  return undefined
}

const TEXT_FIELDS = ['text', 'string', 'value']

// 回溯文本：沿正/负 CONDITIONING 链接的源头取 CLIPTextEncode 文本（text 本身也可能被转为输入）
function extractText(graph: ComfyGraph, node: ComfyNode | undefined, visited: Set<string>): string {
  if (!node || visited.has(node.key)) return ''
  visited.add(node.key)
  if (node.api) {
    for (const field of TEXT_FIELDS) {
      const value = node.inputs[field]
      if (typeof value === 'string') return value
      if (isLinkRef(value)) {
        const text = extractText(graph, graph.byId.get(String(value[0])), visited)
        if (text) return text
      }
    }
    return ''
  }
  for (const field of TEXT_FIELDS) {
    const linkId = node.links[field]
    if (typeof linkId === 'number') {
      const origin = graph.linkSources.get(linkId)
      const text = origin ? extractText(graph, graph.byId.get(origin), visited) : ''
      if (text) return text
    }
  }
  const widget = node.widgets[0]
  return typeof widget === 'string' ? widget : ''
}

// workflow 格式下 KSampler/KSamplerAdvanced 的 widgets_values 位置启发式（第 2 位可能是不定值的 control_after_generate）
function samplerWidgetValues(node: ComfyNode): { seed: number | null; steps: number | null; cfg: number | null; sampler: string; scheduler: string } {
  const empty = { seed: null, steps: null, cfg: null, sampler: '', scheduler: '' }
  const widgets = node.widgets
  if (node.api || widgets.length === 0) return empty
  if (node.type === 'KSamplerAdvanced') {
    // [add_noise, noise_seed, (control_after_generate?), steps, cfg, sampler_name, scheduler, ...]
    const shift = typeof widgets[2] === 'string' ? 1 : 0
    return {
      seed: toNumber(widgets[1]),
      steps: toNumber(widgets[2 + shift]),
      cfg: toNumber(widgets[3 + shift]),
      sampler: toText(widgets[4 + shift]),
      scheduler: toText(widgets[5 + shift]),
    }
  }
  // KSampler：[seed, (control_after_generate?), steps, cfg, sampler_name, scheduler, denoise]
  const shift = typeof widgets[1] === 'string' ? 1 : 0
  return {
    seed: toNumber(widgets[0]),
    steps: toNumber(widgets[1 + shift]),
    cfg: toNumber(widgets[2 + shift]),
    sampler: toText(widgets[3 + shift]),
    scheduler: toText(widgets[4 + shift]),
  }
}

function samplerConditioning(graph: ComfyGraph, sampler: ComfyNode, name: 'positive' | 'negative'): string {
  const visited = new Set<string>()
  if (sampler.api) {
    const value = sampler.inputs[name]
    if (isLinkRef(value)) return extractText(graph, graph.byId.get(String(value[0])), visited)
    return typeof value === 'string' ? value : ''
  }
  const linkId = sampler.links[name]
  if (typeof linkId === 'number') {
    const origin = graph.linkSources.get(linkId)
    return origin ? extractText(graph, graph.byId.get(origin), visited) : ''
  }
  return ''
}

function extractCheckpoint(graph: ComfyGraph): string {
  for (const node of graph.nodes) {
    if (node.type === 'CheckpointLoaderSimple' || node.type === 'CheckpointLoader') {
      const value = toText(fieldScalar(graph, node, ['ckpt_name'], true))
      if (value) return value
    }
  }
  return ''
}

function extractLoras(graph: ComfyGraph): string[] {
  const loras: string[] = []
  for (const node of graph.nodes) {
    if (node.type === 'LoraLoader' || node.type === 'LoraLoaderModelOnly') {
      const name = toText(fieldScalar(graph, node, ['lora_name'], true))
      if (name) loras.push(name)
    }
  }
  return loras
}

function extractLatentDimensions(graph: ComfyGraph, sampler: ComfyNode): { width: number | null; height: number | null } {
  let latent: ComfyNode | undefined
  if (sampler.api) {
    const value = sampler.inputs.latent_image ?? sampler.inputs.latent
    if (isLinkRef(value)) latent = graph.byId.get(String(value[0]))
  } else {
    const linkId = sampler.links.latent_image ?? sampler.links.latent
    if (typeof linkId === 'number') {
      const origin = graph.linkSources.get(linkId)
      latent = origin ? graph.byId.get(origin) : undefined
    }
  }
  // 仅当源头是潜空间/图像节点（如 EmptyLatentImage）时才取宽高
  if (!latent || !/latent|image/i.test(latent.type)) return { width: null, height: null }
  let width = toNumber(fieldScalar(graph, latent, ['width'], false))
  let height = toNumber(fieldScalar(graph, latent, ['height'], false))
  if ((width === null || height === null) && !latent.api) {
    width = width ?? toNumber(latent.widgets[0]) // EmptyLatentImage widgets: [width, height, batch_size]
    height = height ?? toNumber(latent.widgets[1])
  }
  return { width, height }
}

/** 解析 ComfyUI 'prompt'/'workflow' JSON：定位 KSampler 取采样参数，回溯 CLIPTextEncode 得正负文本 */
export function parseComfyGraph(jsonText: string): ParsedGenerationMetadata | null {
  const source = String(jsonText ?? '').trim()
  if (!source) return null
  let value: unknown
  try { value = JSON.parse(source) } catch { return null }
  const graph = buildComfyGraph(value)
  if (!graph) return null
  const result = emptyMetadata('comfyui-embedded')
  const samplers = graph.nodes.filter(node => node.type === 'KSampler' || node.type === 'KSamplerAdvanced')
  const sampler = samplers.length > 0 ? samplers[samplers.length - 1] : undefined
  if (sampler) {
    const widgets = samplerWidgetValues(sampler)
    result.seed = toNumber(fieldScalar(graph, sampler, ['seed', 'noise_seed'], false)) ?? widgets.seed
    result.steps = toNumber(fieldScalar(graph, sampler, ['steps'], false)) ?? widgets.steps
    result.cfg = toNumber(fieldScalar(graph, sampler, ['cfg'], false)) ?? widgets.cfg
    result.sampler = toText(fieldScalar(graph, sampler, ['sampler_name'], false)) || widgets.sampler
    result.scheduler = toText(fieldScalar(graph, sampler, ['scheduler'], false)) || widgets.scheduler
    result.prompt = samplerConditioning(graph, sampler, 'positive')
    result.negativePrompt = samplerConditioning(graph, sampler, 'negative')
    const dimensions = extractLatentDimensions(graph, sampler)
    result.width = dimensions.width
    result.height = dimensions.height
  }
  result.checkpoint = extractCheckpoint(graph)
  result.loras = extractLoras(graph)
  result.raw = { comfyPrompt: capRawValue(source, value) }
  return result
}

// ---------- 编排 ----------

function withChunkList(parsed: ParsedGenerationMetadata, chunks: Record<string, string>): ParsedGenerationMetadata {
  parsed.raw = { ...parsed.raw, chunks: Object.keys(chunks) }
  return parsed
}

/**
 * 按 MIME 解析图片内嵌的生成元数据：
 * PNG → tEXt/iTXt/zTXt 文本块（parameters→A1111、Comment→NovelAI、prompt/workflow→ComfyUI）；
 * JPEG → EXIF UserComment 文本再按内容判定；其余格式返回 null。
 */
export function parseEmbeddedMetadata(buffer: Buffer, mime: string): ParsedGenerationMetadata | null {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null
  const kind = String(mime ?? '').toLowerCase()
  if (kind === 'image/png') {
    const chunks = readPngTextChunks(buffer)
    if (Object.keys(chunks).length === 0) return null
    if (chunks.parameters) {
      const parsed = parseA1111Parameters(chunks.parameters)
      if (parsed) return withChunkList(parsed, chunks)
    }
    if (chunks.Comment) {
      const parsed = parseNovelAICaption(chunks.Comment)
      if (parsed) return withChunkList(parsed, chunks)
    }
    // ComfyUI 标准输出同时带 prompt(API JSON) 与 workflow(UI JSON)，缺一时也尽力解析
    if (chunks.prompt || chunks.workflow) {
      const parsed = (chunks.prompt ? parseComfyGraph(chunks.prompt) : null) || (chunks.workflow ? parseComfyGraph(chunks.workflow) : null)
      if (parsed) return withChunkList(parsed, chunks)
    }
    return null
  }
  if (kind === 'image/jpeg' || kind === 'image/jpg') {
    const comment = readJpegExifUserComment(buffer)
    if (!comment || !comment.trim()) return null
    const trimmed = comment.trim()
    if (trimmed.startsWith('{')) {
      const nai = parseNovelAICaption(trimmed)
      if (nai) return nai
      const comfy = parseComfyGraph(trimmed)
      if (comfy) return comfy
    }
    return parseA1111Parameters(comment)
  }
  return null
}