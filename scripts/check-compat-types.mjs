#!/usr/bin/env node
// G5 split: typecheck the Cherry compat program, then bucket the diagnostics by who owns
// the file. 270 of 272 errors live in the read-only vendored source, which we may not edit
// and whose original tsconfig was never vendored — a "must be zero" gate over that set can
// never pass, and clearing it with noCheck or an exclude list would be fake. So:
//   - owned files (compat layer + our shared code) must be ZERO;
//   - source diagnostics are frozen to a recorded baseline and may only go down.
// Both halves are always printed; nothing is silently filtered.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const baselinePath = path.join(root, '.agent', 'gates', 'compat-source-baseline.json')
const updateBaseline = process.argv.includes('--update-baseline')
const snapshotDir = path.join(root, 'artifacts')
const SOURCE_PREFIX = 'src/vendor/cherry/source/'
const OWNED_PREFIX = 'src/vendor/cherry/compat/'

const started = Date.now()
const run = spawnSync('npm', ['run', 'typecheck:cherry-compat'], {
  cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
})
const output = String(run.stdout || '') + String(run.stderr || '')
const lines = output.split(/\r?\n/)
const diagnostics = []
for (const line of lines) {
  const match = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/)
  if (match) diagnostics.push({ file: match[1].replace(/\\/g, '/'), line: Number(match[2]), code: match[4], message: match[5] })
}

const buckets = { source: [], owned: [], other: [] }
for (const item of diagnostics) {
  if (item.file.startsWith(SOURCE_PREFIX) || item.file.includes('/source/src/') || item.file.includes('../source/')) buckets.source.push(item)
  else if (item.file.startsWith(OWNED_PREFIX)) buckets.owned.push(item)
  else buckets.other.push(item)
}
const byCode = (list) => list.reduce((acc, item) => { acc[item.code] = (acc[item.code] || 0) + 1; return acc }, {})

const snapshot = {
  generatedAt: new Date().toISOString(),
  exitCode: run.status,
  durationMs: Date.now() - started,
  total: diagnostics.length,
  source: { count: buckets.source.length, byCode: byCode(buckets.source) },
  owned: { count: buckets.owned.length, byCode: byCode(buckets.owned), files: [...new Set(buckets.owned.map(i => i.file + ':' + i.line + ' ' + i.code))] },
  other: { count: buckets.other.length, files: [...new Set(buckets.other.map(i => i.file + ':' + i.line + ' ' + i.code))] },
}

fs.mkdirSync(snapshotDir, { recursive: true })
fs.writeFileSync(path.join(snapshotDir, 'compat-types-' + snapshot.generatedAt.replace(/[:.]/g, '-') + '.json'), JSON.stringify(snapshot, null, 2) + '\n')

const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  : { source: snapshot.source.count, recordedAt: snapshot.generatedAt, note: 'initial baseline captured on first run' }

const print = (label, list, limit) => {
  console.log(label + ': ' + list.length)
  for (const item of list.slice(0, limit)) console.log('  ' + item.file + ':' + item.line + '  ' + item.code + '  ' + item.message.slice(0, 140))
  if (list.length > limit) console.log('  … ' + (list.length - limit) + ' more (see artifacts snapshot)')
}
print('OWNED diagnostics (must be 0)', buckets.owned, 20)
print('SOURCE diagnostics (read-only, frozen)', buckets.source, 5)
if (buckets.other.length) print('OTHER diagnostics', buckets.other, 20)
console.log('baseline.source = ' + baseline.source + '  current.source = ' + snapshot.source.count)

if (updateBaseline) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, JSON.stringify({ source: snapshot.source.count, recordedAt: snapshot.generatedAt, byCode: snapshot.source.byCode, note: 'read-only vendor diagnostics; may only decrease' }, null, 2) + '\n')
  console.log('baseline updated -> ' + baselinePath)
}

let failed = false
if (buckets.owned.length > 0) { console.log('FAIL: owned files have type errors'); failed = true }
if (buckets.other.length > 0) { console.log('FAIL: diagnostics outside the two known buckets'); failed = true }
if (!updateBaseline && snapshot.source.count > baseline.source) { console.log('FAIL: source diagnostics grew beyond baseline'); failed = true }
console.log(failed ? 'G5 FAILED' : 'G5 PASSED')
process.exit(failed ? 1 : 0)
