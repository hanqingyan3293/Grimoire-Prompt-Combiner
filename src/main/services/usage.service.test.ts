import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { listAiUsage, recordAiUsage, summarizeAiUsage } from './usage.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-usage-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('AI usage accounting', () => {
  it('persists a full reading', async () => {
    await initDatabase()
    const stored = recordAiUsage({
      sessionId: 's1', runtime: 'opencode', modelId: 'gpt-4o',
      inputTokens: 1200, outputTokens: 340, cachedTokens: 900
    })
    expect(stored).toMatchObject({ inputTokens: 1200, outputTokens: 340, cachedTokens: 900 })
    // Read back through a separate query, so a persistence bug cannot pass on the return value.
    expect(listAiUsage()[0]).toMatchObject({ sessionId: 's1', inputTokens: 1200, outputTokens: 340, cachedTokens: 900 })
  })

  it('writes NO row when the provider reported nothing', async () => {
    await initDatabase()
    // A provider that omits usage must not produce a zero-token entry: the source UI would
    // render that as a real measurement.
    expect(recordAiUsage({ runtime: 'opencode' })).toBeNull()
    expect(summarizeAiUsage().calls).toBe(0)
  })

  it('keeps a partial reading and leaves the missing side null, not zero', async () => {
    await initDatabase()
    recordAiUsage({ runtime: 'opencode', inputTokens: 42 })
    const record = listAiUsage()[0]
    expect(record.inputTokens).toBe(42)
    // The distinction the whole design turns on: absent, not 0.
    expect(record.outputTokens).toBeNull()
    expect(record.cachedTokens).toBeNull()
  })

  it('treats a genuine zero as a reading and absent as null', async () => {
    await initDatabase()
    recordAiUsage({ runtime: 'opencode', inputTokens: 0, outputTokens: 0 })
    const record = listAiUsage()[0]
    expect(record.inputTokens).toBe(0)
    expect(record.outputTokens).toBe(0)
  })

  it('rejects non-finite counts instead of coercing them', async () => {
    await initDatabase()
    // `Number(null)` is 0 and `NaN` is not a token count; neither may become a stored 0.
    const stored = recordAiUsage({ runtime: 'opencode', inputTokens: Number.NaN as never, outputTokens: 5 })
    expect(stored?.inputTokens).toBeNull()
    expect(stored?.outputTokens).toBe(5)
  })

  it('summarizes totals, and answers null totals when every record is partial', async () => {
    await initDatabase()
    recordAiUsage({ runtime: 'a', inputTokens: 10, outputTokens: 1 })
    recordAiUsage({ runtime: 'b', inputTokens: 20, outputTokens: 2, cachedTokens: 5 })
    expect(summarizeAiUsage()).toEqual({ calls: 2, inputTokens: 30, outputTokens: 3, cachedTokens: 5 })

    closeDatabase()
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-usage-'))
    await initDatabase()
    recordAiUsage({ runtime: 'a', inputTokens: 10 })
    // `sum()` over an all-NULL column returns NULL; the UI shows "—" for that, so the null
    // is carried through rather than flattened to 0.
    expect(summarizeAiUsage().cachedTokens).toBeNull()
  })

  it('lists newest first and honours the limit', async () => {
    await initDatabase()
    for (let index = 0; index < 5; index += 1) {
      recordAiUsage({ runtime: 'a', modelId: 'm' + index, inputTokens: index + 1 })
    }
    expect(listAiUsage(3)).toHaveLength(3)
    expect(listAiUsage()).toHaveLength(5)
    // Newest first. `created_at` only has millisecond resolution, so two inserts inside the
    // same millisecond tie; the service breaks ties by rowid (insertion order) rather than by
    // a random UUID, which is what makes this assertion deterministic.
    expect(listAiUsage().map(record => record.modelId)).toEqual(['m4', 'm3', 'm2', 'm1', 'm0'])
  })
})
