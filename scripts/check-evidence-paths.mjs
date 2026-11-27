#!/usr/bin/env node
// Evidence rot check: every path cited in the migration matrix should still exist SOMEWHERE in the tree. A row
// whose evidence points at a file that was renamed or deleted is worse than no evidence — it reads as proof.
//
// Candidates are written against several different bases (repo root, a vendored snapshot root, or that
// snapshot's `renderer/components`), so instead of guessing base directories this builds a suffix index of every
// file once and asks whether any path ends with the candidate.
import fs from 'node:fs'
import path from 'node:path'

// `artifacts` is NOT skipped: evidence cites snapshot files under it.
const SKIP = /(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/
const index = new Set()
const walk = dir => {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (SKIP.test(full)) continue
    if (entry.isDirectory()) walk(full)
    else index.add(full.split(path.sep).join('/'))
  }
}
walk(process.cwd())
console.log('indexed files: ' + index.size)

const text = fs.readFileSync('.agent/MIGRATION_MATRIX.md', 'utf8')
const candidates = new Set()
for (const match of text.matchAll(/[\w./\\-]+\.(?:ts|tsx|mjs|cjs|json|md|css)\b/g)) {
  const candidate = match[0].replace(/[.,;:]+$/, '')
  if (!candidate.includes('/') && !candidate.includes('\\')) continue
  if (candidate.startsWith('http') || candidate.includes('*')) continue
  let normalised = candidate.split('\\').join('/').replace(/^(\.\/)+/, '')
  // Parent-relative Markdown links are anchored to this document's directory,
  // not to a vendored suffix. Never collapse a repository escape to a basename.
  if (normalised.startsWith('../')) {
    const resolved = path.posix.normalize(path.posix.join('.agent', normalised))
    if (!resolved.startsWith('../') && !path.posix.isAbsolute(resolved)) normalised = resolved
  }
  // A citation like `messages.ts/topics.ts` names two files; split on the extension boundary.
  for (const piece of normalised.split(/(?<=\.(?:ts|tsx|mjs|cjs|json|md|css))\//)) candidates.add(piece)
}

const missing = []
for (const candidate of candidates) {
  const suffix = '/' + candidate
  let found = false
  for (const file of index) { if (file === candidate || file.endsWith(suffix)) { found = true; break } }
  if (!found) missing.push(candidate)
}
// Commands cited as evidence must also be runnable: a `npm run x` that no longer exists reads as a repro step
// and wastes the reader's time.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const docs = ['.agent/MIGRATION_MATRIX.md', '.agent/records/2026-10-31-overview.md', '.agent/records/2026-11-01-cross-matrix.md', '.agent/records/2026-11-01-empty-states.md', '.agent/records/2026-11-01-unreachable-bridge.md']
const badScripts = new Set()
for (const doc of docs) {
  let docText = ''
  try { docText = fs.readFileSync(doc, 'utf8') } catch { continue }
  for (const match of docText.matchAll(/npm run ([\w:-]+)/g)) {
    if (!pkg.scripts[match[1]]) badScripts.add(match[1] + '  (cited in ' + doc + ')')
  }
}

console.log('paths cited: ' + candidates.size + ', unresolved: ' + missing.length)
console.log('npm scripts cited: ' + badScripts.size + ' unknown')
for (const item of badScripts) console.log('  UNKNOWN SCRIPT ' + item)
if (badScripts.size) process.exitCode = 1
for (const item of missing.sort()) console.log('  UNRESOLVED ' + item)
if (missing.length) process.exitCode = 1
