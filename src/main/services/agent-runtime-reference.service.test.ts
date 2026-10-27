import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))
import { initDatabase, closeDatabase, getDatabase } from '../database'
import { createAiSession, getAiSession, updateAiSession, branchAiSession } from './ai-session.service'
import { createAgentSession, getAgentSession, updateAgentSession, branchAgentSession } from './agent-session.service'
import { attachRuntimeExecutionReference, beginRuntimeExecutionReference, resolveRuntimeExecutionReference, RUNTIME_REFERENCE_KEY, type RuntimeExecutionIdentity } from './agent-runtime-reference.service'

beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-runtime-ref-')); await initDatabase() })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

for (const store of ['ai', 'agent'] as const) describe(store + ' native execution provenance', () => {
  function create() { return store === 'ai' ? createAiSession({ runtime: 'opencode' }) : createAgentSession({ runtime: 'opencode' }) }
  function identity(id: string): RuntimeExecutionIdentity { return { runtime: 'opencode', driver: 'opencode-legacy', owner: store + ':' + id, directory: '/main-owned', binaryVersion: '1.18.34', configFingerprint: 'hash' } }
  function data(id: string) { return store === 'ai' ? getAiSession(id)!.session.metadata : getAgentSession(id)!.session.data }
  function update(id: string, replacement: Record<string, unknown>) { return store === 'ai' ? updateAiSession({ id, metadata: replacement }) : updateAgentSession({ id, data: replacement }) }

  it('marks a first execution running before a native checkpoint is settled', () => {
    const session = create()
    const expected = identity(session.id)
    beginRuntimeExecutionReference(store, session.id, expected)
    expect(() => resolveRuntimeExecutionReference(store, session.id, expected)).toThrow('UNSETTLED')
    attachRuntimeExecutionReference(store, session.id, expected, 'ses_native')
    expect(resolveRuntimeExecutionReference(store, session.id, expected)).toBe('ses_native')
  })

  it('keeps execution provenance main-only while preserving it across generic replacements', () => {
    const session = create()
    const expected = identity(session.id)
    attachRuntimeExecutionReference(store, session.id, expected, 'ses_native')
    expect(data(session.id)).not.toHaveProperty(RUNTIME_REFERENCE_KEY)
    update(session.id, { label: 'kept' })
    expect(data(session.id)).toMatchObject({ label: 'kept' })
    expect(resolveRuntimeExecutionReference(store, session.id, expected)).toBe('ses_native')
    expect(() => update(session.id, { [RUNTIME_REFERENCE_KEY]: {} })).toThrow('MAIN_OWNED')
    expect(() => resolveRuntimeExecutionReference(store, session.id, { ...expected, configFingerprint: 'changed' })).toThrow('CONFIG_CHANGED')
  })

  it('never copies a native reference to a branch or accepts another local owner', () => {
    const session = create()
    attachRuntimeExecutionReference(store, session.id, identity(session.id), 'ses_parent')
    const branch = store === 'ai' ? branchAiSession({ sessionId: session.id }) : branchAgentSession({ sessionId: session.id })
    expect(resolveRuntimeExecutionReference(store, branch.id, identity(branch.id))).toBeUndefined()
    expect(resolveRuntimeExecutionReference(store, session.id, identity(session.id))).toBe('ses_parent')
    expect(() => attachRuntimeExecutionReference(store, branch.id, identity(session.id), 'ses_parent')).toThrow('OWNER_MISMATCH')
  })
})
