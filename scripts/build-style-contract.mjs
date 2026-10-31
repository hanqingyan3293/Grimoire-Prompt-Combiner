
// Generates geometric style assertions straight from index.css so coverage grows without hand-copying values.
// Only properties with a literal px/number value are emitted: those are the ones that must not drift.
import fs from 'node:fs'

const css = fs.readFileSync('src/renderer/index.css', 'utf8')
const WANTED = new Set(['height', 'min-height', 'min-width', 'width', 'border-radius', 'padding-top', 'padding-left', 'gap', 'font-size', 'font-weight'])
const TAG = name => name.startsWith('ui-field') ? 'input' : name.startsWith('ui-checkbox') || name.startsWith('ui-radio') ? 'input' : 'div'

const rows = []
const ruleRe = /(^|\n)\.(ui-[a-z0-9-]+)\s*\{([^}]*)\}/g
for (const match of css.matchAll(ruleRe)) {
  const name = match[2]
  const body = match[3]
  for (const line of body.split(';')) {
    const [rawProp, rawValue] = line.split(':')
    if (!rawProp || !rawValue) continue
    const property = rawProp.trim()
    if (!WANTED.has(property)) continue
    const value = rawValue.trim()
    // Only px literals and a bare 0: rem depends on the root font-size (14px here), and a computed style
    // reports px, so comparing a rem literal would fail on units rather than on drift.
    if (!/^([0-9.]+px|0)$/.test(value)) continue
    rows.push({ className: name, tag: TAG(name), property: property.replace(/-(\w)/g, (_, c) => c.toUpperCase()), expect: value === '0' ? '0px' : value })
  }
}
fs.writeFileSync('scripts/style-contract-extra.json', JSON.stringify(rows, null, 2) + '\n')
console.log('generated', rows.length, 'assertions for', new Set(rows.map(r => r.className)).size, 'classes')
