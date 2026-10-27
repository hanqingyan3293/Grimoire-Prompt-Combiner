// Read-only audit: which bare import specifiers does the vendored Cherry source closure
// reference, and which of them resolve from the compat project's install?
// Prints a summary; changes nothing.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(repoRoot, 'src/vendor/cherry/source')
const compatRoot = path.join(repoRoot, 'src/vendor/cherry/compat')
const requireFromCompat = createRequire(path.join(compatRoot, 'package.json'))

const ALIAS_PREFIXES = ['@renderer/', '@shared/', '@main/', '@data/', '@logger', '@cherrystudio/', '@/', '~', '@types/']

function walk(dir, out = []) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

// Line-oriented: a specifier must sit on the same logical line as its statement.
// `import x from '...'` / `export ... from '...'` / `import '...'` / `import('...')` / `require('...')`.
const IMPORT_RES = [
  /(?:^|[^\w.])import\s+[^;\n]*?from\s+['"]([^'"]+)['"]/g,
  /(?:^|[^\w.])export\s+[^;\n]*?from\s+['"]([^'"]+)['"]/g,
  /(?:^|[^\w.])import\s+['"]([^'"]+)['"]/g,
  /(?:^|[^\w.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:^|[^\w.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

const specifiers = new Map() // specifier -> count
const files = walk(sourceRoot)
for (const file of files) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { continue }
  for (const re of IMPORT_RES) {
    re.lastIndex = 0
    for (const match of text.matchAll(re)) {
      const spec = match[1]
      if (!spec || spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('data:') || spec.startsWith('http')) continue
      specifiers.set(spec, (specifiers.get(spec) || 0) + 1)
    }
  }
}

function packageName(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const external = new Map() // package -> {count, resolvable}
const aliased = new Map()
for (const [spec, count] of specifiers) {
  if (ALIAS_PREFIXES.some(prefix => spec === prefix.replace(/\/$/, '') || spec.startsWith(prefix))) {
    aliased.set(spec, count)
    continue
  }
  if (spec.endsWith('.css') || spec.endsWith('.svg') || spec.includes('?')) continue
  const pkg = packageName(spec)
  let resolvable = false
  try { requireFromCompat.resolve(pkg + '/package.json'); resolvable = true }
  catch {
    try { requireFromCompat.resolve(pkg); resolvable = true }
    catch { resolvable = false }
  }
  const entry = external.get(pkg) || { count: 0, resolvable, specs: new Set() }
  entry.count += count
  entry.specs.add(spec)
  external.set(pkg, entry)
}

const resolvable = [...external.entries()].filter(([, v]) => v.resolvable)
const unresolved = [...external.entries()].filter(([, v]) => !v.resolvable)

console.log('files scanned:', files.length)
console.log('distinct bare specifiers:', specifiers.size)
console.log('alias-internal specifiers:', aliased.size)
console.log('external packages referenced:', external.size)
console.log('  resolvable from compat install:', resolvable.length)
console.log('  UNRESOLVED:', unresolved.length)
for (const [pkg, v] of unresolved.sort()) console.log('   -', pkg, '(' + v.count + ' imports)')
const aliasUnresolved = [...aliased.keys()].length
console.log('alias specifiers referenced:', aliasUnresolved)
