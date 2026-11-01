import fs from 'node:fs'
import path from 'node:path'
// REPORT ONLY — this prints candidates, it never fails a build and it is not part of any gate.
//
// Heuristic: a service function that returns a constant without touching the database or any port is either
// a stub or a deliberate empty result. From the UI both look identical, so the honest move is to list them
// and justify each one by hand. Treating this as a pass/fail test would be wrong in both directions:
// some hits are legitimate empty results, and a real stub can be written to avoid every pattern below.
const dir = 'src/main/services'
const files = fs.readdirSync(dir).filter(name => name.endsWith('.ts') && !name.includes('.test.'))
const REAL_CALL = /db\.|getDatabase\(|saveDatabase\(|await |fetch\(|ipcMain|spawn\(|sqlite|prepare\(/
const CONSTANT_RETURN = /return (\[\]|\{\}|null|undefined|0|''|"")/
const hits = []
for (const file of files) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8')
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    if (!/^export function [a-zA-Z0-9_]+/.test(line)) return
    const name = line.match(/^export function ([a-zA-Z0-9_]+)/)[1]
    let depth = 0
    let started = false
    const body = []
    for (let cursor = index; cursor < Math.min(lines.length, index + 80); cursor += 1) {
      const current = lines[cursor]
      body.push(current)
      for (const char of current) {
        if (char === '{') { depth += 1; started = true }
        else if (char === '}') depth -= 1
      }
      if (started && depth <= 0) break
    }
    const text = body.join('\n')
    if (REAL_CALL.test(text)) return
    if (!CONSTANT_RETURN.test(text)) return
    hits.push({ file, name, line: index + 1, body: text.split('\n').slice(0, 6).join(' | ') })
  })
}
console.log('candidates:' + hits.length)
for (const hit of hits) console.log(hit.file + ':' + hit.line + '  ' + hit.name + '   ' + hit.body.slice(0, 120))