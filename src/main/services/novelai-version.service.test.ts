import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot),
  },
}))

import { closeDatabase, CURRENT_SCHEMA_VERSION, initDatabase } from '../database'
import {
  NovelaiVersionError,
  createNovelaiVersion,
  createNovelaiWork,
  getNovelaiBranchName,
  getNovelaiWork,
  getNovelaiVersion,
  linkNovelaiVersionImage,
  listNovelaiBranchLine,
  listNovelaiVersionImages,
  listNovelaiVersionsByImage,
  setNovelaiBranchName,
} from './novelai-version.service'

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-novelai-'))
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('NovelAI prompt version tree (M6.2)', () => {
  it('creates a work with a root version on branch 1', () => {
    const { work, root } = createNovelaiWork({ name: '黄昏', snapshot: '1girl, sunset' })
    expect(work.name).toBe('黄昏')
    expect(work.revision).toBe(1)
    expect(work.lastVersionId).toBe(root.id)
    expect(root.number).toBe(1)
    expect(root.branchId).toBe(root.id)
    expect(root.branchNumber).toBe(1)
    expect(getNovelaiVersion(root.id)?.snapshot).toBe('1girl, sunset')
  })

  it('extends the same branch while the parent is a leaf', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    const second = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, b', expectedRevision: 1 })
    expect(second.branched).toBe(false)
    expect(second.version.branchId).toBe(root.branchId)
    expect(second.version.branchNumber).toBe(1)
    expect(second.version.number).toBe(2)
    const third = createNovelaiVersion({ workId: work.id, parentVersionId: second.version.id, snapshot: 'a, b, c', expectedRevision: 2 })
    expect(third.version.branchId).toBe(root.branchId)
  })

  it('starts a new branch when the parent already has children', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    const first = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, b', expectedRevision: 1 })
    // Going back to the root and editing again must fork instead of rewriting the first child.
    const forked = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, z', expectedRevision: 2 })
    expect(forked.branched).toBe(true)
    expect(forked.version.branchId).toBe(forked.version.id)
    expect(forked.version.branchNumber).toBe(root.branchNumber + 1)
    expect(forked.version.parentId).toBe(root.id)
    expect(first.version.branchId).not.toBe(forked.version.branchId)
  })

  it('lists only the requested line and follows the latest one by default', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    const first = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, b', expectedRevision: 1 })
    const forked = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, z', expectedRevision: 2 })
    expect(listNovelaiBranchLine(work.id, root.branchId).map(version => version.snapshot)).toEqual(['a', 'a, b'])
    expect(listNovelaiBranchLine(work.id, forked.version.branchId).map(version => version.snapshot)).toEqual(['a', 'a, z'])
    // The work's last version is the fork, so the default line is the fork's.
    expect(listNovelaiBranchLine(work.id).map(version => version.id)).toEqual([root.id, forked.version.id])
    expect(first.version.id).not.toBe(forked.version.id)
  })

  it('refuses to create an empty version when the text did not change', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    const again = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a', expectedRevision: 1 })
    expect(again.unchanged).toBe(true)
    expect(again.version.id).toBe(root.id)
    expect(getNovelaiWork(work.id)?.revision).toBe(1)
  })

  it('rejects stale revisions and cross-work parents', () => {
    const a = createNovelaiWork({ name: 'a', snapshot: 'x' })
    const b = createNovelaiWork({ name: 'b', snapshot: 'y' })
    expect(() => createNovelaiVersion({ workId: a.work.id, parentVersionId: a.root.id, snapshot: 'x, y', expectedRevision: 9 })).toThrowError(/revision/i)
    try {
      createNovelaiVersion({ workId: a.work.id, parentVersionId: b.root.id, snapshot: 'x, y', expectedRevision: 1 })
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(NovelaiVersionError)
      expect((error as NovelaiVersionError).code).toBe('CROSS_WORK_PARENT')
    }
  })

  it('names branches and reads them back', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    setNovelaiBranchName(work.id, root.branchId, '主线')
    expect(getNovelaiBranchName(root.branchId)).toBe('主线')
    setNovelaiBranchName(work.id, root.branchId, '主线 2')
    expect(getNovelaiBranchName(root.branchId)).toBe('主线 2')
  })

  it('links images many-to-many and answers 「这张图出现在哪些版本」', () => {
    const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
    const second = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, b', expectedRevision: 1 })
    linkNovelaiVersionImage({ versionId: root.id, imageId: 'img_1', seed: 42, variant: 'base' })
    linkNovelaiVersionImage({ versionId: second.version.id, imageId: 'img_1', seed: 42, variant: 'base' })
    linkNovelaiVersionImage({ versionId: second.version.id, imageId: 'img_1' }) // duplicate ignored
    expect(listNovelaiVersionImages(root.id).map(item => item.imageId)).toEqual(['img_1'])
    expect(listNovelaiVersionsByImage('img_1').map(version => version.id).sort()).toEqual([root.id, second.version.id].sort())
  })

  it('ships schema v36 with the version tables', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(36)
  })
})
