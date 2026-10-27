import crypto from 'node:crypto'

import { getDatabase, saveDatabase } from '../database'

// NovelAI prompt work/version repository (M6.2). Shape follows the reference tool's model, code
// is ours. Invariants enforced here rather than in the UI:
//  * `parent_id` and `branch_id` always belong to the same work;
//  * `snapshot` (raw prompt text) is the only authority;
//  * every mutation takes an `expectedRevision` so two editors cannot silently overwrite;
//  * an unchanged snapshot does not create an empty version;
//  * a new version whose parent already has children starts its own branch.
export type NovelaiVersionSource = 'user' | 'agent'

export interface NovelaiWork {
  id: string
  name: string
  originSnapshot: string | null
  saved: boolean
  lastVersionId: string | null
  revision: number
  createdAt: string
  lastUsedAt: string
}

export interface NovelaiVersion {
  id: string
  workId: string
  parentId: string | null
  number: number
  branchId: string
  branchNumber: number
  snapshot: string
  source: NovelaiVersionSource
  operation: string
  createdAt: string
}

export class NovelaiVersionError extends Error {
  constructor(readonly code: 'WORK_NOT_FOUND' | 'VERSION_NOT_FOUND' | 'CROSS_WORK_PARENT' | 'REVISION_CONFLICT' | 'INVALID_INPUT', message: string) {
    super(message)
    this.name = 'NovelaiVersionError'
  }
}

const now = (): string => new Date().toISOString()
const id = (prefix: string): string => prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)

function text(value: unknown, field: string, max = 200_000): string {
  if (typeof value !== 'string') throw new NovelaiVersionError('INVALID_INPUT', field + ' must be a string')
  if (value.length > max) throw new NovelaiVersionError('INVALID_INPUT', field + ' is too long')
  return value
}

function rowToWork(row: unknown[]): NovelaiWork {
  return {
    id: String(row[0]),
    name: String(row[1]),
    originSnapshot: row[2] === null ? null : String(row[2]),
    saved: Number(row[3]) === 1,
    lastVersionId: row[4] === null ? null : String(row[4]),
    revision: Number(row[5]),
    createdAt: String(row[6]),
    lastUsedAt: String(row[7]),
  }
}

const WORK_COLUMNS = 'id,name,origin_snapshot,saved,last_version_id,revision,created_at,last_used_at'

export function getNovelaiWork(workId: string): NovelaiWork | null {
  const row = getDatabase().exec('SELECT ' + WORK_COLUMNS + ' FROM novelai_work WHERE id=?', [workId])[0]?.values?.[0]
  return row ? rowToWork(row) : null
}

export function listNovelaiWorks(): NovelaiWork[] {
  const rows = getDatabase().exec('SELECT ' + WORK_COLUMNS + ' FROM novelai_work ORDER BY last_used_at DESC, id ASC')[0]?.values ?? []
  return rows.map(rowToWork)
}

function rowToVersion(row: unknown[]): NovelaiVersion {
  return {
    id: String(row[0]),
    workId: String(row[1]),
    parentId: row[2] === null ? null : String(row[2]),
    number: Number(row[3]),
    branchId: String(row[4]),
    branchNumber: Number(row[5]),
    snapshot: String(row[6]),
    source: String(row[7]) === 'agent' ? 'agent' : 'user',
    operation: String(row[8]),
    createdAt: String(row[9]),
  }
}

const VERSION_COLUMNS = 'id,work_id,parent_id,number,branch_id,branch_number,snapshot,source,operation,created_at'

export function getNovelaiVersion(versionId: string): NovelaiVersion | null {
  const row = getDatabase().exec('SELECT ' + VERSION_COLUMNS + ' FROM novelai_version WHERE id=?', [versionId])[0]?.values?.[0]
  return row ? rowToVersion(row) : null
}

