import { getPngText, isPng, writePngText } from './png-metadata'

// NovelAI generation metadata (M6.6): the parameters a prompt was rendered with, written into
// the PNG and read back. Unknown keys are preserved verbatim instead of dropped — a file made by
// a newer tool must survive a round trip through this one.
export const NOVELAI_METADATA_KEYWORD = 'Comment'
export const NOVELAI_METADATA_VERSION = 1

export interface NovelaiGenerationParams {
  readonly prompt: string
  readonly negativePrompt?: string
  readonly steps?: number
  readonly cfg?: number
  readonly seed?: number
  readonly sampler?: string
  readonly scheduler?: string
  readonly width?: number
  readonly height?: number
  readonly model?: string
  readonly checkpoint?: string
  readonly loras?: readonly string[]
}

export interface DecodedNovelaiMetadata {
  readonly params: NovelaiGenerationParams
  /** Keys this version does not model; re-encoding writes them back unchanged. */
  readonly unknown: Readonly<Record<string, unknown>>
  readonly version: number | null
}

const KNOWN_KEYS = new Set(['prompt', 'negativePrompt', 'steps', 'cfg', 'seed', 'sampler', 'scheduler', 'width', 'height', 'model', 'checkpoint', 'loras', 'version'])

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export function encodeNovelaiMetadata(params: NovelaiGenerationParams, unknown: Readonly<Record<string, unknown>> = {}): string {
  const payload: Record<string, unknown> = {
    ...unknown,
    version: NOVELAI_METADATA_VERSION,
    prompt: params.prompt,
  }
  if (params.negativePrompt !== undefined) payload.negativePrompt = params.negativePrompt
  if (params.steps !== undefined) payload.steps = params.steps
  if (params.cfg !== undefined) payload.cfg = params.cfg
  if (params.seed !== undefined) payload.seed = params.seed
  if (params.sampler !== undefined) payload.sampler = params.sampler
  if (params.scheduler !== undefined) payload.scheduler = params.scheduler
  if (params.width !== undefined) payload.width = params.width
  if (params.height !== undefined) payload.height = params.height
  if (params.model !== undefined) payload.model = params.model
  if (params.checkpoint !== undefined) payload.checkpoint = params.checkpoint
  if (params.loras !== undefined) payload.loras = [...params.loras]
  return JSON.stringify(payload)
}

export function decodeNovelaiMetadata(text: string | null | undefined): DecodedNovelaiMetadata | null {
  if (!text) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.prompt !== 'string') return null
  const unknown: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) if (!KNOWN_KEYS.has(key)) unknown[key] = value
  return {
    params: {
      prompt: record.prompt,
      negativePrompt: stringOrUndefined(record.negativePrompt),
      steps: numberOrUndefined(record.steps),
      cfg: numberOrUndefined(record.cfg),
      seed: numberOrUndefined(record.seed),
      sampler: stringOrUndefined(record.sampler),
      scheduler: stringOrUndefined(record.scheduler),
      width: numberOrUndefined(record.width),
      height: numberOrUndefined(record.height),
      model: stringOrUndefined(record.model),
      checkpoint: stringOrUndefined(record.checkpoint),
      loras: Array.isArray(record.loras) ? record.loras.filter((item): item is string => typeof item === 'string') : undefined,
    },
    unknown,
    version: numberOrUndefined(record.version) ?? null,
  }
}

/** Embed the parameters into a PNG. Returns null for a non-PNG buffer instead of pretending. */
export function writeNovelaiMetadataToPng(buffer: Buffer, params: NovelaiGenerationParams, unknown: Readonly<Record<string, unknown>> = {}): Buffer | null {
  if (!isPng(buffer)) return null
  return writePngText(buffer, [{ keyword: NOVELAI_METADATA_KEYWORD, text: encodeNovelaiMetadata(params, unknown) }])
}

export function readNovelaiMetadataFromPng(buffer: Buffer): DecodedNovelaiMetadata | null {
  if (!isPng(buffer)) return null
  return decodeNovelaiMetadata(getPngText(buffer, NOVELAI_METADATA_KEYWORD))
}
