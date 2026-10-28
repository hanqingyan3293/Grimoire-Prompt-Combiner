#!/usr/bin/env node
// Route coverage (G10): every route a MOUNTED source page calls must have a handler in this process.
//
// Without this, a page keeps rendering while one of its buttons silently falls through to the generic
// "unknown route" error that the source code catches and logs. That is indistinguishable from a working
// button unless someone clicks every one of them.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const MOUNTED_PAGES = [
  'src/vendor/cherry/source/src/renderer/pages/settings/GeneralSettings',
  'src/vendor/cherry/source/src/renderer/pages/settings/ToolSettings/ApiGatewaySettings',
  'src/vendor/cherry/source/src/renderer/pages/settings/WebSearchSettings',
  'src/vendor/cherry/source/src/renderer/pages/settings/ScreenshotSettings',
  'src/vendor/cherry/source/src/renderer/pages/settings/BrowserSettings.tsx',
  'src/vendor/cherry/source/src/renderer/pages/settings/AboutSettings',
  'src/vendor/cherry/source/src/renderer/pages/settings/settingsSearch',
]
const HANDLED_FILES = [
  'src/main/ipc/cherry-data-api.ipc.ts',
  'src/main/ipc/novelai.ipc.ts',
  'src/main/ipc/screenshot.ipc.ts',
  'src/main/ipc/settings.ipc.ts',
  'src/main/index.ts',
]

function walk(target, out = []) {
  const stat = fs.statSync(target, { throwIfNoEntry: false })
  if (!stat) return out
  if (stat.isFile()) { out.push(target); return out }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    walk(path.join(target, entry.name), out)
  }
  return out
}

const requested = new Map()
for (const page of MOUNTED_PAGES) {
  for (const file of walk(path.join(ROOT, page))) {
    if (!/\.(ts|tsx)$/.test(file) || /\.test\./.test(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/ipcApi\s*\.\s*request\(\s*'([^']+)'/g)) {
      if (!requested.has(match[1])) requested.set(match[1], path.relative(ROOT, file))
    }
  }
}

const handled = new Set()
for (const file of HANDLED_FILES) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
  for (const match of source.matchAll(/route === '([^']+)'/g)) handled.add(match[1])
}

const missing = [...requested.keys()].filter(route => !handled.has(route))
if (missing.length) {
  console.log('ROUTE-COVERAGE-FAIL requested=' + requested.size + ' missing=' + missing.length)
  for (const route of missing) console.log('  ' + route + '   <- ' + requested.get(route))
  process.exit(1)
}
console.log('route coverage OK (' + requested.size + ' routes requested by mounted pages, all handled)')
