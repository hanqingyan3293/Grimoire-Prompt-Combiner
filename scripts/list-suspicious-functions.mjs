// REPORT ONLY — prints candidates, never fails a build, not part of any gate.
//
// v2 heuristic. v1 listed 35 functions, but sampling showed the noise came from a narrow call-pattern list
// (read(store, id), readPinnedRows(), fs.readFileSync() did not match it). Precision rule now: a candidate is
// a function whose body contains NO call expression at all and returns a literal — the shape of a real stub.
import fs from 'node:fs'
import path from 'node:path'

const dir = 'src/main/services'
const files = fs.readdirSync(dir).filter(name => name.endsWith('.ts') && !name.includes('.test.'))
const FUNCTION_START = /export (?:async )?function ([A-Za-z0-9_]+)[ ]*[(]/
const LITERAL_RETURN = /return[ ]+(\[\]|\{\}|null|undefined|0|''|""|false|true)[ ]*;?[ ]*$/m
const CALL = /[A-Za-z_$][A-Za-z0-9_$]*[ ]*[(]/g
const KEYWORD_CALL = /^[ ]*(if|for|while|switch|catch)[ ]*[(][ ]*$/
const hits = []

for (const file of files) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8')
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(FUNCTION_START)
    if (!match) continue
    const body = []
    let depth = 0
    let started = false
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      body.push(line)
      depth += (line.match(/[{]/g) || []).length - (line.match(/[}]/g) || []).length
      if (line.indexOf('{') >= 0) started = true
      if (started && depth <= 0) break
    }
    const text = body.join('\n')
    const withoutSignature = text.slice(text.indexOf('(') + 1)
    const calls = (withoutSignature.match(CALL) || []).filter(call => !KEYWORD_CALL.test(call))
    if (calls.length > 0) continue
    if (!LITERAL_RETURN.test(text)) continue
    hits.push({ file, line: index + 1, name: match[1] })
  }
}

console.log('candidates:' + hits.length)
for (const hit of hits) console.log(hit.file + ':' + hit.line + '  ' + hit.name)
