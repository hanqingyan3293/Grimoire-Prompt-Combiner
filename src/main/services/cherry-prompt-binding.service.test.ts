import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { bindToTarget, clearBindings, listBindings, listBindingsForTarget, listBindingRelations, unbindFromTarget } from './cherry-prompt-binding.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-binding-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

function seedAssistant(id: string): void {
  getDatabase().run(
    'INSERT INTO ai_assistants (id,name,description,system_prompt,provider_id,model_id,avatar,settings_json,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, 'A' + id, '', '', '', '', '', '{}', 0, '2026-01-01', '2026-01-01']
  )
}

describe('prompt bindings', () => {
  it('binds a prompt to an assistant and lists the relation', async () => {
    await initDatabase()
    seedAssistant('a1')
    expect(bindToTarget('p1', 'assistant', 'a1')).toBe(true)
    expect(listBindings('p1')).toEqual([{ promptId: 'p1', targetType: 'assistant', targetId: 'a1' }])
    expect(listBindingsForTarget('assistant', 'a1')).toHaveLength(1)
  })

  it('is idempotent — binding twice yields ONE edge, not an error', async () => {
    await initDatabase()
    seedAssistant('a1')
    bindToTarget('p1', 'assistant', 'a1')
    // A double-click or a retried request must not fail on the primary key.
    expect(bindToTarget('p1', 'assistant', 'a1')).toBe(true)
    expect(listBindingRelations()).toHaveLength(1)
  })

  it('refuses to bind to a nonexistent ASSISTANT rather than creating a dangling edge', async () => {
    await initDatabase()
    // An edge to an assistant that does not exist can never be displayed or removed through the
    // UI, so it would be permanent unremovable state.
    expect(bindToTarget('p1', 'assistant', 'ghost')).toBe(false)
    expect(listBindingRelations()).toHaveLength(0)
  })

  it('stores an AGENT binding without validation, because Grimoire has no agent table', async () => {
    await initDatabase()
    // `agent` targets are opaque here. Stored (so the relation round-trips) but not resolvable —
    // the deliberate choice is to keep the data rather than reject a target type the source
    // supports but this app cannot check.
    expect(bindToTarget('p1', 'agent', 'agent-xyz')).toBe(true)
    expect(listBindings('p1')).toEqual([{ promptId: 'p1', targetType: 'agent', targetId: 'agent-xyz' }])
  })

  it('rejects an unknown target type', async () => {
    await initDatabase()
    expect(bindToTarget('p1', 'nonsense' as never, 'x')).toBe(false)
    expect(unbindFromTarget('p1', 'nonsense' as never, 'x')).toBe(false)
  })

  it('unbinds, and unbinding something not bound is not an error', async () => {
    await initDatabase()
    seedAssistant('a1')
    bindToTarget('p1', 'assistant', 'a1')
    expect(unbindFromTarget('p1', 'assistant', 'a1')).toBe(true)
    expect(listBindings('p1')).toHaveLength(0)
    // The source's delete is a plain delete whose absence is not reported.
    expect(unbindFromTarget('p1', 'assistant', 'a1')).toBe(true)
  })

  it('supports ONE prompt shared with SEVERAL assistants — the relation the source models', async () => {
    await initDatabase()
    seedAssistant('a1')
    seedAssistant('a2')
    bindToTarget('shared', 'assistant', 'a1')
    bindToTarget('shared', 'assistant', 'a2')
    // This is precisely why a binding table is needed instead of copying text into
    // `ai_assistants.system_prompt`: editing the prompt must affect both assistants.
    expect(listBindingsForTarget('assistant', 'a1')).toHaveLength(1)
    expect(listBindingsForTarget('assistant', 'a2')).toHaveLength(1)
    expect(listBindings('shared')).toHaveLength(2)
  })

  it('clears every binding of a prompt at once', async () => {
    await initDatabase()
    seedAssistant('a1')
    seedAssistant('a2')
    bindToTarget('p1', 'assistant', 'a1')
    bindToTarget('p1', 'assistant', 'a2')
    bindToTarget('p2', 'assistant', 'a1')
    expect(clearBindings('p1')).toBe(2)
    // Only p1's edges go; p2's survives.
    expect(listBindingRelations().map(r => r.promptId)).toEqual(['p2'])
  })

  it('persists across a re-read of the raw table', async () => {
    await initDatabase()
    seedAssistant('a1')
    bindToTarget('p1', 'assistant', 'a1')
    const count = getDatabase().exec('SELECT count(*) FROM cherry_prompt_bindings')[0]?.values?.[0]?.[0]
    expect(Number(count)).toBe(1)
  })
})
