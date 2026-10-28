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
const TWO_COLUMN_ROW = /className="flex[^"]*"/g

// `components/dev/` holds full-window preview pages, not panels, so viewport breakpoints are correct there.
const findings = []
const EXCLUDED = ['components' + path.sep + 'dev' + path.sep, 'components' + path.sep + 'settings' + path.sep + 'SettingsWindow.tsx']
for (const file of walk(COMPONENTS).filter(item => !EXCLUDED.some(pattern => item.includes(pattern)))) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(ROOT, file).replace(/\\/g, '/')
  for (const line of source.split('\n')) {
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
