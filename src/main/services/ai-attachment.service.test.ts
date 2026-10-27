import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

import { closeDatabase, initDatabase } from '../database'
import { createAiSession } from './ai-session.service'
import { deleteAiAttachment, importAiAttachment, listAiAttachments, readAiAttachment } from './ai-attachment.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-ai-attachment-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('AI attachment service', () => {
  it('stores managed attachments, deduplicates by hash, and removes them', async () => {
    await initDatabase()
    const session = createAiSession({ title: '附件会话' })
    const source = path.join(root, 'notes.md')
    fs.writeFileSync(source, '# hello')
    const first = await importAiAttachment({ sessionId: session.id, filePath: source })
    const duplicate = await importAiAttachment({ sessionId: session.id, filePath: source })
    expect(duplicate.id).toBe(first.id)
    expect(listAiAttachments(session.id)).toHaveLength(1)
    expect(deleteAiAttachment(first.id)).toBe(true)
    expect(listAiAttachments(session.id)[0].status).toBe('deleted')
  })

  it('rejects an attachment larger than the safe single-file limit', async () => {
    await initDatabase()
    const session = createAiSession({ title: '大附件会话' })
    const source = path.join(root, 'large.bin')
    fs.writeFileSync(source, Buffer.alloc(100 * 1024 * 1024 + 1))
    await expect(importAiAttachment({ sessionId: session.id, filePath: source })).rejects.toThrow('100MB')
  })

  it('keeps the managed file until the owning session is deleted', async () => {
    await initDatabase()
    const session = createAiSession({ title: '清理会话' })
    const source = path.join(root, 'cleanup.txt')
    fs.writeFileSync(source, 'cleanup')
    const attachment = await importAiAttachment({ sessionId: session.id, filePath: source })
    expect(fs.existsSync(attachment.file_path)).toBe(true)
    const { deleteAiSession } = await import('./ai-session.service')
    expect(deleteAiSession(session.id)).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fs.existsSync(attachment.file_path)).toBe(false)
  })

  it('reads text and image attachments without exposing their filesystem path', async () => {
    await initDatabase()
    const session = createAiSession({ title: '预览会话' })
    const textSource = path.join(root, 'preview.txt')
    fs.writeFileSync(textSource, 'preview content', 'utf8')
    const textAttachment = await importAiAttachment({ sessionId: session.id, filePath: textSource })
    await expect(readAiAttachment(textAttachment.id)).resolves.toMatchObject({ text: 'preview content', status: 'available' })
    const imageSource = path.join(root, 'preview.png')
    fs.writeFileSync(imageSource, Buffer.from([137, 80, 78, 71]))
    const imageAttachment = await importAiAttachment({ sessionId: session.id, filePath: imageSource })
    const preview = await readAiAttachment(imageAttachment.id)
    expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/) 
    expect(preview).not.toHaveProperty('filePath')
  })

  it('shares a managed file across sessions and deletes it only after the last reference', async () => {
    await initDatabase()
    const firstSession = createAiSession({ title: '一' })
    const secondSession = createAiSession({ title: '二' })
    const source = path.join(root, 'shared.txt')
    fs.writeFileSync(source, 'shared', 'utf8')
    const first = await importAiAttachment({ sessionId: firstSession.id, filePath: source })
    const second = await importAiAttachment({ sessionId: secondSession.id, filePath: source })
    expect(second.file_path).toBe(first.file_path)
    expect(deleteAiAttachment(first.id)).toBe(true)
    expect(fs.existsSync(first.file_path)).toBe(true)
    expect(deleteAiAttachment(second.id)).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fs.existsSync(first.file_path)).toBe(false)
  })
})
