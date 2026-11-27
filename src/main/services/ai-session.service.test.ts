import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { appendAiEvent, appendAiMessage, branchAiSession, createAiPermission, createAiSession, deleteAiMessage, deleteAiSession, getAiMessage, getAiSession, importAiSessionSnapshot, listAiSessions, resolveAiPermission, updateAiMessage } from './ai-session.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-ai-session-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('unified AI session service', () => {
  it('creates messages and events in independent ordered streams', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'agent', runtime: 'openai-compatible', modelId: 'test-model', title: '测试 Agent' })
    appendAiMessage({ sessionId: session.id, role: 'user', content: { text: '你好' } })
    appendAiMessage({ sessionId: session.id, role: 'assistant', content: { text: '你好，我是 Agent' } })
    appendAiEvent({ sessionId: session.id, eventType: 'completed', payload: { text: '完成' } })
    const loaded = getAiSession(session.id)
    expect(loaded?.messages.map(item => item.sequence)).toEqual([0, 1])
    expect(loaded?.events[0].event_type).toBe('completed')
  })

  it('branches a session and preserves its message/event history', async () => {
    await initDatabase()
    const source = createAiSession({ kind: 'chat', title: '源会话' })
    appendAiMessage({ sessionId: source.id, role: 'user', content: { text: '源消息' } })
    appendAiEvent({ sessionId: source.id, eventType: 'text-delta', payload: { text: '源事件' } })
    const branch = branchAiSession({ sessionId: source.id })
    const loaded = getAiSession(branch.id)
    expect(branch.parent_id).toBe(source.id)
    expect(loaded?.messages).toHaveLength(1)
    expect(loaded?.events).toHaveLength(1)
  })

  it('does not reuse the parent native runtime reference when branching', async () => {
    await initDatabase()
    const source = createAiSession({ runtime: 'opencode', metadata: { runtimeSessionId: 'remote-parent' } })
    const branch = branchAiSession({ sessionId: source.id })
    expect(branch.metadata.runtimeSessionId).toBeUndefined()
    expect(getAiSession(source.id)!.session.metadata.runtimeSessionId).toBe('remote-parent')
  })

  it('supports searching and cascading deletion', async () => {
    await initDatabase()
    const session = createAiSession({ title: '可搜索会话' })
    expect(listAiSessions({ query: '搜索' }).map(item => item.id)).toContain(session.id)
    expect(deleteAiSession(session.id)).toBe(true)
    expect(getAiSession(session.id)).toBeNull()
  })

  it('persists permission requests and their final decision', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'agent' })
    const request = createAiPermission({ sessionId: session.id, requestId: 'req_test', permission: 'write', detail: { path: 'demo.txt' } })
    expect(request.decision).toBe('pending')
    const resolved = resolveAiPermission({ requestId: 'req_test', decision: 'allowOnce' })
    expect(resolved).toMatchObject({ request_id: 'req_test', permission: 'write', decision: 'allowOnce' })
    expect(resolved?.resolved_at).toBeTruthy()
    const late = resolveAiPermission({ requestId: 'req_test', decision: 'deny' })
    expect(late?.decision).toBe('allowOnce')
  })

  it('edits and deletes messages without changing the session identity', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat' })
    const message = appendAiMessage({ sessionId: session.id, role: 'user', content: { text: '原始内容' } })
    const edited = updateAiMessage({ id: message.id, content: { text: '编辑后的内容' } })
    expect(getAiMessage(message.id)?.content).toMatchObject({ text: '编辑后的内容' })
    expect(edited.session_id).toBe(session.id)
    expect(deleteAiMessage(message.id)).toBe(true)
    expect(getAiMessage(message.id)).toBeNull()
    expect(getAiSession(session.id)?.session.id).toBe(session.id)
  })

  it('imports attachment metadata as explicit missing references', async () => {
    await initDatabase()
    const imported = importAiSessionSnapshot({
      session: { title: '带附件的导入会话' },
      messages: [{ role: 'user', content: { text: '查看附件' }, attachments: [{ attachmentId: 'old-attachment' }] }],
      attachments: [{ id: 'old-attachment', source_type: 'pdf', original_name: 'manual.pdf', mime_type: 'application/pdf', size: 123, sha256: 'deadbeef', status: 'available' }],
    })
    const loaded = getAiSession(imported.id)
    expect(loaded?.messages[0].attachments).toEqual([expect.objectContaining({ attachmentId: expect.stringMatching(/^ai_attachment_imported_/) })])
    const attachments = (await import('../services/ai-attachment.service')).listAiAttachments(imported.id)
    expect(attachments).toMatchObject([{ original_name: 'manual.pdf', status: 'missing', message_id: loaded?.messages[0].id }])
  })

  it('keeps Cherry resource archive and pin state separate from permanent deletion', async () => {
    await initDatabase()
    const session = createAiSession({ kind: 'chat', title: '资源状态会话' })

    const { archiveAiSession, pinAiSession, restoreAiSession } = await import('./ai-session.service')
    const pinned = pinAiSession(session.id, true)
    expect(pinned.pinned).toBe(true)
    expect(listAiSessions().map(item => item.id)).toContain(session.id)

    const archived = archiveAiSession(session.id)
    expect(archived.archived).toBe(true)
    expect(listAiSessions().map(item => item.id)).not.toContain(session.id)
    expect(listAiSessions({ includeArchived: true }).find(item => item.id === session.id)?.archived).toBe(true)

    const restored = restoreAiSession(session.id)
    expect(restored.archived).toBe(false)
    expect(restored.pinned).toBe(true)
    expect(getAiSession(session.id)?.session.id).toBe(session.id)
  })

  it('reorders sessions by fractional anchors without touching other rows', async () => {
    await initDatabase()
    const { reorderAiSession } = await import('./ai-session.service')
    const a = createAiSession({ kind: 'chat', title: 'A' })
    const b = createAiSession({ kind: 'chat', title: 'B' })
    const c = createAiSession({ kind: 'chat', title: 'C' })
    const order = () => listAiSessions({ limit: 10, manualOrder: true }).map(item => item.id)

    const before = order()
    // Move C to the front, then A to the end, then B between the two.
    reorderAiSession({ id: c.id, overId: a.id, position: 'before' })
    expect(order()[0]).toBe(c.id)
    reorderAiSession({ id: a.id, overId: c.id, position: 'after' })
    reorderAiSession({ id: b.id, overId: a.id, position: 'after' })
    const after = order()
    expect(new Set(after)).toEqual(new Set(before))
    expect(after.indexOf(b.id)).toBe(after.indexOf(a.id) + 1)

    // Drop onto a group appends at the end.
    reorderAiSession({ id: c.id, overId: 'ignored', position: 'last' })
    expect(order().at(-1)).toBe(c.id)
  })

  it('keeps repeated insertions between the same anchors ordered without collisions', async () => {
    await initDatabase()
    const { reorderAiSession } = await import('./ai-session.service')
    const first = createAiSession({ kind: 'chat', title: 'First' })
    const second = createAiSession({ kind: 'chat', title: 'Second' })
    const inserted = Array.from({ length: 12 }, (_, index) => createAiSession({ kind: 'chat', title: 'M' + index }))

    reorderAiSession({ id: second.id, overId: first.id, position: 'after' })
    let anchor = first.id
    for (const item of inserted) {
      reorderAiSession({ id: item.id, overId: anchor, position: 'after' })
      anchor = item.id
    }

    const order = listAiSessions({ limit: 50, manualOrder: true }).map(item => item.id)
    for (let index = 0; index < inserted.length; index += 1) {
      expect(order.indexOf(inserted[index].id)).toBe(order.indexOf(first.id) + 1 + index)
    }
    expect(order.at(-1)).toBe(second.id)
  })

  it('rejects self anchors and unknown drop targets', async () => {
    await initDatabase()
    const { reorderAiSession } = await import('./ai-session.service')
    const session = createAiSession({ kind: 'chat', title: 'Solo' })
    expect(() => reorderAiSession({ id: session.id, overId: session.id, position: 'before' })).toThrow('ORDER_OVER_NOT_FOUND')
    expect(() => reorderAiSession({ id: session.id, overId: 'ai_session_missing', position: 'after' })).toThrow('ORDER_OVER_NOT_FOUND')
  })

  it('resolves the latest session by activity across kinds and skips archived rows', async () => {
    await initDatabase()
    const { getLatestAiSession, archiveAiSession } = await import('./ai-session.service')
    const chat = createAiSession({ kind: 'chat', title: '聊天' })
    const agent = createAiSession({ kind: 'agent', title: 'Agent' })
    const db = getDatabase()
    db.run("UPDATE cherry_resource_state SET last_activity_at=? WHERE entity_type='session' AND entity_id=?", [new Date(Date.now() + 60_000).toISOString(), agent.id])
    db.run("UPDATE cherry_resource_state SET last_activity_at=? WHERE entity_type='session' AND entity_id=?", [new Date(Date.now() + 120_000).toISOString(), chat.id])

    // Pinned list head must not decide the latest; activity order does.
    const { pinAiSession } = await import('./ai-session.service')
    pinAiSession(agent.id, true)
    expect(getLatestAiSession()?.id).toBe(chat.id)
    expect(getLatestAiSession({ kind: 'agent' })?.id).toBe(agent.id)

    archiveAiSession(chat.id)
    expect(getLatestAiSession()?.id).toBe(agent.id)
  })
})