function insertVersion(input: { workId: string; parentId: string | null; number: number; branchId: string; branchNumber: number; snapshot: string; source: NovelaiVersionSource; operation: string; versionId?: string }): NovelaiVersion {
  const versionId = input.versionId || id('nai_v')
  getDatabase().run(
    'INSERT INTO novelai_version (id,work_id,parent_id,number,branch_id,branch_number,snapshot,source,operation,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [versionId, input.workId, input.parentId, input.number, input.branchId, input.branchNumber, input.snapshot, input.source, input.operation, now()],
  )
  return getNovelaiVersion(versionId)!
}

export function createNovelaiWork(input: { name: string; snapshot: string }): { work: NovelaiWork; root: NovelaiVersion } {
  const name = text(input.name, 'name', 120).trim()
  if (!name) throw new NovelaiVersionError('INVALID_INPUT', 'work name is required')
  const snapshot = text(input.snapshot, 'snapshot')
  const workId = id('nai_w')
  const versionId = id('nai_v')
  const created = now()
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.run('INSERT INTO novelai_work (id,name,origin_snapshot,saved,last_version_id,revision,created_at,last_used_at) VALUES (?,?,?,0,?,1,?,?)', [workId, name, snapshot, versionId, created, created])
    const root = insertVersion({ workId, parentId: null, number: 1, branchId: versionId, branchNumber: 1, snapshot, source: 'user', operation: 'create', versionId })
    db.exec('COMMIT')
    saveDatabase()
    return { work: getNovelaiWork(workId)!, root }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
}

function childCount(versionId: string): number {
  return Number(getDatabase().exec('SELECT count(*) FROM novelai_version WHERE parent_id=?', [versionId])[0]?.values?.[0]?.[0] ?? 0)
}

export interface NewVersionInput {
  workId: string
  parentVersionId: string
  snapshot: string
  source?: NovelaiVersionSource
  operation?: string
  expectedRevision: number
}

export function createNovelaiVersion(input: NewVersionInput): { version: NovelaiVersion; branched: boolean; unchanged: boolean } {
  const work = getNovelaiWork(input.workId)
  if (!work) throw new NovelaiVersionError('WORK_NOT_FOUND', 'work not found')
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== work.revision) {
    throw new NovelaiVersionError('REVISION_CONFLICT', 'work changed since revision ' + input.expectedRevision)
  }
  const parent = getNovelaiVersion(input.parentVersionId)
  if (!parent) throw new NovelaiVersionError('VERSION_NOT_FOUND', 'parent version not found')
  if (parent.workId !== work.id) throw new NovelaiVersionError('CROSS_WORK_PARENT', 'parent version belongs to another work')
  const snapshot = text(input.snapshot, 'snapshot')
  if (snapshot === parent.snapshot) return { version: parent, branched: false, unchanged: true }
  const db = getDatabase()
  const nextNumber = Number(db.exec('SELECT coalesce(max(number),0)+1 FROM novelai_version WHERE work_id=?', [work.id])[0].values[0][0])
  const branched = childCount(parent.id) > 0
  const versionId = id('nai_v')
  const branchId = branched ? versionId : parent.branchId
  const branchNumber = branched ? parent.branchNumber + 1 : parent.branchNumber
  db.exec('BEGIN IMMEDIATE')
  try {
    const version = insertVersion({ workId: work.id, parentId: parent.id, number: nextNumber, branchId, branchNumber, snapshot, source: input.source === 'agent' ? 'agent' : 'user', operation: text(input.operation ?? '', 'operation', 200), versionId })
    db.run('UPDATE novelai_work SET last_version_id=?, last_used_at=?, revision=revision+1 WHERE id=?', [version.id, now(), work.id])
    db.exec('COMMIT')
    saveDatabase()
    return { version, branched, unchanged: false }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
}

/**
 * The line a user sees for one branch: the path from the root down to that branch's newest
 * version, oldest first. A fork's own branch starts at the fork, so this deliberately walks
 * ancestors instead of filtering by `branch_id` — filtering would hide the shared history the
 * version bar is supposed to show.
 */
