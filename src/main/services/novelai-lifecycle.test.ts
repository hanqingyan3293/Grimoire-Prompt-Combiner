import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) },
}))

import { closeDatabase, initDatabase } from '../database'
import {
  createNovelaiWork, createNovelaiVersion, getNovelaiWork, getNovelaiVersion,
  listNovelaiBranches, listNovelaiDeletedVersions, purgeNovelaiVersion,
  restoreNovelaiVersions, softDeleteNovelaiVersions,
} from './novelai-version.service'

// M6 lifecycle: one test walks the chain the workbench UI drives, in the same order, asserting the state a
// user would see after each step. The individual services have their own unit tests; this covers the seams
// between them, where revision numbers, branch numbering and the recycle-bin round trip interact.
//
// Asset ↔ version links are deliberately out of scope here: they go through an image row, and
// novelai-asset.service.test.ts already covers both directions (`listAssetsUsedByVersion`,
// `listVersionsUsingAsset`) against real rows.
beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-lifecycle-'))
  await initDatabase()
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('M6 lifecycle (work → version → branch → recycle bin → restore → purge)', () => {
  it('walks the whole chain without losing a version or renumbering the survivors', () => {
    const created = createNovelaiWork({ name: '生命周期', snapshot: '1girl, {smile}, solo' })
    const work = created.work
    const root = created.root
    expect(root.number).toBe(1)

    // 1. Edit the tip: a second version on the first branch.
    const second = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: '1girl, {grin}, solo', source: 'user', operation: 'edit', expectedRevision: getNovelaiWork(work.id)!.revision })
    expect(getNovelaiVersion(second.version.id)!.number).toBe(2)

    // 2. Branch from the ROOT (not the tip) — the workbench's 开分支.
    const branch = createNovelaiVersion({ workId: work.id, parentVersionId: root.id, snapshot: '1girl, (smile:1.2), solo', source: 'user', operation: 'branch', expectedRevision: getNovelaiWork(work.id)!.revision })
    expect(branch.branched).toBe(true)
    const branches = listNovelaiBranches(work.id)
    expect(branches.length).toBe(2)
    // A branch is numbered after the version that opened it, so this one is 3 (the third version overall).
    expect(branches.map(item => item.number).sort()).toEqual([1, 3])

    // 3. Recycle-bin the branch; the tip stays live and keeps its number.
    softDeleteNovelaiVersions({ workId: work.id, versionIds: [branch.version.id], expectedRevision: getNovelaiWork(work.id)!.revision })
    expect(getNovelaiVersion(branch.version.id)!.deletedAt).toBeTruthy()
    expect(getNovelaiVersion(second.version.id)!.deletedAt).toBeNull()
    expect(listNovelaiDeletedVersions(work.id).map(item => item.id)).toContain(branch.version.id)

    // 4. Restore it — a restored version returns to the live line with its original number.
    // `restoreNovelaiVersions` takes a bare id list (the panel wraps it with the work/revision context).
    restoreNovelaiVersions([branch.version.id])
    expect(getNovelaiVersion(branch.version.id)!.deletedAt).toBeNull()
    expect(getNovelaiVersion(branch.version.id)!.number).toBe(3)
    expect(listNovelaiBranches(work.id).length).toBe(2)

    // 5. Soft delete again, then purge for real: the row is gone and never numbered again.
    softDeleteNovelaiVersions({ workId: work.id, versionIds: [branch.version.id], expectedRevision: getNovelaiWork(work.id)!.revision })
    purgeNovelaiVersion(branch.version.id)
    expect(getNovelaiVersion(branch.version.id)).toBeNull()
    expect(listNovelaiDeletedVersions(work.id)).toHaveLength(0)

    // 6. The surviving line is intact: one branch, numbers 1 and 2 unchanged.
    expect(listNovelaiBranches(work.id).length).toBe(1)
    expect(getNovelaiVersion(second.version.id)!.number).toBe(2)
    expect(getNovelaiWork(work.id)!.lastVersionId).not.toBe(branch.version.id)
  })
})
