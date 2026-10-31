#!/usr/bin/env node
// Silent catches are mostly legitimate (ROLLBACK, child.kill(), reader.cancel()). The problem is that an empty
// catch also hides a real failure, and nothing stops a new one from creeping in. This gate does not judge each
// site; it ratchets the COUNT so growth is a deliberate act (`scripts/silent-catch-baseline.json`).
import fs from 'node:fs'
import path from 'node:path'

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (!/node_modules|vendor|dist/.test(full)) walk(full, out) }
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
  }
  return out
}

const hits = []
for (const file of walk('src')) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    const inline = /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)
    const block = /catch\s*(\([^)]*\))?\s*\{\s*$/.test(line) && (lines[index + 1] || '').trim() === '}'
    // Same idea for the promise form: `.catch(() => {})` and `.catch(() => null)` swallow a rejection just as
    // quietly as an empty try/catch, so they count toward the same ratchet.
    const promiseSilent = /\.catch\s*\(\s*\(?[^)]*\)?\s*=>\s*(\{\s*\}|null|undefined|0|false|''|"")\s*\)/.test(line)
    if (inline || block) hits.push({ where: file + ':' + (index + 1), form: 'try/catch' })
    else if (promiseSilent) hits.push({ where: file + ':' + (index + 1), form: 'promise' })
  })
}

let baseline = { max: 0 }
try { baseline = JSON.parse(fs.readFileSync('scripts/silent-catch-baseline.json', 'utf8')) } catch {}
const max = baseline.max ?? 0
const forms = hits.reduce((acc, hit) => { acc[hit.form] = (acc[hit.form] || 0) + 1; return acc }, {})
console.log('silent catches: ' + hits.length + ' (baseline ' + max + ') ' + JSON.stringify(forms))
if (hits.length > max) {
  console.log('SILENT-CATCH-GROWTH: ' + (hits.length - max) + ' new silent failure path(s)')
  for (const hit of hits.slice(-8)) console.log('  ' + hit.form + ' ' + hit.where)
  process.exitCode = 1
}
