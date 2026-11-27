import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { getPath: () => root },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
}))
import { closeDatabase, getDatabase, getResourceRoot, initDatabase } from '../database'
import { registerImagesIPC } from '../ipc/images.ipc'
import { registerMediaIPC } from '../ipc/media.ipc'
import { deleteImageArtifacts } from './image-asset.service'
import { batchDeleteMediaAssets, deleteMediaAsset, ensureMediaAsset, getMediaAsset } from './media.service'
import { batchRemoveFromLibrary } from './cherry-file-ipc.service'
import { createNovelaiWork, getNovelaiWork, linkNovelaiVersionImage, softDeleteNovelaiVersions } from './novelai-version.service'
import { deleteAiAttachment, getAiAttachment, importAiAttachment } from './ai-attachment.service'
import { createAiSession, deleteAiSession } from './ai-session.service'
import { clearWD14History, deleteWD14History, getWD14History, saveWD14History } from './wd14-history.service'
import { renameEntry } from './cherry-file-ipc.service'
import { runGroup } from './cache-cleanup.service'

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error('Missing handler: ' + channel)
  return handler({ sender: { send: () => undefined } }, ...args)
}
function image(id: number, mode: 'managed'|'external' = 'managed', existingPath?: string, hash: string|null = 'hash-' + id) {
  const file = existingPath || path.join(mode === 'managed' ? path.join(getResourceRoot(), 'images') : root, 'image-' + id + '.png')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from('fixture-image-' + id))
  const db = getDatabase()
  db.run('INSERT INTO image_refs (id,file_path,storage_mode,asset_hash,mime_type,file_size,original_name,available) VALUES (?,?,?,?,?,?,?,?)', [id, file, mode, hash, 'image/png', 15, path.basename(file), 1])
  const media = ensureMediaAsset(id)
  const derivative = path.join(getResourceRoot(), 'derivatives', String(id), 'thumbnail.jpg')
  fs.mkdirSync(path.dirname(derivative), { recursive: true })
  fs.writeFileSync(derivative, 'fixture-thumbnail')
  db.run('INSERT INTO image_derivatives (id,image_ref_id,kind,file_path,asset_hash,created_at) VALUES (?,?,?,?,?,?)', ['d-' + id, id, 'thumbnail', derivative, 'thumb-hash', new Date().toISOString()])
  return { id, file, derivative, mediaId: media.id }
}
function protect(id: number, trash = false) {
  for (let i = 0; i < 2; i++) {
    const { work, root: version } = createNovelaiWork({ name: 'protected-' + i, snapshot: 'portrait' })
    linkNovelaiVersionImage({ versionId: version.id, imageId: String(id) })
    if (trash) softDeleteNovelaiVersions({ workId: work.id, versionIds: [version.id], expectedRevision: getNovelaiWork(work.id)!.revision })
  }
}
function rows() {
  const db = getDatabase()
  return Object.fromEntries(['image_refs', 'media_assets', 'image_derivatives', 'novelai_work', 'novelai_version', 'novelai_version_image', 'novelai_asset_usage', 'ai_attachments'].map(table => [table, db.exec('SELECT * FROM ' + table + ' ORDER BY rowid')[0]?.values || []]))
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-image-deletion-'))
  await initDatabase()
  handlers.clear()
  registerImagesIPC()
  registerMediaIPC()
})
afterEach(() => { vi.restoreAllMocks(); closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('real image deletion boundaries (P1)', () => {
  it.each([false, true])('blocks real images:delete while active or trashed versions reference it (trash=%s)', async trash => {
    const target = image(1)
    protect(target.id, trash)
    const before = rows()
    await expect(call('images:delete', target.id)).rejects.toThrow(/ASSET_IN_USE|referenced/)
    expect(rows()).toEqual(before)
    expect(fs.readFileSync(target.file, 'utf8')).toBe('fixture-image-1')
    expect(fs.existsSync(target.derivative)).toBe(true)
  })

  it('also guards the lowest-level physical cleanup function', async () => {
    const target = image(1)
    protect(target.id)
    await expect(deleteImageArtifacts(target.id)).rejects.toThrow(/ASSET_IN_USE|referenced/)
    expect(fs.existsSync(target.file)).toBe(true)
    expect(fs.existsSync(target.derivative)).toBe(true)
  })

  it('guards media service single and whole-batch DB deletion before any row changes', () => {
    const free = image(1)
    const protectedImage = image(2)
    protect(2)
    const before = rows()
    expect(() => deleteMediaAsset(protectedImage.mediaId)).toThrow(/ASSET_IN_USE|referenced/)
    expect(() => batchDeleteMediaAssets([free.mediaId, protectedImage.mediaId])).toThrow(/ASSET_IN_USE|referenced/)
    expect(rows()).toEqual(before)
  })

  it('prechecks every media batch member before touching the first free file', async () => {
    const free = image(1)
    const protectedImage = image(2)
    protect(2)
    const before = rows()
    await expect(call('media:batchDelete', { ids: [free.mediaId, protectedImage.mediaId] })).rejects.toThrow(/ASSET_IN_USE|referenced/)
    expect(rows()).toEqual(before)
    expect(fs.existsSync(free.file)).toBe(true)
    expect(fs.existsSync(protectedImage.file)).toBe(true)
  })

  it('removes canonical image rows together with files in an unprotected physical media batch', async () => {
    const first = image(1)
    const second = image(2)
    expect(await call('media:batchDelete', { ids: [first.mediaId, second.mediaId] })).toBe(2)
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
    expect(getMediaAsset(first.mediaId)).toBeNull()
    expect(fs.existsSync(first.file)).toBe(false)
    expect(fs.existsSync(second.derivative)).toBe(false)
  })

  it.each(['same', 'different', null])('retains any other live path reference irrespective of asset hash (%s)', async hash => {
    const first = image(1, 'managed', undefined, 'same')
    image(2, 'external', first.file, hash)
    await call('images:delete', 1)
    expect(fs.existsSync(first.file)).toBe(true)
    expect(getDatabase().exec('SELECT id FROM image_refs')[0].values).toEqual([[2]])
  })

  it('keeps a source file when another live record reaches it through a directory alias', async () => {
    const target = image(1)
    const alias = path.join(root, 'alias')
    fs.symlinkSync(path.dirname(target.file), alias, process.platform === 'win32' ? 'junction' : 'dir')
    image(2, 'external', path.join(alias, path.basename(target.file)), null)
    await call('images:delete', 1)
    expect(fs.existsSync(target.file)).toBe(true)
  })

  it('does not claim deleted row ids after a database rollback', async () => {
    image(1)
    image(2)
    const before = rows()
    getDatabase().exec("CREATE TRIGGER fail_second_image_delete BEFORE DELETE ON image_refs WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'injected index failure'); END")
    const report = await call('images:deleteBatch', { ids: [1, 2] }) as { status: string; deletedIds: number[]; failures: Array<{ code: string }> }
    // IPC must return plain data: real Electron does not serialize custom Error fields.
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({ status: 'partial', deletedIds: [], failures: [{ code: 'IMAGE_DELETE_DB_FAILED' }, { code: 'IMAGE_DELETE_DB_FAILED' }] })
    expect(rows()).toEqual(before)
  })

  it('rejects an images root alias instead of trusting its redirected physical root', async () => {
    const externalRoot = path.join(root, 'outside-images')
    fs.mkdirSync(externalRoot)
    fs.mkdirSync(getResourceRoot(), { recursive: true })
    fs.symlinkSync(externalRoot, path.join(getResourceRoot(), 'images'), process.platform === 'win32' ? 'junction' : 'dir')
    const target = image(1)
    const before = rows()
    const report = await call('images:deleteBatch', { ids: [1] }) as { status: string }
    expect(report.status).toBe('failed')
    expect(rows()).toEqual(before)
    expect(fs.existsSync(target.file)).toBe(true)
  })

  it('keeps derivative cleanup separate from the original images physical area', async () => {
    const protectedImage = image(2, 'managed', path.join(getResourceRoot(), 'images', '10', 'protected.png'))
    protect(2)
    image(10)
    const derivatives = path.join(getResourceRoot(), 'derivatives')
    fs.rmSync(derivatives, { recursive: true })
    fs.symlinkSync(path.join(getResourceRoot(), 'images'), derivatives, process.platform === 'win32' ? 'junction' : 'dir')
    const report = await call('images:deleteBatch', { ids: [10] }) as { status: string }
    expect(report.status).toBe('partial')
    expect(fs.existsSync(protectedImage.file)).toBe(true)
    expect(getDatabase().exec('SELECT id FROM image_refs ORDER BY id')[0].values).toEqual([[2], [10]])
  })

  it('retains a derivative file that another live image record uses as its original', async () => {
    const free = image(1)
    image(2, 'external', free.derivative)
    protect(2)
    const report = await call('images:deleteBatch', { ids: [1] }) as { status: string }
    expect(report.status).toBe('completed')
    expect(fs.readFileSync(free.derivative, 'utf8')).toBe('fixture-thumbnail')
    expect(getDatabase().exec('SELECT id FROM image_refs')[0].values).toEqual([[2]])
  })

  it.each(['files', 'attachment', 'session'])('retains an uploaded attachment file used by a protected image when deleting %s', async method => {
    const session = createAiSession({ title: 'shared source' })
    const source = path.join(root, 'upload.png')
    fs.writeFileSync(source, 'fixture-uploaded-image')
    const attachment = await importAiAttachment({ sessionId: session.id, filePath: source })
    image(1, 'external', attachment.file_path)
    protect(1)
    const unlink = vi.spyOn(fs.promises, 'unlink')
    if (method === 'files') batchRemoveFromLibrary(['attachment:' + attachment.id])
    else if (method === 'attachment') deleteAiAttachment(attachment.id)
    else deleteAiSession(session.id)
    expect(unlink).not.toHaveBeenCalledWith(attachment.file_path)
    expect(fs.readFileSync(attachment.file_path, 'utf8')).toBe('fixture-uploaded-image')
    expect(getDatabase().exec('SELECT id FROM image_refs')[0].values).toEqual([[1]])
  })

  it('allows a legacy media batch retry with the same ids after a partial cleanup', async () => {
    const first = image(1)
    const second = image(2)
    const original = fs.rmSync
    const cleanup = vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file) === second.file) throw Object.assign(new Error('locked second file'), { code: 'EBUSY' })
      return original(file, options)
    })
    await expect(call('media:batchDelete', { ids: [first.mediaId, second.mediaId] })).rejects.toThrow(/IMAGE_CLEANUP_FAILED/)
    cleanup.mockRestore()
    expect(await call('media:batchDelete', { ids: [first.mediaId, second.mediaId] })).toBe(1)
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
  })

  it('preserves a serializable cleanup report when SQLite already rolled its transaction back', async () => {
    image(1)
    image(2)
    const before = rows()
    getDatabase().exec("CREATE TRIGGER rollback_second_image_delete BEFORE DELETE ON image_refs WHEN OLD.id=2 BEGIN SELECT RAISE(ROLLBACK,'automatic rollback fixture'); END")
    const report = await call('images:deleteBatch', { ids: [1, 2] }) as { status: string; deletedIds: number[]; failures: Array<{ code: string }> }
    expect(report).toMatchObject({ status: 'partial', deletedIds: [], failures: [{ code: 'IMAGE_DELETE_DB_FAILED' }, { code: 'IMAGE_DELETE_DB_FAILED' }] })
    expect(rows()).toEqual(before)
  })

  it('returns the live requested ids without changing the library', async () => {
    image(1)
    image(2)
    const before = rows()
    expect(await call('images:existingIds', { ids: [1, 2, 99, 1] })).toEqual([1, 2])
    expect(rows()).toEqual(before)
  })

  it.each(['delete', 'clear'])('retains WD14 snapshot bytes reused as a protected original during history %s', method => {
    image(1)
    getDatabase().run('INSERT INTO task_jobs (id,kind,status,input_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['history-task', 'wd14', 'succeeded', '{}', 'now', 'now'])
    const history = saveWD14History({ taskId: 'history-task', imageId: 1 })
    image(2, 'external', history.image_snapshot_path!)
    protect(2)
    if (method === 'delete') deleteWD14History(history.id)
    else clearWD14History()
    expect(fs.existsSync(history.image_snapshot_path!)).toBe(true)
    expect(getDatabase().exec('SELECT id FROM image_refs ORDER BY id')[0].values).toEqual([[1], [2]])
  })

  it('keeps the WD14 history index when its required snapshot cleanup fails', () => {
    image(1)
    getDatabase().run('INSERT INTO task_jobs (id,kind,status,input_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['history-task', 'wd14', 'succeeded', '{}', 'now', 'now'])
    const history = saveWD14History({ taskId: 'history-task', imageId: 1 })
    const original = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file) === history.image_snapshot_path) throw new Error('locked snapshot fixture')
      return original(file, options)
    })
    expect(() => deleteWD14History(history.id)).toThrow(/CLEANUP_FAILED/)
    expect(getWD14History(history.id)).not.toBeNull()
    expect(fs.existsSync(history.image_snapshot_path!)).toBe(true)
  })

  it.each(['attachment', 'session'])('keeps its deletion index when required AI copy cleanup fails (%s)', async method => {
    const session = createAiSession({ title: 'retained cleanup index' })
    const source = path.join(root, 'locked-copy.png')
    fs.writeFileSync(source, 'fixture-locked-copy')
    const attachment = await importAiAttachment({ sessionId: session.id, filePath: source })
    const unlink = fs.unlinkSync
    vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
      if (String(file) === attachment.file_path) throw new Error('locked attachment fixture')
      return unlink(file)
    })
    expect(() => method === 'attachment' ? deleteAiAttachment(attachment.id) : deleteAiSession(session.id)).toThrow(/AI_ATTACHMENT_CLEANUP_FAILED/)
    expect(getAiAttachment(attachment.id)?.status).toBe('available')
    expect(fs.existsSync(attachment.file_path)).toBe(true)
    expect(getDatabase().exec('SELECT id FROM ai_sessions WHERE id=?', [session.id])[0].values).toEqual([[session.id]])
  })

  it('blocks renaming an uploaded copy already used by a protected image', async () => {
    const source = path.join(root, 'rename-source.png')
    fs.writeFileSync(source, 'fixture-original-copy')
    const attachment = await importAiAttachment({ sessionId: null, filePath: source })
    image(1, 'external', attachment.file_path)
    protect(1)
    const before = rows()
    expect(await renameEntry('attachment:' + attachment.id, 'changed')).toMatchObject({ ok: false })
    expect(rows()).toEqual(before)
    expect(fs.readFileSync(attachment.file_path, 'utf8')).toBe('fixture-original-copy')
  })

  it('blocks rename from replacing a different uploaded image original', async () => {
    const p = path.join(root, 'P.png'); const q = path.join(root, 'Q.png')
    fs.writeFileSync(p, 'original-P'); fs.writeFileSync(q, 'different-Q')
    const first = await importAiAttachment({ sessionId: null, filePath: p })
    expect(await renameEntry('attachment:' + first.id, 'keep')).toEqual({ ok: true })
    const kept = getAiAttachment(first.id)!
    image(1, 'external', kept.file_path); protect(1)
    const second = await importAiAttachment({ sessionId: null, filePath: q })
    const before = rows()
    expect(await renameEntry('attachment:' + second.id, 'keep')).toMatchObject({ ok: false })
    expect(rows()).toEqual(before)
    expect(fs.readFileSync(kept.file_path, 'utf8')).toBe('original-P')
  })

  it('returns previous Files successes when a later image record deletion fails', () => {
    image(1, 'external'); image(2, 'external')
    getDatabase().exec("CREATE TRIGGER fail_files_delete BEFORE DELETE ON image_refs WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'files index failure'); END")
    const result = batchRemoveFromLibrary(['image_ref:1', 'image_ref:2'])
    expect(result.succeeded).toEqual(['image_ref:1'])
    expect(result.failed).toEqual([{ id: 'image_ref:2', error: 'files index failure' }])
    expect(getDatabase().exec('SELECT id FROM image_refs')[0].values).toEqual([[2]])
  })

  it('reports observed partial derivative cleanup when the original is retained', async () => {
    const target = image(1, 'external')
    const preview = path.join(path.dirname(target.derivative), 'preview.jpg')
    fs.writeFileSync(preview, 'retained preview')
    const rm = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file) === path.dirname(target.derivative)) { fs.unlinkSync(target.derivative); throw new Error('locked remaining preview') }
      return rm(file, options)
    })
    const result = await call('images:deleteBatch', { ids: [1] }) as { status: string; cleanup: Array<{ status: string; stages: Array<{ stage: string; removedPaths?: string[] }> }> }
    expect(result.status).toBe('partial')
    expect(result.cleanup[0].status).toBe('partial')
    expect(result.cleanup[0].stages.find(stage => stage.stage === 'derivatives')?.removedPaths).toContain('thumbnail.jpg')
    expect(getDatabase().exec('SELECT id FROM image_refs')[0].values).toEqual([[1]])
    expect(fs.existsSync(target.file)).toBe(true)
  })

  it('retains an owned cache directory containing a live image original', () => {
    const temp = path.join(root, 'owned-cache'); fs.mkdirSync(temp)
    const target = path.join(temp, 'grimoire-comfy-fixture'); fs.mkdirSync(target)
    image(1, 'external', path.join(target, 'cached-original.png')); protect(1)
    vi.spyOn(os, 'tmpdir').mockReturnValue(temp)
    expect(runGroup('normal_cache')).toBe('failed')
    expect(fs.existsSync(path.join(target, 'cached-original.png'))).toBe(true)
  })

  it.each(['attachment', 'session'])('retains the AI index and carries cleanup counts when DB finalization fails (%s)', async method => {
    const session = createAiSession({ title: 'db cleanup failure' })
    const source = path.join(root, 'db-copy.png'); fs.writeFileSync(source, 'db-copy-fixture')
    const attachment = await importAiAttachment({ sessionId: session.id, filePath: source })
    if (method === 'attachment') getDatabase().exec("CREATE TRIGGER fail_attachment_finalize BEFORE UPDATE ON ai_attachments BEGIN SELECT RAISE(ABORT,'attachment index failure'); END")
    else getDatabase().exec("CREATE TRIGGER fail_session_finalize BEFORE DELETE ON ai_sessions BEGIN SELECT RAISE(ABORT,'session index failure'); END")
    expect(() => method === 'attachment' ? deleteAiAttachment(attachment.id) : deleteAiSession(session.id)).toThrow(/AI_ATTACHMENT_DELETE_DB_FAILED: partial; removed=1/)
    expect(getAiAttachment(attachment.id)?.status).toBe('available')
    expect(getDatabase().exec('SELECT id FROM ai_sessions WHERE id=?', [session.id])[0].values).toEqual([[session.id]])
    expect(fs.existsSync(attachment.file_path)).toBe(false)
  })

  it('retains the WD14 index and carries counts after snapshot cleanup followed by a DB failure', () => {
    image(1)
    getDatabase().run('INSERT INTO task_jobs (id,kind,status,input_json,created_at,updated_at) VALUES (?,?,?,?,?,?)', ['history-db-task', 'wd14', 'succeeded', '{}', 'now', 'now'])
    const history = saveWD14History({ taskId: 'history-db-task', imageId: 1 })
    getDatabase().exec("CREATE TRIGGER fail_history_finalize BEFORE DELETE ON wd14_history BEGIN SELECT RAISE(ABORT,'history index failure'); END")
    expect(() => deleteWD14History(history.id)).toThrow(/WD14_HISTORY_DELETE_DB_FAILED: partial; removed=1/)
    expect(getWD14History(history.id)).not.toBeNull()
    expect(fs.existsSync(history.image_snapshot_path!)).toBe(false)
  })

  it('keeps external original bytes when the library reference is deleted', async () => {
    const target = image(1, 'external')
    expect(await call('images:delete', 1)).toBe(true)
    expect(fs.readFileSync(target.file, 'utf8')).toBe('fixture-image-1')
    expect(getDatabase().exec('SELECT count(*) FROM image_refs')[0].values[0][0]).toBe(0)
  })

  it('prechecks image references in a mixed Files batch before removing any attachment', () => {
    image(1, 'external')
    protect(1)
    const attachment = path.join(root, 'attachment-copy.txt')
    fs.writeFileSync(attachment, 'retained attachment')
    getDatabase().run('INSERT INTO ai_attachments (id,session_id,message_id,source_type,file_path,original_name,mime_type,size,sha256,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['att', null, null, 'file', attachment, 'copy.txt', 'text/plain', 19, 'fixture', 'available', '{}', 'now', 'now'])
    const before = rows()
    const result = batchRemoveFromLibrary(['attachment:att', 'image_ref:1'])
    expect(result.succeeded).toEqual([])
    expect(result.failed.length).toBeGreaterThan(0)
    expect(rows()).toEqual(before)
    expect(fs.readFileSync(attachment, 'utf8')).toBe('retained attachment')
  })

  it('provides one main-owned image batch endpoint with duplicate ids deduplicated', async () => {
    const target = image(1)
    const report = await call('images:deleteBatch', { ids: [1, 1] }) as { status: string; deletedIds: number[] }
    expect(report.status).toBe('completed')
    expect(report.deletedIds).toEqual([1])
    expect(fs.existsSync(target.file)).toBe(false)
  })

  it('rejects missing batch members and malformed image ids before any cleanup', async () => {
    const target = image(1)
    const before = rows()
    await expect(call('images:deleteBatch', { ids: [1, 999] })).rejects.toThrow(/IMAGE_NOT_FOUND/)
    for (const invalid of [0, -1, 1.5, 'image:1', '1x', Number.MAX_SAFE_INTEGER + 1]) {
      await expect(call('images:deleteBatch', { ids: [1, invalid] })).rejects.toThrow(/INVALID_IMAGE_ID/)
    }
    expect(rows()).toEqual(before)
    expect(fs.existsSync(target.file)).toBe(true)
  })

  it('retains rows and reports cleanup failure instead of reporting success', async () => {
    const target = image(1)
    const original = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file) === target.file) throw Object.assign(new Error('fixture locked image'), { code: 'EBUSY' })
      return original(file, options)
    })
    const before = rows()
    const report = await call('images:deleteBatch', { ids: [1] }) as { status: string; deletedIds: number[]; failures: Array<{ code: string }> }
    expect(report.status).toBe('failed')
    expect(report.deletedIds).toEqual([])
    expect(report.failures[0].code).toBe('IMAGE_CLEANUP_FAILED')
    expect(rows()).toEqual(before)
    expect(fs.existsSync(target.file)).toBe(true)
    expect(fs.existsSync(target.derivative)).toBe(true)
  })

  it('reports partial disk cleanup and leaves its row available for retry', async () => {
    const target = image(1)
    const original = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file) === path.dirname(target.derivative)) throw Object.assign(new Error('fixture locked thumbnail'), { code: 'EBUSY' })
      return original(file, options)
    })
    const report = await call('images:deleteBatch', { ids: [1] }) as { status: string; deletedIds: number[]; cleanup: Array<{ status: string; removedFile: boolean }> }
    expect(report.status).toBe('partial')
    expect(report.deletedIds).toEqual([])
    expect(report.cleanup[0]).toMatchObject({ status: 'partial', removedFile: true })
    expect(getDatabase().exec('SELECT id FROM image_refs')[0].values).toEqual([[1]])
  })
})
