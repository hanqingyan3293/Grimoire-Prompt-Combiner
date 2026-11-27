import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: () => testRoot } }))
vi.mock('./logger.service', () => ({ logEvent: vi.fn() }))

import { closeDatabase, initDatabase } from '../database'
import { getComfyWorkflow, importComfyWorkflow } from './comfy-workflow.service'

beforeEach(() => { testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-comfy-')) })
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('ComfyUI workflow persistence', () => {
  it('stores conversion warnings in the analysis read back from the database', async () => {
    await initDatabase()
    const imported = importComfyWorkflow('frontend', { '1': { class_type: 'KSampler', inputs: {} } }, 'imported', ['转换警告'])

    expect(imported.analysis.warnings).toContain('转换警告')
    const stored = getComfyWorkflow(imported.id)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!.analysis_json).warnings).toContain('转换警告')
  })
})
