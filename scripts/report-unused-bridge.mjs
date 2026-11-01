import fs from 'node:fs'
import path from 'node:path'
// REPORT ONLY — not a gate.
//
// Lists bridge methods declared in src/renderer/global.d.ts that no renderer code appears to call. It is a
// HINT, not a verdict: usage through destructuring (`const { save } = window.api.file`) or through a wrapper
// is invisible to a name-pattern scan, and spot checks found exactly that (file.save and canvas.delete show
// "unused" here but are called 8 and 7 times). Read the list, then verify a name before acting on it.
const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p) } return out }

const dts = fs.readFileSync('src/renderer/global.d.ts', 'utf8')
// namespace -> method names, from the interface bodies (`name: { ... }` blocks)
const namespaces = []
const nsRe = /^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*\{$/gm
let match
while ((match = nsRe.exec(dts))) namespaces.push({ name: match[1], start: match.index })
const surface = {}
for (let i = 0; i < namespaces.length; i += 1) {
  const from = namespaces[i].start
  const to = i + 1 < namespaces.length ? namespaces[i + 1].start : dts.length
  const body = dts.slice(from, to)
  const methods = new Set()
  for (const m of body.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*)\s*[:(]/gm)) methods.add(m[1])
  if (methods.size) surface[namespaces[i].name] = [...methods]
}

const code = walk('src/renderer').concat(walk('src/vendor/cherry/compat/src')).map(f => fs.readFileSync(f, 'utf8')).join('\n')
// Two passes: `api.ns.method(...)` misses destructured usage, so a name only counts as unused when the bare
// `.method` form is absent too. That removes the obvious false negatives and leaves a list worth reading.
const unused = []
const suspicious = []
for (const [namespace, methods] of Object.entries(surface)) {
  for (const method of methods) {
    if (new RegExp('api\\.' + namespace + '\\.' + method + '\\b').test(code)) continue
    const bare = new RegExp('\\.' + method + '\\b')
    if (bare.test(code)) suspicious.push(namespace + '.' + method)
    else unused.push(namespace + '.' + method)
  }
}
const total = Object.values(surface).reduce((sum, list) => sum + list.length, 0)
console.log('bridge methods declared: ' + total)
console.log('no `api.ns.method` call AND no bare `.method` anywhere: ' + unused.length)
console.log(unused.join(' '))
console.log('called without the api prefix (destructured or wrapper): ' + suspicious.length)
console.log(suspicious.join(' '))
