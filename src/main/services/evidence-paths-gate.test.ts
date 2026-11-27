import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const script = path.join(process.cwd(), 'scripts/check-evidence-paths.mjs')
const roots: string[] = []
function fixture(citation: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-evidence-paths-')); roots.push(root)
  fs.mkdirSync(path.join(root, '.agent'), { recursive: true }); fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/actual.ts'), 'export const actual = true\n')
  fs.writeFileSync(path.join(root, '.agent/MIGRATION_MATRIX.md'), citation)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node verify.mjs' } }))
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('evidence citation gate document paths', () => {
  it('resolves a valid parent-relative Markdown link against the matrix document directory', () => {
    const result = fixture('[Actual source](../src/actual.ts)')
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('unresolved: 0')
  })
  it('still rejects a missing document-relative target instead of accepting a similarly named source', () => {
    const result = fixture('[Missing source](../other/actual.ts)')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('UNRESOLVED')
  })
  it('does not turn traversal outside the repository into a basename match', () => {
    const result = fixture('[Outside](../../actual.ts)')
    expect(result.status).toBe(1)
  })
  it('preserves repository/suffix citations and validates their command names', () => {
    expect(fixture('Evidence: src/actual.ts; npm run verify').status).toBe(0)
    const result = fixture('Evidence: src/actual.ts; npm run absent')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('UNKNOWN SCRIPT absent')
  })
})
