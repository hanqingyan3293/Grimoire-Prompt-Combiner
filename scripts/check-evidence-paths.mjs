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
  const normalised = candidate.split('\\').join('/').replace(/^(\.\/)+/, '')
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
console.log('paths cited: ' + candidates.size + ', unresolved: ' + missing.length)
for (const item of missing.sort()) console.log('  UNRESOLVED ' + item)
if (missing.length) process.exitCode = 1
