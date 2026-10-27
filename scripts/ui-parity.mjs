#!/usr/bin/env node
// Main-window click + screenshot harness (M1.5.6 / cross-matrix).
//
// Isolation rules that were learned the hard way:
//  * The unpackaged main window loads the Vite dev server, so the harness starts ONE vite on a
//    dedicated port and points the app at it (a file:// URL is rejected by the navigation guard).
//  * CDP port 0 + the `DevToolsActivePort` file means we always talk to the instance we started;
//    a fixed/random port can belong to a leftover Electron from a previous run, whose page is
//    `about:blank` — that is exactly how the first version drove the wrong window.
//  * Before clicking, the page URL and body text are asserted, not assumed.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const devPort = 5200 + Math.floor(Math.random() * 60)
const devUrl = 'http://localhost:' + devPort
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-ui-parity-'))
const outDir = path.join(root, 'artifacts', 'visual', 'ui-parity')
fs.mkdirSync(outDir, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const children = []
function killTree() {
  for (const child of children) { try { child.kill('SIGKILL') } catch {} }
  if (process.platform !== 'win32') return
  spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*" + userData.replace(/\\/g, '\\\\') + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
}

const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(devPort), '--strictPort'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' })
children.push(vite)
let devReady = false
for (let attempt = 0; attempt < 60 && !devReady; attempt += 1) {
  await sleep(1000)
  try { devReady = (await fetch(devUrl)).ok } catch {}
}
if (!devReady) { console.log(JSON.stringify({ ok: false, error: 'VITE_NOT_READY', devUrl })); killTree(); process.exit(1) }

const electron = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.', '--user-data-dir=' + userData, '--remote-debugging-port=0'], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VITE_DEV_SERVER_URL: devUrl },
  stdio: 'ignore',
  shell: process.platform === 'win32',
})
children.push(electron)

const portFile = path.join(userData, 'DevToolsActivePort')
let debugPort = 0
for (let attempt = 0; attempt < 90 && !debugPort; attempt += 1) {
  await sleep(500)
  try {
    const raw = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
    const parsed = Number(raw[0])
    if (Number.isInteger(parsed) && parsed > 0) debugPort = parsed
  } catch {}
}
if (!debugPort) { console.log(JSON.stringify({ ok: false, error: 'NO_DEBUG_PORT' })); killTree(); process.exit(1) }

let target = null
for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
  await sleep(500)
  try {
    const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json()
    target = list.find(entry => entry.url && entry.url.startsWith(devUrl))
  } catch {}
}
if (!target) { console.log(JSON.stringify({ ok: false, error: 'NO_MAIN_WINDOW', debugPort })); killTree(); process.exit(1) }

const { WebSocket } = await import('ws')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
let nextId = 1
const pending = new Map()
const consoleErrors = []
ws.on('message', raw => {
  let message
  try { message = JSON.parse(raw) } catch { return }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push((message.params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '))
  }
  const settle = pending.get(message.id)
  if (!settle) return
  pending.delete(message.id)
  settle(message.result)
})
const call = (method, params) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
const callWithTimeout = (method, params, ms) => Promise.race([call(method, params), sleep(ms).then(() => null)])
await call('Runtime.enable', {})
await call('Page.enable', {})
async function evaluate(expression) {
  const result = await callWithTimeout('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 20000 }, 25000)
  if (!result) throw new Error('EVALUATE_TIMEOUT')
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''))
  return result.result?.value
}
async function screenshot(name) {
  const shot = await callWithTimeout('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 20000)
  if (!shot) throw new Error('SCREENSHOT_TIMEOUT:' + name)
  const file = path.join(outDir, name + '.png')
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return path.basename(file)
}
async function clickAt(selector) {
  const box = await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()')
  if (!box) return false
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(600)
  return true
}

let pageInfo = null
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(500)
  try { pageInfo = await evaluate('({ href: location.href, title: document.title, bodyChars: document.body.innerText.length })') } catch { pageInfo = null }
  if (pageInfo && pageInfo.bodyChars > 20) break
}
if (!pageInfo || !pageInfo.bodyChars) { console.log(JSON.stringify({ ok: false, error: 'WINDOW_NOT_RENDERED', pageInfo, debugPort }, null, 2)); ws.close(); killTree(); process.exit(1) }

const report = { ok: false, pageInfo, shots: [], tabs: [], panels: [], errors: [], consoleErrors: [] }
report.shots.push(await screenshot('00-initial'))

const tabs = await evaluate('Array.from(document.querySelectorAll(\'[data-ui="workspace.tab"]\')).map((el, index) => ({ index, id: el.getAttribute(\'data-workspace-id\'), label: (el.textContent || \'\').trim() }))')
report.tabs = tabs || []
for (const tab of report.tabs) {
  const clicked = await clickAt('[data-ui="workspace.tab"][data-workspace-id="' + tab.id + '"]')
  const safe = String(tab.label || tab.id || 'tab').replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 24)
  report.shots.push(await screenshot('tab-' + String(tab.index + 1).padStart(2, '0') + '-' + safe))
  if (!clicked) report.errors.push('tab click failed: ' + tab.id)
}

const panels = await evaluate('Array.from(document.querySelectorAll(\'[data-ui="panel.shell"]\')).map((el, index) => ({ index, type: el.getAttribute(\'data-panel-type\') }))')
report.panels = panels || []
for (const panel of report.panels) {
  const clicked = await clickAt('[data-ui="panel.shell"][data-panel-type="' + panel.type + '"] [data-ui="panel.header"]')
  report.shots.push(await screenshot('panel-' + String(panel.index + 1).padStart(2, '0') + '-' + String(panel.type).replace(/[^a-zA-Z0-9-]+/g, '_')))
  if (!clicked) report.errors.push('panel header click failed: ' + panel.type)
}

report.consoleErrors = consoleErrors.filter(line => line && !line.includes('Electron Security Warning'))
report.ok = report.errors.length === 0 && report.consoleErrors.length === 0
console.log(JSON.stringify(report, null, 2))
ws.close()
killTree()
process.exit(report.ok ? 0 : 1)
