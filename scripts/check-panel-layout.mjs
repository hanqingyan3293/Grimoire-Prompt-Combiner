#!/usr/bin/env node
// Panel layout check (G9).
//
// Three separate panels shipped the same defect: two columns squeezed together in a narrow panel, so
// text rendered one character per line. Each was fixed by hand; this keeps the class from coming back.
//
// Two rules, both learned from real breakage:
//   1. A row with fixed-width columns must be allowed to wrap (`flex-wrap`) or give the flexible column
//      a minimum width — otherwise the flexible one collapses.
//   2. Viewport breakpoints (`sm:` / `md:` / `lg:` / `xl:`) must not be used inside panels: panel width
//      does not follow viewport width (1280px window → 280px panel), so those classes lie.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const COMPONENTS = path.join(ROOT, 'src/renderer/components')
const BASELINE = path.join(ROOT, 'scripts/panel-layout-baseline.json')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

const VIEWPORT_BREAKPOINT = /className=(?:"|'|\{`)([^"'`]*\b(?:sm|md|lg|xl|2xl):[^"'`]*)/g
// Rule 3: a fixed grid of 3+ columns has no idea how wide it will be. At a 210px panel each cell of
// `grid-cols-3` is ~60px, which is how the image-library buttons ended up one character per line.
const FIXED_GRID = /className=(?:"|'|\{`)([^"'`]*\bgrid-cols-([3-9])\b[^"'`]*)/g
const TWO_COLUMN_ROW = /className="flex[^"]*"/g

// `components/dev/` holds full-window preview pages, not panels, so viewport breakpoints are correct there.
const findings = []
const EXCLUDED = ['components' + path.sep + 'dev' + path.sep, 'components' + path.sep + 'settings' + path.sep + 'SettingsWindow.tsx']
for (const file of walk(COMPONENTS).filter(item => !EXCLUDED.some(pattern => item.includes(pattern)))) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(ROOT, file).replace(/\\/g, '/')
  for (const line of source.split('\n')) {
    const grid = FIXED_GRID.exec(line)
    if (grid && !/min-w-|auto-fit|auto-fill|minmax/.test(grid[1])) findings.push({ kind: 'fixed-grid', file: relative, detail: grid[1].slice(0, 80) })
    FIXED_GRID.lastIndex = 0
    const breakpoint = VIEWPORT_BREAKPOINT.exec(line)
    if (breakpoint) findings.push({ kind: 'viewport-breakpoint', file: relative, detail: breakpoint[1].slice(0, 80) })
    VIEWPORT_BREAKPOINT.lastIndex = 0
    // A row that pairs a shrink-0 fixed column with a flexible one must wrap or give the flexible side
    // a minimum width; this is the exact shape that produced the vertical-text bug.
    // The real defect shape: a fixed column next to a flexible one, with nothing to wrap or absorb it.
    const row = /className="(flex[^"]*)"/.exec(line)
    if (row && /shrink-0/.test(row[1]) && /(^|\s)flex-1(\s|$)/.test(row[1]) && !/flex-wrap|flex-col|min-w-/.test(row[1])) {
      findings.push({ kind: 'unwrapped-row', file: relative, detail: line.trim().slice(0, 80) })
    }
  }
}

// Rule 4: an ENABLED panel type must have a render branch. A type that is offered in the panel picker but
// falls through to the placeholder branch ships "面板尚未接入" as if it were a feature — the exact filler
// this project keeps removing. Disabled legacy types are allowed to have no branch.
const REGISTRY = path.join(ROOT, 'src/renderer/components/workspace/PanelRegistry.tsx')
try {
  const registry = fs.readFileSync(REGISTRY, 'utf8')
  const enabledTypes = [...registry.matchAll(/type: "([a-z0-9-]+)"[^}]*enabled: true/g)].map(match => match[1])
  const cases = new Set([...registry.matchAll(/case "([a-z0-9-]+)":/g)].map(match => match[1]))
  for (const type of enabledTypes) {
    if (!cases.has(type)) findings.push({ kind: 'enabled-without-branch', file: 'PanelRegistry.tsx', detail: type })
  }
} catch (error) {
  findings.push({ kind: 'registry-unreadable', file: 'PanelRegistry.tsx', detail: String(error) })
}

let baseline = { findings: 0, allow: [] }
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch {}
const budget = typeof baseline.findings === 'number' ? baseline.findings : 0

if (process.argv.includes('--write-baseline')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ findings: findings.length, allow: [] }, null, 2) + '\n')
  console.log('panel-layout baseline written: ' + findings.length)
  process.exit(0)
}

const byKind = findings.reduce((acc, item) => { acc[item.kind] = (acc[item.kind] || 0) + 1; return acc }, {})
if (findings.length > budget) {
  console.log('PANEL-LAYOUT-FAIL findings=' + findings.length + ' budget=' + budget + ' ' + JSON.stringify(byKind))
  for (const item of findings.slice(0, 12)) console.log('  ' + item.kind + '  ' + item.file + '  ' + item.detail)
  process.exit(1)
}
console.log('panel-layout OK (' + findings.length + '/' + budget + ' allowed) ' + JSON.stringify(byKind))
