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
//  * The main window is NOT ready when its target appears: startup (DB init + built-in asset
//    import) takes ~17s here, and probing earlier sees `about:blank`. Wait for body text.
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
  // `npx vite` spawns a real node child; killing the npx wrapper leaves the dev server alive and
  // each aborted run used to leak ~1.3 GB. Kill by the port this run chose.
  spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*--port " + devPort + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
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
let forcedNavigation = false
const report_forcing = () => console.log('FORCED_NAVIGATION')
for (let attempt = 0; attempt < 120; attempt += 1) {
  // The unpackaged window sometimes sits on `about:blank` even though its target URL is the dev
  // server (observed on this host). One explicit Page.navigate gets it going; we record that it
  // was needed instead of hiding it.
  if (!forcedNavigation && attempt === 30 && pageInfo && !pageInfo.bodyChars) {
    forcedNavigation = true
    report_forcing?.()
    await call('Page.navigate', { url: devUrl })
    await sleep(1500)
  }
  await sleep(500)
  try { pageInfo = await evaluate('({ href: location.href, title: document.title, bodyChars: document.body.innerText.length })') } catch { pageInfo = null }
  if (pageInfo && pageInfo.bodyChars > 20) break
}
if (!pageInfo || !pageInfo.bodyChars) { console.log(JSON.stringify({ ok: false, error: 'WINDOW_NOT_RENDERED', pageInfo, debugPort }, null, 2)); ws.close(); killTree(); process.exit(1) }

const report = { ok: false, pageInfo, forcedNavigation, shots: [], tabs: [], panels: [], errors: [], consoleErrors: [] }
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

// Workbench click journey (M6 UI). Runs inside the real main window: switches an existing panel
// to 提示词工作台 through its own header select, then drives create → edit → save → delete →
// restore with real DOM events, screenshotting each state.
if (process.argv.includes('--workbench')) {
  const journey = { passed: false, checks: {}, shots: [], errors: [] }
  const setValue = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'MISSING';
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return 'OK';
  })()`
  const waitFor = async (expression, attempts = 80) => { for (let i = 0; i < attempts; i++) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  try {
    // Open the panel through the product's own add-menu (real clicks on real buttons). Seeding
    // the workspace document was rejected earlier: the renderer keeps its own layout snapshot in
    // localStorage, so a stored document alone does not change what is on screen.
    // Target a real (non-system) panel: the tag sidebar is a system panel whose header has no
    // add-menu behaviour, so clicking its '+' did nothing and the panel never appeared.
    const trigger = await evaluate(`(() => { const hosts = Array.from(document.querySelectorAll('[data-ui="panel.shell"]')).filter(el => el.offsetParent !== null); const host = hosts.find(el => el.getAttribute('data-panel-type') !== 'tag-sidebar') || hosts[0]; const button = host && host.querySelector('button[title="添加面板"]'); if (!button) return 'NO_BUTTON'; button.click(); return 'OK' })()`)
    await waitFor(`!!document.querySelector('.ui-popover-menu button.ui-menu-item')`, 60)
    const added = await evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.ui-popover-menu button.ui-menu-item')).find(el => el.textContent.trim() === '提示词工作台')
      if (!item) return 'MISSING'
      item.click()
      return 'OK'
    })()`)
    journey.observations = { added }
    if (added !== 'OK') throw new Error('workbench menu item not found')
    await sleep(1200)
    journey.afterAdd = await evaluate(`({ panels: Array.from(document.querySelectorAll('[data-ui="panel.shell"]')).map(el => el.getAttribute('data-panel-type')), hasPanel: !!document.querySelector('[data-panel-type="novelai-workbench"]'), bodySnippet: document.body.innerText.slice(0, 400) })`)
    journey.shots.push(await screenshot('wb-00-added'))
    await waitFor(`!!document.querySelector('[aria-label="新建作品"]')`, 60)
    journey.shots.push(await screenshot('wb-01-empty'))
    await evaluate(setValue('input[placeholder="新作品名"]', '交叉矩阵作品'))
    await evaluate(`document.querySelector('[aria-label="新建作品"]').click()`)
    await waitFor(`!!document.querySelector('[aria-label="提示词原文"]')`)
    journey.checks.createdWork = true
    await evaluate(setValue('textarea[aria-label="提示词原文"]', '1girl, {{long hair}}, __sky*2__'))
    await waitFor(`document.body.innerText.includes('随机块')`)
    journey.checks.blockView = true
    journey.shots.push(await screenshot('wb-02-blocks'))
    await evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('保存为新版本')).click()`)
    await waitFor(`Array.from(document.querySelectorAll('button')).filter(el => el.textContent.trim().startsWith('v')).length >= 2`)
    journey.checks.savedVersion = true
    journey.shots.push(await screenshot('wb-03-two-versions'))
    await evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('删此版本')).click()`)
    // Assert on the same API the panel uses; the old check searched page text for 「回收站」, which
    // exists elsewhere in the app and made a failed delete look successful.
    const deletedState = await waitFor(`(async () => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); if (!panel) return null; const works = await window.api.novelai.listWorks(); if (!works.length) return null; const bundle = await window.api.novelai.bundle({ workId: works[0].id }); return bundle && bundle.deleted.length === 1 ? { deleted: bundle.deleted.length } : null })()`, 60)
    journey.observations.deletedState = deletedState
    journey.checks.deletedVersion = true
    journey.shots.push(await screenshot('wb-04-recycle'))
    const restoreClicked = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); if (!panel) return 'NO_PANEL'; const button = Array.from(panel.querySelectorAll('button')).find(el => el.textContent.trim() === 'v2'); if (!button) return 'NO_BUTTON'; button.click(); return 'OK' })()`)
    journey.observations.restoreClicked = restoreClicked
    const restoredState = await waitFor(`(async () => { const works = await window.api.novelai.listWorks(); if (!works.length) return null; const bundle = await window.api.novelai.bundle({ workId: works[0].id }); return bundle && bundle.deleted.length === 0 && bundle.line.length === 2 ? { line: bundle.line.length } : null })()`, 60)
    journey.observations.restoredState = restoredState
    journey.checks.restoredVersion = true
    // Branch from an older version: the service forks when the parent already has a child, so this
    // exercises the real branching rule rather than a UI-only flag.
    const branchFrom = await evaluate(`(() => { const button = document.querySelector('[aria-label="从 v1 开新分支"]'); if (!button) return 'NO_BUTTON'; button.click(); return 'OK' })()`)
    journey.observations.branchFrom = branchFrom
    await waitFor(`(() => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); return !!panel && panel.innerText.indexOf('将从 v1 开新分支') >= 0 })()`, 40)
    await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); const area = panel && panel.querySelector('textarea'); if (!area) return 'NO_AREA'; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, '1girl, {{long hair}}, 分支线'); area.dispatchEvent(new Event('input', { bubbles: true })); return 'OK' })()`)
    await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); const button = Array.from(panel.querySelectorAll('button')).find(el => el.textContent.includes('保存为新版本')); if (!button) return 'NO_SAVE'; button.click(); return 'OK' })()`)
    const branched = await waitFor(`(async () => { const works = await window.api.novelai.listWorks(); if (!works.length) return null; const branches = await window.api.novelai.listBranches(works[0].id); return branches.length === 2 ? branches.map(branch => branch.size) : null })()`, 60)
    journey.observations.branches = branched
    journey.checks.branchedFromVersion = Array.isArray(branched) && branched.length === 2
    journey.shots.push(await screenshot('wb-06-branches'))
    journey.workbenchText = await evaluate(`(document.querySelector('[data-panel-type="novelai-workbench"]') || document.body).innerText.slice(0, 400)`)
    journey.shots.push(await screenshot('wb-05-restored'))
    journey.passed = Object.values(journey.checks).every(Boolean)
  } catch (error) {
    journey.error = String(error)
    journey.panelText = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); return panel ? panel.innerText.slice(0, 700) : 'NO_PANEL' })()`).catch(() => null)
    journey.shots.push(await screenshot('wb-99-failure').catch(() => null))
  }
  console.log('WORKBENCH ' + JSON.stringify(journey))
  if (!journey.passed) console.error('WORKBENCH_JOURNEY_FAILED')
}

