#!/usr/bin/env node
// Main-window click + screenshot harness (M1.5.6 / cross-matrix).
//
// Drives REAL mouse events through CDP against the Grimoire main window: clicks every
// workspace tab and every panel header, screenshots each state, and fails when the renderer
// logged an error. Screenshots land in artifacts/visual/ui-parity for visual comparison.
//
// KNOWN ISSUE (2026-10-27): while unpackaged the main window loads the Vite dev server, and a
// stale Electron left over from an earlier run keeps a CDP port alive whose page is
// `about:blank`; this harness then drives the wrong window. It currently reports
// WINDOW_NEVER_NAVIGATED instead of screenshotting. Fix before relying on it: give each run a
// fresh debug port AND kill leftovers of the same user-data-dir first (or run the app with a
// dedicated --user-data-dir that no previous run used and assert the page URL before clicking).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-ui-parity-'))
const debugPort = 9400 + Math.floor(Math.random() * 90)
const outDir = path.join(root, 'artifacts', 'visual', 'ui-parity')
fs.mkdirSync(outDir, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function teardown() {
  if (process.platform !== 'win32') return
  spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*" + userData + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
}

spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.', '--user-data-dir=' + userData, '--remote-debugging-port=' + debugPort], {
  cwd: root,
  // The main window loads the Vite dev server while unpackaged (a file:// URL is rejected by
  // the app's navigation guard, which left an about:blank document). Start `vite` first.
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: 'ignore',
  shell: process.platform === 'win32',
})

let target = null
for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
  await sleep(1000)
  try {
    const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json()
    // Wait for the real window, not an auxiliary about:blank page that Electron creates first.
    // Dev-server URL (http://localhost:5173/) or a built file both count.
    target = list.find(entry => entry.url && (entry.url.includes('index.html') || entry.url.includes('localhost:5173')))
  } catch {}
}
if (!target) { console.log(JSON.stringify({ ok: false, error: 'NO_MAIN_WINDOW' })); teardown(); process.exit(1) }

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let nextId = 1
const pending = new Map()
const consoleErrors = []
socket.onmessage = event => {
  let message
  try { message = JSON.parse(event.data) } catch { return }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push((message.params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '))
  }
  const settle = pending.get(message.id)
  if (!settle) return
  pending.delete(message.id)
  settle(message.result)
}
const send = (method, params) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
await send('Runtime.enable', {})
await send('Page.enable', {})
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 20000 })
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''))
  return result?.result?.value
}
async function screenshot(name) {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }),
    new Promise(resolve => setTimeout(() => resolve(null), 15000)),
  ])
  if (!shot) throw new Error('SCREENSHOT_TIMEOUT:' + name)
  const file = path.join(outDir, name + '.png')
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return path.basename(file)
}
async function clickAt(selector) {
  const box = await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
  if (!box) return false
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(500)
  return true
}

// The window exists before it navigates; poll until the app document is really there.
let pageInfo = null
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(500)
  try {
    pageInfo = await evaluate('({ href: location.href, title: document.title, visibility: document.visibilityState, bodyChars: document.body.innerText.length })')
  } catch { pageInfo = null }
  if (pageInfo && String(pageInfo.href).includes('index.html') && pageInfo.bodyChars > 0) break
}
console.log('PAGE ' + JSON.stringify(pageInfo))
if (!pageInfo || !String(pageInfo.href).includes('index.html')) {
  console.log(JSON.stringify({ ok: false, error: 'WINDOW_NEVER_NAVIGATED', pageInfo }, null, 2))
  socket.close(); teardown(); process.exit(1)
}
const report = { ok: false, shots: [], tabs: [], panels: [], errors: [] }
report.shots.push(await screenshot('00-initial'))

const tabs = await evaluate('Array.from(document.querySelectorAll(\'[data-ui="workspace.tab"]\')).map((el, index) => ({ index, id: el.getAttribute(\'data-workspace-id\'), label: (el.textContent || \'\').trim() }))')
report.tabs = tabs || []
for (const tab of report.tabs) {
  const clicked = await clickAt('[data-ui="workspace.tab"][data-workspace-id="' + tab.id + '"]')
  report.shots.push(await screenshot('tab-' + String(tab.index + 1).padStart(2, '0') + '-' + String(tab.label || tab.id).replace(/[^\p{L}\p{N}-]+/gu, '_')))
  if (!clicked) report.errors.push('tab click failed: ' + tab.id)
}

const panels = await evaluate('Array.from(document.querySelectorAll(\'[data-ui="panel.shell"]\')).map((el, index) => ({ index, type: el.getAttribute(\'data-panel-type\') }))')
report.panels = panels || []
for (const panel of report.panels) {
  const clicked = await clickAt('[data-ui="panel.shell"][data-panel-type="' + panel.type + '"] [data-ui="panel.header"]')
  report.shots.push(await screenshot('panel-' + String(panel.index + 1).padStart(2, '0') + '-' + panel.type))
  if (!clicked) report.errors.push('panel header click failed: ' + panel.type)
}

report.consoleErrors = consoleErrors.filter(line => line && !line.includes('Electron Security Warning'))
report.ok = report.errors.length === 0 && report.consoleErrors.length === 0 && report.shots.length >= 1 + report.tabs.length
console.log(JSON.stringify(report, null, 2))
socket.close()
teardown()
process.exit(report.ok ? 0 : 1)
