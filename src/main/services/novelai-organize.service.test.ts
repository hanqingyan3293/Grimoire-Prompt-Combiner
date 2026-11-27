import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) },
}))

import { closeDatabase, initDatabase } from '../database'
import { createNovelaiProposalService } from './novelai-organize.service'
import { createNovelaiProviderModelCall } from './novelai-organize-provider'
import {
  createNovelaiVersion,
  createNovelaiWork,
  getNovelaiWork,
  listNovelaiBranchLine,
  softDeleteNovelaiVersion,
} from './novelai-version.service'
import { applyOrganizeSuggestions } from '../../shared/novelai-organize'
import { parsePromptDocument } from '../../shared/prompt-blocks'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-organize-'))
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

function create() {
  const created = createNovelaiWork({ name: '整理', snapshot: '1girl, long  hair, solo' })
  return { work: getNovelaiWork(created.work.id)!, root: created.root }
}

function codeOf(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined
}

async function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run()
    throw new Error('expected ' + code)
  } catch (error) {
    expect(codeOf(error)).toBe(code)
  }
}

describe('NovelAI organize proposal service (M6.5)', () => {
  it('returns per-block suggestions without writing a draft or version', async () => {
    const { work, root } = create()
    const callModel = vi.fn(async () => JSON.stringify({
      changes: [{ block: 1, after: 'long hair', title: '合并空格', reason: '多余的空白' }],
    }))
    const propose = createNovelaiProposalService(callModel)
    const result = await propose({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: root.snapshot })

    expect(result.changes).toEqual([
      { block: 1, before: 'long  hair', after: 'long hair', title: '合并空格', reason: '多余的空白' },
    ])
    expect(result.workRevision).toBe(work.revision)
    expect(result.versionId).toBe(root.id)
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(getNovelaiWork(work.id)!.revision).toBe(work.revision)
    expect(listNovelaiBranchLine(work.id)).toHaveLength(1)
  })

  it('refuses a stale work revision before contacting the model', async () => {
    const { work, root } = create()
    const callModel = vi.fn(async () => JSON.stringify({ changes: [] }))
    const propose = createNovelaiProposalService(callModel)
    try {
      await propose({ workId: work.id, versionId: root.id, expectedRevision: work.revision + 1, draft: root.snapshot })
      throw new Error('expected revision conflict')
    } catch (error) {
      expect(codeOf(error)).toBe('REVISION_CONFLICT')
    }
    expect(callModel).not.toHaveBeenCalled()
  })

  it('refuses malformed JSON and an out-of-range block without applying a partial plan', async () => {
    const { work, root } = create()
    const malformed = createNovelaiProposalService(async () => 'not json')
    await expectCode(
      () => malformed({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: root.snapshot }),
      'INVALID_PLAN',
    )

    const outOfRange = createNovelaiProposalService(async () => JSON.stringify({
      changes: [{ block: 99, after: 'solo', title: '越界', reason: '越界' }],
    }))
    await expectCode(
      () => outOfRange({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: root.snapshot }),
      'INVALID_PLAN',
    )
    expect(getNovelaiWork(work.id)!.revision).toBe(work.revision)
    expect(listNovelaiBranchLine(work.id)).toHaveLength(1)
  })

  it('refuses a response when the work changed while the model was running', async () => {
    const { work, root } = create()
    const propose = createNovelaiProposalService(async () => {
      createNovelaiVersion({
        workId: work.id,
        parentVersionId: root.id,
        snapshot: '1girl, short hair, solo',
        expectedRevision: getNovelaiWork(work.id)!.revision,
      })
      return JSON.stringify({ changes: [{ block: 1, after: 'long hair', title: 't', reason: 'r' }] })
    })
    try {
      await propose({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: root.snapshot })
      throw new Error('expected revision conflict')
    } catch (error) {
      expect(codeOf(error)).toBe('REVISION_CONFLICT')
    }
  })

  it('refuses a version that is in the recycle bin', async () => {
    const { work, root } = create()
    softDeleteNovelaiVersion({ workId: work.id, versionId: root.id, mode: 'branch', expectedRevision: work.revision })
    const callModel = vi.fn(async () => JSON.stringify({ changes: [] }))
    const propose = createNovelaiProposalService(callModel)
    try {
      await propose({ workId: work.id, versionId: root.id, expectedRevision: getNovelaiWork(work.id)!.revision, draft: root.snapshot })
      throw new Error('expected missing version')
    } catch (error) {
      expect(codeOf(error)).toBe('VERSION_NOT_FOUND')
    }
    expect(callModel).not.toHaveBeenCalled()
  })

  it('does not call the model for an empty draft', async () => {
    const { work, root } = create()
    const callModel = vi.fn(async () => JSON.stringify({ changes: [] }))
    const propose = createNovelaiProposalService(callModel)
    const result = await propose({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: '' })
    expect(result.changes).toEqual([])
    expect(callModel).not.toHaveBeenCalled()
  })

  it('runs through the active-provider adapter without inventing a model', async () => {
    const { work, root } = create()
    const complete = vi.fn(async () => JSON.stringify({
      changes: [{ block: 1, after: 'long hair', title: '合并空格', reason: '多余的空白' }],
    }))
    const propose = createNovelaiProposalService(createNovelaiProviderModelCall({
      getProvider: async () => ({
        id: 'p1', name: 'Provider', access_mode: 'api', protocol: 'chat_completions',
        base_url: 'https://provider.example.invalid/v1', has_api_key: true, has_auth_config: false,
        default_model: 'configured-model', test_model: '', context_size: null, models: [],
        is_active: true, created_at: '', updated_at: '', api_key: 'decrypted-secret',
      }),
      complete,
    }))
    const result = await propose({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: root.snapshot })
    expect(result.changes).toEqual([
      { block: 1, before: 'long  hair', after: 'long hair', title: '合并空格', reason: '多余的空白' },
    ])
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: 'configured-model',
      apiKey: 'decrypted-secret',
      user: expect.stringContaining('long  hair'),
    }))
  })

  it('applies accepted changes to the draft and leaves empty saves unchanged', async () => {
    const { work, root } = create()
    const propose = createNovelaiProposalService(async () => JSON.stringify({
      changes: [{ block: 1, after: 'long hair', title: '合并空格', reason: '多余的空白' }],
    }))
    const result = await propose({ workId: work.id, versionId: root.id, expectedRevision: work.revision, draft: root.snapshot })
    const applied = applyOrganizeSuggestions(parsePromptDocument(root.snapshot), result.changes)
    expect(applied.text).toBe('1girl, long hair, solo')

    const saved = createNovelaiVersion({
      workId: work.id,
      parentVersionId: root.id,
      snapshot: applied.text,
      expectedRevision: result.workRevision,
    })
    expect(saved.unchanged).toBe(false)
    expect(saved.version.snapshot).toBe('1girl, long hair, solo')

    const again = createNovelaiVersion({
      workId: work.id,
      parentVersionId: saved.version.id,
      snapshot: applied.text,
      expectedRevision: getNovelaiWork(work.id)!.revision,
    })
    expect(again.unchanged).toBe(true)
    expect(getNovelaiWork(work.id)!.lastVersionId).toBe(saved.version.id)
    expect(listNovelaiBranchLine(work.id)).toHaveLength(2)
  })
})
