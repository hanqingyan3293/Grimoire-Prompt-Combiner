// Audits every DataSettings panel in ONE launched window and reports, per panel,
// whether the source component rendered and which `window.api.*` surfaces its actions
// need. One launch for all thirteen beats thirteen launches, and the per-panel verdict is
// what the migration matrix needs — "the rail lists it" is not "the panel works".
//
// Requires a prior `npm run build`: the window loads the COMPILED preload from
// `dist/preload/index.js`, so a helper added to `src/preload/index.ts` still reports
// `undefined` here until the build runs. That is a harness property, not a bug.
//
//   npm run audit:cherry-panels
//
// Two probes, both needed:
//   - panel walk: deep-links `#/settings/data?panel=<key>` and reads the content column.
//     Rendering is the weaker claim; it does not prove any action works.
//   - api surface + path-helper round trip: an `undefined` helper is reported FAIL-style,
//     and the round trip catches a helper that exists but resolves to a constant or to its
//     input unchanged. Checking `typeof === 'function'` alone would pass for both.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-panels-'))
const outDir = path.join(root, 'artifacts/visual/cherry-panels')
fs.mkdirSync(outDir, { recursive: true })

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.', `--user-data-dir=${userData}`, '--remote-debugging-port=9345'],
  {
    cwd: root,
    env: { ...process.env, GRIMOIRE_OPEN_CHERRY: '1', GRIMOIRE_CAPTURE_ROUTE: 'settings/data' },
    stdio: 'ignore',
    shell: process.platform === 'win32'
  }
)

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Tears down the Electron process tree this script launched.
 *
 * `child.kill()` is NOT enough: the child is `npx`, which spawns Electron as its own child,
 * so signalling the launcher leaves the app (and its renderer/gpu/utility children) running.
 * Those orphans keep holding the DevTools port, so the NEXT run's CDP lookup connects to the
 * OLD instance — which is serving the bundle from when it started. That produced a bug that
 * looked exactly like a product failure: a newly registered route reported `路由未实现` in
 * full-suite runs while passing in isolation, because the audit was driving a stale app.
 * Verified: 70 orphaned Electron processes had accumulated, one tree per earlier run.
 *
 * On Windows the tree is killed by image name, scoped to THIS run's `--user-data-dir` so a
 * parallel session's Electron is never touched. Elsewhere, the process group is signalled.
 */