export function listNovelaiBranchLine(workId: string, branchId?: string): NovelaiVersion[] {
  const work = getNovelaiWork(workId)
  if (!work) throw new NovelaiVersionError('WORK_NOT_FOUND', 'work not found')
  const targetBranch = branchId || (work.lastVersionId ? getNovelaiVersion(work.lastVersionId)?.branchId : undefined)
  if (!targetBranch) return []
  const newest = getDatabase().exec('SELECT ' + VERSION_COLUMNS + ' FROM novelai_version WHERE work_id=? AND branch_id=? ORDER BY number DESC LIMIT 1', [workId, targetBranch])[0]?.values?.[0]
  if (!newest) return []
  const line: NovelaiVersion[] = []
  let cursor: NovelaiVersion | null = rowToVersion(newest)
  const guard = new Set<string>()
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id)
    line.push(cursor)
    cursor = cursor.parentId ? getNovelaiVersion(cursor.parentId) : null
  }
  return line.reverse()
}

export function setNovelaiBranchName(workId: string, branchId: string, name: string): void {
  const work = getNovelaiWork(workId)
  if (!work) throw new NovelaiVersionError('WORK_NOT_FOUND', 'work not found')
  const branch = getNovelaiVersion(branchId)
  if (!branch || branch.workId !== workId) throw new NovelaiVersionError('VERSION_NOT_FOUND', 'branch not found in this work')
  const clean = text(name, 'name', 60).trim()
  if (!clean) throw new NovelaiVersionError('INVALID_INPUT', 'branch name is required')
  getDatabase().run('INSERT INTO novelai_branch_name (branch_id,work_id,name,created_at) VALUES (?,?,?,?) ON CONFLICT(branch_id) DO UPDATE SET name=excluded.name', [branchId, workId, clean, now()])
  saveDatabase()
}

export function getNovelaiBranchName(branchId: string): string | null {
  const row = getDatabase().exec('SELECT name FROM novelai_branch_name WHERE branch_id=?', [branchId])[0]?.values?.[0]
  return row ? String(row[0]) : null
}

export function linkNovelaiVersionImage(input: { versionId: string; imageId: string; seed?: number | null; variant?: string }): void {
  const version = getNovelaiVersion(input.versionId)
  if (!version) throw new NovelaiVersionError('VERSION_NOT_FOUND', 'version not found')
  const imageId = text(input.imageId, 'imageId', 200)
  const sort = Number(getDatabase().exec('SELECT coalesce(max(sort),-1)+1 FROM novelai_version_image WHERE version_id=?', [version.id])[0].values[0][0])
  getDatabase().run('INSERT OR IGNORE INTO novelai_version_image (id,version_id,image_id,seed,variant,sort) VALUES (?,?,?,?,?,?)', [id('nai_vi'), version.id, imageId, input.seed ?? null, input.variant ?? '', sort])
  saveDatabase()
}

export function listNovelaiVersionImages(versionId: string): Array<{ id: string; versionId: string; imageId: string; seed: number | null; variant: string; sort: number }> {
  const rows = getDatabase().exec('SELECT id,version_id,image_id,seed,variant,sort FROM novelai_version_image WHERE version_id=? ORDER BY sort ASC, id ASC', [versionId])[0]?.values ?? []
  return rows.map(row => ({ id: String(row[0]), versionId: String(row[1]), imageId: String(row[2]), seed: row[3] === null ? null : Number(row[3]), variant: String(row[4]), sort: Number(row[5]) }))
}

/** 「这张图出现在哪些版本」— the reverse lookup the reference tool does not provide. */
export function listNovelaiVersionsByImage(imageId: string): NovelaiVersion[] {
  const rows = getDatabase().exec(
    'SELECT v.' + VERSION_COLUMNS.replace(/,/g, ',v.') + ' FROM novelai_version v JOIN novelai_version_image i ON i.version_id=v.id WHERE i.image_id=? ORDER BY v.created_at DESC',
    [imageId],
  )[0]?.values ?? []
  return rows.map(rowToVersion)
}
