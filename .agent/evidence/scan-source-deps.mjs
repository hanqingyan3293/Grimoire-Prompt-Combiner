import fs from 'node:fs'
import path from 'node:path'

const SOURCE = 'D:/File/Data/魔导书/grimoire/src/vendor/cherry/source'
const COMPAT = 'D:/File/Data/魔导书/grimoire/src/vendor/cherry/compat'

// Source aliases resolved by the source's (unvendored) build config, plus compat's own.
const ALIASES = ['@renderer', '@shared', '@main', '@data', '@logger', '@cherrystudio', '@application', '@vectorstores']

function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(full)
  }
  return out
}

const SPEC = [
  /^\s*import\s+[^'"\n]*from\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
  /^\s*export\s+[^'"\n]*from\s*['"]([^'"]+)['"]/gm,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

const NODE = new Set(['fs', 'path', 'os', 'crypto', 'child_process', 'util', 'events', 'stream', 'url', 'zlib', 'http', 'https', 'net', 'tty', 'worker_threads', 'assert', 'querystring', 'buffer', 'readline', 'dns', 'dgram', 'tls', 'module', 'vm', 'perf_hooks', 'timers', 'string_decoder', 'process', 'constants', 'v8', 'inspector', 'async_hooks', 'repl', 'cluster', 'wasi', 'punycode'])

// Correct resolution, two corrections over the naive version:
//  1. Ask whether the DIRECTORY exists in any node_modules on the walk-up path, not
//     `require.resolve(pkg + '/package.json')` - a restrictive `exports` map makes the latter
//     fail for packages that ARE present (e.g. `streamdown`).
//  2. Walk UP the tree like Node does. Checking only `COMPAT/node_modules` reported `dayjs`,
//     `axios` and `yaml` as missing while they are hoisted at the repository root and resolve
//     fine - the build succeeds, so the scan had to be wrong, not the resolution.
function nodeModuleDirs(start) {
  const dirs = []
  let current = start
  for (;;) {
    dirs.push(path.join(current, 'node_modules'))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}

const SEARCH_DIRS = [...nodeModuleDirs(SOURCE), ...nodeModuleDirs(COMPAT)]

function pkgPresent(pkg) {
  return SEARCH_DIRS.some(dir => fs.existsSync(path.join(dir, pkg)))
}

const byArea = { renderer: new Map(), main: new Map(), other: new Map() }

for (const file of walk(SOURCE)) {
  const rel = path.relative(SOURCE, file).split(path.sep).join('/')
  const area = rel.startsWith('src/renderer/') ? 'renderer' : rel.startsWith('src/main/') ? 'main' : 'other'
  const text = stripComments(fs.readFileSync(file, 'utf8'))
  for (const re of SPEC) {
    for (const m of text.matchAll(re)) {
      const spec = m[1]
      if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('data:')) continue
      if (ALIASES.some(a => spec === a || spec.startsWith(a + '/'))) continue
      const parts = spec.split('/')
      const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      if (NODE.has(pkg) || pkg === 'electron') continue
      if (pkgPresent(pkg)) continue
      const map = byArea[area]
      if (!map.has(pkg)) map.set(pkg, new Set())
      map.get(pkg).add(rel)
    }
  }
}

for (const area of ['renderer', 'main', 'other']) {
  const entries = [...byArea[area]].sort((a, b) => b[1].size - a[1].size)
  const sites = entries.reduce((n, [, s]) => n + s.size, 0)
  console.log(`\n########## ${area.toUpperCase()}: ${entries.length} missing packages, ${sites} importing sites ##########`)
  for (const [pkg, files] of entries) console.log(`${String(files.size).padStart(4)}  ${pkg}`)
}