async function teardown(child, userData) {
  if (process.platform === 'win32') {
    const { spawnSync } = await import('node:child_process')
    const ps = [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${userData}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    ]
    spawnSync('powershell.exe', ps, { stdio: 'ignore' })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

// The window must reach the data route before the panel walk starts; a fixed settle
// that races the first paint would report every panel as missing.
let target = null
for (let i = 0; i < 90 && !target; i++) {
  await sleep(1000)
  try {
    const list = await (await fetch('http://127.0.0.1:9345/json/list')).json()
    // Select the CHERRY window explicitly: `includes('index.html')` also matches the main
    // renderer and a Vite dev server (`http://localhost:5173/`) from a parallel session, so
    // the audit could drive the wrong window — see the same fix in audit-cherry-routes.mjs.
    target = list.find(t => t.url && t.url.includes('cherry') && t.url.includes('index.html'))
      || list.find(t => t.title === 'Cherry Compatibility Surface')
  } catch {}
}
if (!target) {
  // Distinguish "no Cherry window" from "CDP never came up" — a run that silently
  // audited nothing is worse than one that reports why.
  console.log('NO_TARGET: 未找到 Cherry 兼容窗口（可能只有主窗口/dev server 在监听）')
  await teardown(child, userData)
  process.exit(1)
}

const { WebSocket } = await import('ws').catch(() => ({ WebSocket: null }))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => ws.on('open', r))
// ONE message listener with a pending-request map, not a listener added/removed per call.
// A per-call listener that is never removed (any call that times out) accumulates across
// the panel loop, and `Math.random()` ids collide over a run's ~30 round trips — both were
// observed in the sibling route audit as an unexplained `undefined` for whichever panel was
// in flight.
let nextId = 1
const pending = new Map()
ws.on('message', data => {
  let message
  try {
    message = JSON.parse(data)
  } catch {
    return
  }
  if (message.id === undefined) return
  const settle = pending.get(message.id)
  if (!settle) return
  pending.delete(message.id)
  settle(message.result)
})
/** One CDP call with a hard timeout; a timed-out call's pending entry is dropped. */
async function callWithTimeout(method, params, timeoutMs = 12000) {
  let id = null
  const call = new Promise(resolve => {
    id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const result = await Promise.race([call, sleep(timeoutMs).then(() => undefined)])
  if (id !== null) pending.delete(id)
  return result ?? null
}
const evaluate = async expression =>
  (await callWithTimeout('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value

await callWithTimeout('Runtime.enable', {}, 10000)
await sleep(6000)

// Which Cherry preload surfaces these panels call, and whether they exist. A panel that
// renders while its primary action is `undefined` is the "looks migrated" failure this
// walk exists to catch.
console.log(
  'api-surfaces:',
  await evaluate(`JSON.stringify({
    resolvePath: typeof window.api?.resolvePath,
    isPathInside: typeof window.api?.isPathInside,
    hasWritePermission: typeof window.api?.hasWritePermission,
    'backup.listWebdavFiles': typeof window.api?.backup?.listWebdavFiles,
    'backup.deleteWebdavFile': typeof window.api?.backup?.deleteWebdavFile,
    'backup.listS3Files': typeof window.api?.backup?.listS3Files,
    'backup.restoreFromS3': typeof window.api?.backup?.restoreFromS3,
    'nutstore.getSSOUrl': typeof window.api?.nutstore?.getSSOUrl,
    'file.selectFolder': typeof window.api?.file?.selectFolder
  })`)
)

// Existence is not behaviour: exercise the round trip so a helper that resolves to a
// constant (or to the input unchanged) is caught here rather than at the call site.
console.log(
  'path-helper-roundtrip:',
  await evaluate(`(async () => JSON.stringify({
    resolveTilde: await window.api.resolvePath('~'),
    resolveDots: await window.api.resolvePath('C:/a/../b'),
    insideEqual: await window.api.isPathInside('C:/app', 'C:/app'),
    insideChild: await window.api.isPathInside('C:/app/sub', 'C:/app'),
    insideSibling: await window.api.isPathInside('C:/app aaa', 'C:/app'),
    insideEscape: await window.api.isPathInside('C:/app/../out', 'C:/app'),
    writeTmp: await window.api.hasWritePermission(window.api?.__tmp || 'C:/')
  }))()`)
)

// The source `DATA_PANEL_KEYS` order. Only the keys are needed: the walk deep-links by
// hash, so it never has to guess a panel's rendered label.
const PANELS = [
  'data',
  'local_backup',
  'webdav',
  'nutstore',
  's3',
  'import_settings',
  'export_menu',
  'markdown_export',
  'notion',
  'yuque',
  'joplin',
  'obsidian',
  'siyuan'
]

// Deep-link each panel by hash — the same path a `?panel=` URL or a settings search
// jump takes, and one that does not depend on guessing the rail's rendered labels.
// The content column is source `SettingsContentColumn`'s inner `max-w-3xl`, so measuring
// it (rather than the widest div, which is the app shell) reports the panel's own text.
const failed = []
for (const key of PANELS) {
  const verdict = await evaluate(`(async () => {
    window.location.hash = '#/settings/data?panel=' + ${JSON.stringify(key)}
    await new Promise(r => setTimeout(r, 1600))
    const hash = window.location.hash
    const dialogs = document.querySelectorAll('[role="dialog"]').length
    const col = document.querySelector('[data-theme-mode] > div')
    const text = col ? (col.innerText || '').trim() : ''
    const boundary = /出错了|Something went wrong|Component Error|渲染失败/.test(text)
    return JSON.stringify({
      rendered: text.length > 0 && !boundary && hash.includes('panel=' + ${JSON.stringify(key)}),
      boundary,
      chars: text.length,
      dialogs,
      hash,
      head: text.slice(0, 130).replace(/\\s+/g, ' ')
    })
  })()`)
  let parsed
  try {
    parsed = JSON.parse(verdict)
  } catch {
    parsed = { rendered: false, reason: 'probe_error', raw: String(verdict).slice(0, 160) }
  }
  if (!parsed.rendered) failed.push(key)
  console.log(String(key).padEnd(17), parsed.rendered ? 'OK  ' : 'FAIL', JSON.stringify(parsed))
  await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000).then(shot => {
    if (shot?.data) fs.writeFileSync(path.join(outDir, `panel-${key}.png`), Buffer.from(shot.data, 'base64'))
  })
}

// Non-zero exit on a panel that did not render, so this can gate a milestone instead of
// being read as a report. A `FAIL` line in scrollback is easy to miss.
console.log(
  failed.length === 0
    ? `\nall ${PANELS.length} panels rendered; screenshots in ${path.relative(root, outDir)}`
    : `\n${failed.length}/${PANELS.length} panels did not render: ${failed.join(', ')}`
)
if (failed.length) process.exitCode = 1

ws.close()
await teardown(child, userData)
// `process.exitCode`, not `process.exit(0)` — the latter discards the failure set above
// and would report a walk with dead panels as a clean run.
setTimeout(() => process.exit(process.exitCode ?? 0), 1500)
