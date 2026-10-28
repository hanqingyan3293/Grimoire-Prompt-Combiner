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
  listNovelaiBranches,
  getNovelaiWork,
  getNovelaiVersion,
  linkNovelaiVersionImage,
  listNovelaiBranchLine,
  listNovelaiVersionImages,
  listNovelaiDeletedVersions,
  listNovelaiVersionsByImage,
  purgeNovelaiVersion,
  restoreNovelaiVersion,
  restoreNovelaiVersions,
  setNovelaiBranchName,
  softDeleteNovelaiVersion,
  softDeleteNovelaiVersions,
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
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(36)
  })
  describe('recycle bin (M6.3)', () => {
    const build = () => {
      const { work, root } = createNovelaiWork({ name: 'w', snapshot: 'a' })
      const second = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'a, b', expectedRevision: 1 })
      const third = createNovelaiVersion({ workId: work.id, parentVersionId: second.version.id, snapshot: 'a, b, c', expectedRevision: 2 })
      return { work, root, second: second.version, third: third.version }
    }

    it('soft-deletes a leaf, hides it from the line and keeps it in the bin', () => {
      const { work, root, second, third } = build()
      const result = softDeleteNovelaiVersion({ workId: work.id, versionId: third.id, mode: 'single', expectedRevision: 3 })
      expect(result.deleted).toEqual([third.id])
      expect(listNovelaiBranchLine(work.id).map(version => version.snapshot)).toEqual(['a', 'a, b'])
      expect(listNovelaiDeletedVersions(work.id).map(version => version.id)).toEqual([third.id])
      expect(getNovelaiWork(work.id)?.lastVersionId).toBe(second.id)
    })

    it('refuses a single delete when the version still has children', () => {
      const { work, second } = build()
      expect(() => softDeleteNovelaiVersion({ workId: work.id, versionId: second.id, mode: 'single', expectedRevision: 3 })).toThrow(/children/i)
    })

    it('deletes a whole branch including descendants and its name', () => {
      const { work, root, second, third } = build()
      setNovelaiBranchName(work.id, root.branchId, '主线')
      const result = softDeleteNovelaiVersion({ workId: work.id, versionId: root.id, mode: 'branch', expectedRevision: 3 })
      expect(result.deleted.sort()).toEqual([root.id, second.id, third.id].sort())
      expect(listNovelaiBranchLine(work.id)).toEqual([])
      expect(getNovelaiBranchName(root.branchId)).toBeNull()
      expect(getNovelaiWork(work.id)?.lastVersionId).toBeNull()
    })

    it('restores a version together with its deleted ancestors', () => {
      const { work, root, second, third } = build()
      softDeleteNovelaiVersion({ workId: work.id, versionId: root.id, mode: 'branch', expectedRevision: 3 })
      restoreNovelaiVersion(third.id)
      expect(listNovelaiBranchLine(work.id).map(version => version.snapshot)).toEqual(['a', 'a, b', 'a, b, c'])
      expect(listNovelaiDeletedVersions(work.id)).toEqual([])
    })

    it('refuses permanent removal while live children exist, and allows it afterwards', () => {
      const { work, second, third } = build()
      expect(() => purgeNovelaiVersion(second.id)).toThrow(/children/i)
      softDeleteNovelaiVersion({ workId: work.id, versionId: third.id, mode: 'single', expectedRevision: 3 })
      purgeNovelaiVersion(third.id)
      expect(getNovelaiVersion(third.id)).toBeNull()
    })

    it('will not extend a version that sits in the recycle bin', () => {
      const { work, second, third } = build()
      softDeleteNovelaiVersion({ workId: work.id, versionId: third.id, mode: 'single', expectedRevision: 3 })
      expect(() => createNovelaiVersion({ workId: work.id, parentVersionId: third.id, snapshot: 'a, b, c, d', expectedRevision: 4 })).toThrow(/recycle/i)
      expect(second.id).toBeTruthy()
    })
  })
})
describe('branch listing (M6 UI)', () => {
  it('lists every branch with its tip and size, newest tip first', () => {
    const created = createNovelaiWork({ name: '分支作品', snapshot: 'a' })
    const work = created.work
    const root = created.root
    // Two children of the root: the second one must start its own branch (the parent already has a child).
    const first = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'b', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    const second = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: 'c', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    // A second child of the same parent starts its own branch instead of extending the first.
    expect(second.branched).toBe(true)
    expect(second.version.branchId).not.toBe(first.version.branchId)
    const branches = listNovelaiBranches(work.id)
    expect(branches).toHaveLength(2)
    expect(branches.map(branch => branch.tipVersionId)).toContain(root.branchId)
    expect(branches.map(branch => branch.tipVersionId)).toContain(second.version.branchId)
    expect(branches[0].tipNumber).toBeGreaterThanOrEqual(branches[1].tipNumber)
    expect(branches.every(branch => branch.size >= 1)).toBe(true)
  })

  it('throws for an unknown work instead of returning an empty list', () => {
    expect(() => listNovelaiBranches('nai_w_missing')).toThrow(/WORK_NOT_FOUND|work not found/)
  })
})
describe('recycle bin batch operations (M6)', () => {
  it('deletes several leaf versions at once and bumps the revision exactly once', () => {
    const created = createNovelaiWork({ name: '批量删除', snapshot: 'a' })
    const work = created.work
    const first = createNovelaiVersion({ workId: work.id, parentVersionId: created.root.id, snapshot: 'b', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    const second = createNovelaiVersion({ workId: work.id, parentVersionId: first.version.id, snapshot: 'c', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    const revisionBefore = getNovelaiWork(work.id)!.revision
    const result = softDeleteNovelaiVersions({ workId: work.id, versionIds: [second.version.id, first.version.id], expectedRevision: revisionBefore })
    expect(result.deleted).toHaveLength(2)
    expect(getNovelaiWork(work.id)!.revision).toBe(revisionBefore + 1)
    expect(listNovelaiDeletedVersions(work.id).map(version => version.id).sort()).toEqual([first.version.id, second.version.id].sort())
  })

  it('refuses the whole batch when one selected version has live children', () => {
    const created = createNovelaiWork({ name: '批量拒绝', snapshot: 'a' })
    const work = created.work
    const child = createNovelaiVersion({ workId: work.id, parentVersionId: created.root.id, snapshot: 'b', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    // The child is NOT in the batch, so the parent cannot disappear on its own.
    void child
    expect(() => softDeleteNovelaiVersions({ workId: work.id, versionIds: [created.root.id], expectedRevision: getNovelaiWork(work.id)!.revision }))
      .toThrow(/children/)
    // Nothing was written: the work still has every live version.
    expect(listNovelaiDeletedVersions(work.id)).toHaveLength(0)
  })

  it('restores a batch and refuses unknown ids before touching anything', () => {
    const created = createNovelaiWork({ name: '批量恢复', snapshot: 'a' })
    const work = created.work
    const child = createNovelaiVersion({ workId: work.id, parentVersionId: created.root.id, snapshot: 'b', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    softDeleteNovelaiVersions({ workId: work.id, versionIds: [child.version.id], expectedRevision: getNovelaiWork(work.id)!.revision })
    expect(listNovelaiDeletedVersions(work.id)).toHaveLength(1)
    const restored = restoreNovelaiVersions([child.version.id])
    expect(restored).toHaveLength(1)
    expect(listNovelaiDeletedVersions(work.id)).toHaveLength(0)
    expect(() => restoreNovelaiVersions([child.version.id, 'nai_v_missing'])).toThrow(/not found/)
  })
})
