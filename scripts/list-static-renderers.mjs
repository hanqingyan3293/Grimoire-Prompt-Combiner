// REPORT ONLY — prints candidates, never fails a build, not part of any gate.
//
// Renderer-side counterpart of list-suspicious-functions.mjs: a panel component that renders text but never
// uses a hook, the IPC bridge, props, or a list is the shape of a placeholder (「这里是 X 面板」).
import fs from 'node:fs'
import path from 'node:path'

const roots = ['src/renderer/components']
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) files.push(full)
  }
}
for (const root of roots) walk(root)

const SIGNALS = [/use[A-Z][A-Za-z0-9_]*[(]/, /window[.]api/, /props[.]/, /[.]map[(]/, /useState|useEffect|useRef|useStore/]
const hits = []

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const match = source.match(/export (?:default )?function ([A-Za-z0-9_]+)[^(]*[(]/)
  if (!match) continue
  // Destructured props are real wiring even when `props.` never appears. Only the PARAMETER LIST counts —
  // slicing 400 chars past the name used to include the body brace and marked every component alive.
  const open = source.indexOf('(', match.index)
  const close = source.indexOf(')', open)
  const params = open >= 0 && close > open ? source.slice(open + 1, close) : ''
  const destructures = params.indexOf('{') >= 0
  const alive = destructures || SIGNALS.some(signal => signal.test(source))
  if (alive) continue
  const textNodes = (source.match(/>[^<>{}\[\]]{4,}</g) || []).length
  if (textNodes === 0) continue
  hits.push({ file: path.relative('.', file), name: match[1], textNodes })
}

console.log('candidates:' + hits.length)
for (const hit of hits) console.log(hit.file + '  ' + hit.name + '  textNodes=' + hit.textNodes)