// Asset library journey (M6 UI). Same approach as --workbench: switch a real panel to 素材库, then
// create → record usage → reverse lookup → delete with the service holding the rules.
if (process.argv.includes('--assets')) {
  const journey = { passed: false, checks: {}, shots: [] }
  const setValue = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'MISSING'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'OK' })()`
  const waitFor = async (expression, attempts = 80) => { for (let i = 0; i < attempts; i++) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  try {
    const switched = await evaluate(`(() => { const sel = Array.from(document.querySelectorAll('select.ui-panel-select')).find(el => el.offsetParent !== null); if (!sel) return 'NO_SELECT'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'novelai-assets'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`)
    if (switched !== 'OK') throw new Error('panel switch failed: ' + switched)
    await waitFor(`!!document.querySelector('[aria-label="新素材名"]')`)
    journey.shots.push(await screenshot('as-01-empty'))
    await evaluate(setValue('input[aria-label="新素材名"]', '雨中少女'))
    await evaluate(`document.querySelector('[aria-label="新建素材"]').click()`)
    await waitFor(`document.body.innerText.includes('雨中少女')`)
    journey.checks.createdAsset = true
    await evaluate(setValue('input[aria-label="图片 ID"]', 'img_matrix'))
    await evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('记一次引用')).click()`)
    const usage = await waitFor(`(async () => { const list = await window.api.novelai.assets.list(); const asset = list.find(item => item.name === '雨中少女'); if (!asset) return null; const images = await window.api.novelai.assets.images(asset.id); return images.length === 1 && images[0].imageId === 'img_matrix' ? { assetId: asset.id, images } : null })()`)
    journey.observations = { usage }
    journey.checks.recordedUsage = true
    journey.shots.push(await screenshot('as-02-usage'))
    await evaluate(setValue('input[aria-label="反查图片 ID"]', 'img_matrix'))
    await evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '反查').click()`)
    await waitFor(`document.body.innerText.includes('雨中少女')`)
    const lookedUp = await evaluate(`(async () => { const list = await window.api.novelai.assets.byImage('img_matrix'); return list.map(item => item.name) })()`)
    journey.observations.lookedUp = lookedUp
    journey.checks.reverseLookup = Array.isArray(lookedUp) && lookedUp.includes('雨中少女')
    journey.shots.push(await screenshot('as-03-lookup'))
    await evaluate(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('删除素材')).click()`)
    const removed = await waitFor(`(async () => { const list = await window.api.novelai.assets.list(); return list.length === 0 ? true : null })()`)
    journey.checks.deletedAsset = removed === true
    journey.shots.push(await screenshot('as-04-deleted'))
    journey.passed = Object.values(journey.checks).every(Boolean)
  } catch (error) {
    journey.error = String(error)
    journey.state = await evaluate(`(document.querySelector('[data-panel-type="novelai-assets"]') || document.body).innerText.slice(0, 500)`).catch(() => null)
  }
  console.log('ASSETS ' + JSON.stringify(journey))
}
console.log(JSON.stringify(report, null, 2))
ws.close()
killTree()
process.exit(report.ok ? 0 : 1)
