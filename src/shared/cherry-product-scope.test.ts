import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const scopeFile = path.join(root, '.agent/feature-scope.json')
type Entry = { id: string; disposition: string; taskId: string; manualAcceptance: string; evidence: unknown[]; productExposure?: string; sequence?: number }
function scope(): { entries: Entry[] } {
  expect(fs.existsSync(scopeFile), 'approved capability scope must be persisted').toBe(true)
  return JSON.parse(fs.readFileSync(scopeFile, 'utf8'))
}

describe('approved Grimoire feature scope', () => {
  it('keeps all 94 NovelAI decisions with exactly 67 required, 18 reserve and 9 excluded', () => {
    const entries = scope().entries.filter(entry => entry.id.startsWith('novelai.'))
    expect(entries).toHaveLength(94)
    expect(entries.filter(entry => entry.disposition === 'required')).toHaveLength(67)
    expect(entries.filter(entry => entry.disposition === 'reference')).toHaveLength(18)
    expect(entries.filter(entry => entry.disposition === 'excluded')).toHaveLength(9)
    expect(entries.find(entry => entry.id === 'novelai.F8')?.taskId).toBe('P1')
    expect(entries.find(entry => entry.id === 'novelai.J5')?.taskId).toBe('W1')
  })

  it('keeps every original Cherry sequence and hides the four resolved pending settings', () => {
    const entries = scope().entries.filter(entry => entry.id.startsWith('cherry.'))
    expect(entries).toHaveLength(79)
    expect(entries.map(entry => entry.sequence)).toEqual(Array.from({ length: 79 }, (_, index) => index + 1))
    for (const sequence of [22, 42, 59, 74]) {
      expect(entries.find(entry => entry.sequence === sequence)?.productExposure).toBe('hidden')
    }
    for (const sequence of [39, 40, 41, 45]) {
      expect(entries.find(entry => entry.sequence === sequence)?.disposition).toBe('required')
    }
    expect(entries.find(entry => entry.sequence === 20)?.productExposure).toBe('hidden')
  })

  it('assigns stable unique ids and a task without claiming manual acceptance', () => {
    const entries = scope().entries
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length)
    for (const entry of entries) {
      expect(entry.taskId).toMatch(/^(P[012]|C[1-5]|W[12]|N[1-7]|T1|S[12]|R1|V[1-3])$/)
      expect(entry.manualAcceptance).toBe('pending')
      expect(entry.evidence).toEqual([])
    }
    expect(entries.find(entry => entry.id === 'runtime.recovery')?.disposition).toBe('external-blocked')
  })

  it('generates the runtime product table from the same canonical manifest', async () => {
    const { cherryProductScope, getCherryProductScope } = await import('./cherry-product-scope')
    const entries = scope().entries.filter(entry => entry.id.startsWith('cherry.'))
    expect(cherryProductScope).toEqual(entries.map(({ id, sequence, disposition, productExposure }) => ({ id, sequence, disposition, productExposure })))
    expect(getCherryProductScope(39)?.productExposure).toBe('visible')
    expect(getCherryProductScope(999)).toBeUndefined()
  })
})
