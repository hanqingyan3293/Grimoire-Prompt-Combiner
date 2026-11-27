import {
  OrganizePlanError,
  parseOrganizeSuggestions,
  type OrganizeSuggestion,
} from '../../shared/novelai-organize'
import { parsePromptDocument } from '../../shared/prompt-blocks'
import { getNovelaiVersion, getNovelaiWork, type NovelaiVersion, type NovelaiWork } from './novelai-version.service'

// M6.5 proposal boundary. The model is injected so tests never need a provider, and so the
// provider adapter can live in main without leaking a key or a base URL into the renderer.
// This service only reads and proposes; applying a suggestion changes the renderer's draft,
// and saving goes through createNovelaiVersion with the work's expectedRevision.
export type NovelaiOrganizeErrorCode =
  | 'INVALID_INPUT'
  | 'WORK_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'STALE_DRAFT'
  | 'INVALID_PLAN'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_FAILED'

export class NovelaiOrganizeError extends Error {
  constructor(readonly code: NovelaiOrganizeErrorCode, message: string) {
    super(message)
    this.name = 'NovelaiOrganizeError'
  }
}

export interface NovelaiOrganizeRequest {
  readonly workId: string
  readonly versionId: string
  readonly expectedRevision: number
  readonly draft: string
}

export interface NovelaiOrganizeProposal {
  readonly changes: OrganizeSuggestion[]
  readonly workRevision: number
  readonly versionId: string
}

/** Main-process adapter contract. `user` is the JSON block payload; `system` is the fixed
 * instruction. The default adapter talks to the active Grimoire provider. */
export type NovelaiOrganizeModelCall = (input: { system: string; user: string }) => Promise<string>

const SYSTEM_PROMPT = [
  'Tidy one NovelAI image prompt and return JSON only, with no prose or code fence.',
  'Shape: {"changes":[{"block":0,"after":"...","title":"...","reason":"..."}]}.',
  'Each change replaces exactly one block from the supplied list. Use the block index from the input.',
  'Only repair an obvious spelling mistake, an unmatched } ] or ::, or extra whitespace.',
  'Do not add or remove tags, do not change numeric weights, and do not rewrite random blocks.',
  'Leave a correct block out of the list. Write a short Chinese title and reason for every change.',
].join(' ')

function text(value: unknown, field: string, max = 200_000): string {
  if (typeof value !== 'string') throw new NovelaiOrganizeError('INVALID_INPUT', field + ' must be a string')
  if (value.length > max) throw new NovelaiOrganizeError('INVALID_INPUT', field + ' is too long')
  return value
}

function readWork(input: NovelaiOrganizeRequest): NovelaiWork {
  const work = getNovelaiWork(input.workId)
  if (!work) throw new NovelaiOrganizeError('WORK_NOT_FOUND', 'work not found')
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== work.revision) {
    throw new NovelaiOrganizeError('REVISION_CONFLICT', 'work changed since revision ' + input.expectedRevision)
  }
  return work
}

function readLiveVersion(work: NovelaiWork, versionId: string): NovelaiVersion {
  const version = getNovelaiVersion(versionId)
  if (!version || version.workId !== work.id || version.deletedAt) {
    throw new NovelaiOrganizeError('VERSION_NOT_FOUND', 'version not found in this work')
  }
  return version
}

function decodeModelJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!text) throw new NovelaiOrganizeError('INVALID_PLAN', 'provider returned an empty response')
  try {
    return JSON.parse(text)
  } catch {
    throw new NovelaiOrganizeError('INVALID_PLAN', 'provider returned invalid JSON')
  }
}

export function createNovelaiProposalService(callModel: NovelaiOrganizeModelCall) {
  return async function proposeNovelaiOrganize(input: NovelaiOrganizeRequest): Promise<NovelaiOrganizeProposal> {
    const workId = text(input?.workId, 'workId', 200)
    const versionId = text(input?.versionId, 'versionId', 200)
    const draft = text(input?.draft, 'draft')
    const request: NovelaiOrganizeRequest = { workId, versionId, draft, expectedRevision: input?.expectedRevision }
    const work = readWork(request)
    const version = readLiveVersion(work, versionId)
    const document = parsePromptDocument(draft)
    if (!document.blocks.length) return { changes: [], workRevision: work.revision, versionId: version.id }

    let response: string
    try {
      response = await callModel({
        system: SYSTEM_PROMPT,
        user: JSON.stringify({
          blocks: document.blocks.map((block, blockIndex) => ({ block: blockIndex, text: block.raw, type: block.type })),
        }),
      })
    } catch (error) {
      if (error instanceof NovelaiOrganizeError) throw error
      throw new NovelaiOrganizeError('REQUEST_FAILED', error instanceof Error ? error.message : String(error))
    }

    // The reply is only useful for the revision/draft that produced it. Re-read both after the
    // await so a save, branch or delete during the model call cannot be overwritten.
    const current = getNovelaiWork(work.id)
    if (!current) throw new NovelaiOrganizeError('WORK_NOT_FOUND', 'work disappeared during the request')
    if (current.revision !== work.revision) {
      throw new NovelaiOrganizeError('REVISION_CONFLICT', 'work changed while the model was running')
    }
    const after = getNovelaiVersion(version.id)
    if (!after || after.workId !== work.id || after.deletedAt || after.snapshot !== version.snapshot) {
      throw new NovelaiOrganizeError('STALE_DRAFT', 'the source version changed while the model was running')
    }

    try {
      const changes = parseOrganizeSuggestions(decodeModelJson(response), document)
      return { changes, workRevision: current.revision, versionId: version.id }
    } catch (error) {
      if (error instanceof NovelaiOrganizeError) throw error
      if (error instanceof OrganizePlanError) {
        throw new NovelaiOrganizeError('INVALID_PLAN', 'invalid organize plan (' + error.code + '): ' + error.message)
      }
      throw new NovelaiOrganizeError('INVALID_PLAN', error instanceof Error ? error.message : String(error))
    }
  }
}
