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
    if (inline || block) hits.push(file + ':' + (index + 1))
  })
}

let baseline = { max: 0 }
try { baseline = JSON.parse(fs.readFileSync('scripts/silent-catch-baseline.json', 'utf8')) } catch {}
const max = baseline.max ?? 0
console.log('silent catches: ' + hits.length + ' (baseline ' + max + ')')
if (hits.length > max) {
  console.log('SILENT-CATCH-GROWTH: ' + (hits.length - max) + ' new empty catch block(s)')
  process.exitCode = 1
}
