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
    // Version ↔ asset linkage: assets are recorded per image, the version links to the image, and the
    // panel should show the derived list without storing the relation twice.
    const linkage = await evaluate(`(async () => {
      const works = await window.api.novelai.listWorks()
      const workId = works[0].id
      const bundle = await window.api.novelai.bundle({ workId })
      const version = bundle.line[bundle.line.length - 1]
      const asset = await window.api.novelai.assets.create({ kind: 'character', name: '联动素材', payload: 'rain' })
      await window.api.novelai.assets.use({ assetId: asset.id, imageId: 'img_matrix_link' })
      const before = await window.api.novelai.assets.byVersion(version.id)
      await window.api.novelai.linkImage({ versionId: version.id, imageId: 'img_matrix_link' })
      const after = await window.api.novelai.assets.byVersion(version.id)
      return { assetId: asset.id, versionId: version.id, before: before.length, after: after.map(item => item.asset.name) }
    })()`)
    journey.observations.linkage = linkage
    journey.checks.linkageNeedsBothSides = linkage.before === 0
    // Recording the image on the version is what closes the chain; do it and re-read.
    const linked = await evaluate(`(async () => {
      const works = await window.api.novelai.listWorks()
      const bundle = await window.api.novelai.bundle({ workId: works[0].id })
      const version = bundle.line[bundle.line.length - 1]
      const used = await window.api.novelai.assets.byVersion(version.id)
      return { used: used.map(item => item.asset.name) }
    })()`)
    journey.observations.linkage = linked
    journey.checks.versionAssetLinkage = Array.isArray(linked.used) && linked.used.includes('联动素材')
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

// Switch baseline visual check: the gallery filter rail is the densest place the new <Switch> appears.
if (process.argv.includes('--gallery')) {
  const report = { passed: false, checks: {} }
  try {
    const switched = await evaluate(`(() => { const sel = Array.from(document.querySelectorAll('select.ui-panel-select')).find(el => el.offsetParent !== null); if (!sel) return 'NO_SELECT'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'gallery-search'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`)
    report.checks.switched = switched === 'OK'
    for (let i = 0; i < 40; i++) { if (await evaluate(`!!document.querySelector('[data-panel-type="gallery-search"]')`)) break; await sleep(250) }
    report.checks.mounted = await evaluate(`!!document.querySelector('[data-panel-type="gallery-search"]')`)
    report.checks.switches = await evaluate(`document.querySelectorAll('[data-panel-type="gallery-search"] [role="switch"]').length`)
    report.shots = [await screenshot('gallery-01-switches')]
    report.passed = report.checks.switched && report.checks.mounted && report.checks.switches > 0
  } catch (error) { report.error = String(error) }
  console.log('GALLERY ' + JSON.stringify(report))
}

// Narrow-panel audit: every panel type is mounted in the same narrow column and measured. Two
// heuristics catch the failures screenshots already showed twice — text squeezed into a vertical
// strip (element narrower than 40px holding a real word) and containers that overflow horizontally.
if (process.argv.includes('--narrow-audit')) {
  const report = { passed: false, panels: [] }
  try {
    const only = (process.argv.find(item => item.startsWith('--narrow-only=')) || '').split('=')[1]
    // Width matrix: the same audit at several viewport widths, so "narrow looks fine" is not the only
    // data point. Layouts that only work at one width are the ones that break in real resizing.
    const widthArg = Number((process.argv.find(item => item.startsWith('--width=')) || '').split('=')[1])
    if (Number.isFinite(widthArg) && widthArg >= 320) {
      await callWithTimeout('Emulation.setDeviceMetricsOverride', { width: widthArg, height: 900, deviceScaleFactor: 1, mobile: false }, 10000)
      report.viewportWidth = widthArg
      await sleep(800)
    }
    const types = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('select.ui-panel-select option')).map(option => option.value)))`).then(list => only ? list.filter(item => item === only) : list)
    report.panelCount = types.length
    for (const type of types) {
      // The panel type travels through a page global: composing selectors with nested template literals
      // produced unparseable code twice while building this harness.
      await evaluate(`window.__auditType = ${JSON.stringify(type)}`)
      const switched = await evaluate(`(() => { const sel = Array.from(document.querySelectorAll('select.ui-panel-select')).find(el => el.offsetParent !== null); if (!sel) return 'NO_SELECT'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, window.__auditType); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`)
      if (switched !== 'OK') { report.panels.push({ type, error: switched }); continue }
      let mounted = false
      for (let i = 0; i < 24; i++) { if (await evaluate(`!!document.querySelector('[data-panel-type="' + window.__auditType + '"]')`)) { mounted = true; break } await sleep(250) }
      if (!mounted) { report.panels.push({ type, mounted: false }); continue }
      await sleep(400)
      const bodyText = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__auditType + '"]'); return host ? host.innerText.trim().length : -1 })()`)
      const measured = await evaluate(`(() => {
        const host = document.querySelector('[data-panel-type="' + window.__auditType + '"]')
        if (!host) return null
        const vertical = []
        // Collapsed/animated-away chrome is not a layout defect: skip anything invisible.
        const visible = (el) => { let node = el; while (node && node !== host.parentElement) { const style = getComputedStyle(node); if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false; node = node.parentElement } return true }
        for (const el of host.querySelectorAll('span,div,button,a,label,p,td,th,h1,h2,h3')) {
          const text = (el.innerText || '').trim()
          if (text.length < 4 || !visible(el)) continue
          const rect = el.getBoundingClientRect()
          // "Vertical text" means the block is at least three lines tall inside a strip: a 2-line title
          // is wrapping, not collapsing, and truncation is already deliberate.
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '16') || 16
          const lines = Math.round(rect.height / lineHeight)
          if (rect.width > 0 && rect.width < 60 && lines >= 3) {
            const chain = []
            let node = el.parentElement
            for (let depth = 0; depth < 3 && node; depth += 1) { chain.push((node.className || '').toString().slice(0, 90)); node = node.parentElement }
            vertical.push({ text: text.slice(0, 24), width: Math.round(rect.width), chain })
          }
        }
        // Only VISIBLE spill counts: a container that clips or scrolls its own content is handling it
        // (ellipsis, scrollbar). The defect is content escaping a box that does not.
        const overflow = []
        for (const el of host.querySelectorAll('*')) {
          if (el.scrollWidth <= el.clientWidth + 8 || el.clientWidth <= 0) continue
          const style = getComputedStyle(el)
          if (style.overflowX !== 'visible') continue
          overflow.push({ tag: el.tagName.toLowerCase(), scroll: el.scrollWidth, client: el.clientWidth })
        }
        const firstChild = host.firstElementChild
        return { vertical: vertical.slice(0, 6), overflow: overflow.slice(0, 6), width: Math.round(host.getBoundingClientRect().width), height: Math.round(host.getBoundingClientRect().height), firstChildHeight: firstChild ? Math.round(firstChild.getBoundingClientRect().height) : null }
      })()`)
      const children = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__auditType + '"]'); const body = host.querySelector('.ui-panel-content') || host; return Array.from(body.children).slice(0, 5).map(child => ({ tag: child.tagName.toLowerCase(), cls: (child.className || '').toString().slice(0, 60), h: Math.round(child.getBoundingClientRect().height) })) })()`)
      if (bodyText === 0) report.panels.push({ type, mounted: true, emptyBody: true })
      const widthTag = report.viewportWidth ? 'w' + report.viewportWidth + '-' : ''
      report.panels.push({ type, mounted: true, ...measured, shot: await screenshot(widthTag + 'narrow-' + type) })
    }
    const offenders = report.panels.filter(panel => panel.vertical?.length || panel.overflow?.length)
    report.offenderCount = offenders.length
    report.offenders = offenders.map(panel => panel.type)
    report.passed = true
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/narrow-audit.json', JSON.stringify(report, null, 2))
  // Ratchet: the audit is only useful if regressions fail. `narrow-baseline.json` records the number
  // of panels that were allowed to be broken when the audit was introduced; it must go down by hand.
  const baselinePath = 'scripts/narrow-baseline.json'
  let baseline = { offenders: 0 }
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) } catch {}
  // Budget per width: the default run must stay at 0, while the narrow-window run records a known debt
  // number (the four-column layout cannot work below ~240px per panel). Both ratchet downward only.
  const widthKey = report.viewportWidth ? 'offendersAt' + report.viewportWidth : 'offenders'
  const budget = typeof baseline[widthKey] === 'number' ? baseline[widthKey] : (report.viewportWidth ? Number.POSITIVE_INFINITY : 0)
  if (report.offenderCount > budget) {
    console.log('NARROW-FAIL offenders=' + report.offenderCount + ' budget=' + budget)
    process.exitCode = 1
  }
  console.log('NARROW ' + JSON.stringify({ panelCount: report.panelCount, offenderCount: report.offenderCount, budget, offenders: report.offenders }))
}

// Embedded browser journey: a REAL WebContentsView loaded through the real IPC host routes. The fake
// page is served locally so the assertion is about the host (rect, navigation, history), not a website.
if (process.argv.includes('--browser')) {
  const report = { passed: false, checks: {} }
  const http = await import('node:http')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><head><title>矩阵浏览器页</title></head><body><h1 id="h">hello</h1></body></html>')
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = server.address().port
    const url = 'http://127.0.0.1:' + port + '/page'
    const switched = await evaluate(`(() => { const sel = Array.from(document.querySelectorAll('select.ui-panel-select')).find(el => el.offsetParent !== null); if (!sel) return 'NO_SELECT'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'browser'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`)
    report.checks.panelSwitched = switched === 'OK'
    for (let i = 0; i < 40; i++) { if (await evaluate(`!!document.querySelector('[data-ui="browser.panel"]')`)) break; await sleep(250) }
    report.checks.panelMounted = await evaluate(`!!document.querySelector('[data-ui="browser.panel"]')`)
    await sleep(600)
    const navigated = await evaluate(`window.api.ipcApi.request('browser.host.navigate', { id: 'browser-panel', url: ${JSON.stringify(url)} })`)
    report.navigated = navigated?.data ?? navigated?.error ?? null
    report.checks.navigateAccepted = !!navigated && navigated.ok === true
    await sleep(2500)
    const history = await evaluate(`window.api.ipcApi.request('browser.history.list', { limit: 20 })`)
    const visits = (history?.data ?? [])
    report.visits = visits.slice(0, 3)
    report.checks.historyRecorded = visits.some(visit => String(visit.url).includes('/page'))
    report.checks.titleCaptured = visits.some(visit => String(visit.title).includes('矩阵浏览器页'))
    const host = await evaluate(`window.api.ipcApi.request('browser.host.get', { id: 'browser-panel' })`)
    report.host = host?.data ?? null
    report.checks.hostAlive = !!host && host.ok === true && host.data !== null
    report.shots = [await screenshot('browser-01-live')]
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) {
    report.error = String(error)
  } finally {
    await new Promise(resolve => server.close(() => resolve()))
  }
  fs.writeFileSync('artifacts/visual/ui-parity/browser-journey.json', JSON.stringify(report, null, 2))
  console.log('BROWSER ' + JSON.stringify({ passed: report.passed, checks: report.checks, visits: report.visits?.length }))
}

// Visual matrix: the same panel set at several viewport widths, in ONE session so the comparisons are
// taken against the same layout state. Output is per-width offender counts plus per-panel screenshots,
// which is what a "did the layout regress" review needs.
if (process.argv.includes('--visual-matrix')) {
  const widths = [1600, 1280, 960]
  const matrix = { passed: false, runs: [] }
  try {
    for (const width of widths) {
      await callWithTimeout('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, 10000)
      await sleep(700)
      const types = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('select.ui-panel-select option')).map(option => option.value)))`)
      const run = { width, panels: [] }
      for (const type of types) {
        // The panel type travels through a page global: composing selectors with nested template literals
        // produced unparseable code twice while building this harness.
        await evaluate(`window.__matrixType = ${JSON.stringify(type)}`)
        await evaluate(`(() => { const sel = Array.from(document.querySelectorAll('select.ui-panel-select')).find(el => el.offsetParent !== null); if (!sel) return 'NO_SELECT'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, window.__matrixType); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`)
        let mounted = false
        for (let i = 0; i < 20; i++) { if (await evaluate(`!!document.querySelector('[data-panel-type="' + window.__matrixType + '"]')`)) { mounted = true; break } await sleep(200) }
        if (!mounted) { run.panels.push({ type, mounted: false }); continue }
        await sleep(350)
        const measured = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__matrixType + '"]'); if (!host) return null; return { width: Math.round(host.getBoundingClientRect().width), height: Math.round(host.getBoundingClientRect().height) } })()`)
        // A panel that mounts but shows nothing is the failure mode screenshots caught by hand (the
        // canvas white screen). Text length makes it automatic; the two view-hosting panels are exempt
        // because their content is an iframe / native view that this probe cannot read.
        const textLength = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__matrixType + '"] .ui-panel-content') || document.querySelector('[data-panel-type="' + window.__matrixType + '"]'); return host ? (host.innerText || '').trim().length : -1 })()`)
        // A panel header has a fixed height. Anything inside it that grows (a wrapped row, a taller button)
        // is silently clipped — that is how the agent mode switcher lost its last three modes.
        const headerOverflow = await evaluate(`(() => { const header = document.querySelector('[data-panel-type="' + window.__matrixType + '"] [data-ui="panel.header"]'); if (!header) return 0; return Math.max(0, header.scrollHeight - header.clientHeight) })()`)
        run.panels.push({ type, mounted: true, panelWidth: measured?.width ?? null, textLength, headerOverflow, shot: await screenshot('w' + width + '-' + type) })
      }
      // The matrix switches ONE panel's type per step, so every step must be measured in the same column.
      // A run where the widths disagree means the layout drifted mid-sweep (a panel was maximized, a split
      // was resized, or restore picked another node) — the screenshots would then show different panels and
      // the numbers would silently describe a layout nobody asked for. Record it and fail.
      const widths = run.panels.map(panel => panel.panelWidth).filter(value => typeof value === 'number')
      const spread = widths.length ? Math.max(...widths) - Math.min(...widths) : 0
      if (spread > 2) run.layoutDrift = { min: Math.min(...widths), max: Math.max(...widths), spread }
      const VIEW_HOSTING = new Set(['canvas', 'browser'])
      const blank = run.panels.filter(panel => panel.mounted && panel.textLength === 0 && !VIEW_HOSTING.has(panel.type)).map(panel => panel.type)
      const clippedHeaders = run.panels.filter(panel => (panel.headerOverflow ?? 0) > 1).map(panel => panel.type)
      if (blank.length) run.blankPanels = blank
      if (clippedHeaders.length) run.clippedHeaders = clippedHeaders
      matrix.runs.push({ ...run, panelWidths: [...new Set(run.panels.map(panel => panel.panelWidth).filter(Boolean))].sort((a, b) => a - b) })
    }
    await callWithTimeout('Emulation.clearDeviceMetricsOverride', {}, 10000)
    matrix.passed = matrix.runs.every(run => run.panels.every(panel => panel.mounted))
  } catch (error) { matrix.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/visual-matrix.json', JSON.stringify(matrix, null, 2))
  console.log('MATRIX ' + JSON.stringify(matrix.runs.map(run => ({ width: run.width, panelWidths: run.panelWidths, mounted: run.panels.filter(panel => panel.mounted).length + '/' + run.panels.length, blank: run.blankPanels ?? [], clippedHeaders: run.clippedHeaders ?? [], drift: run.layoutDrift ?? null }))))
  const blankShortfall = matrix.runs.some(run => (run.blankPanels ?? []).length > 0) || matrix.runs.some(run => (run.clippedHeaders ?? []).length > 0) || matrix.runs.some(run => Boolean(run.layoutDrift))
  if (blankShortfall) process.exitCode = 1
  // Ratchet: a panel that stops mounting at any width is a regression even if every screenshot looks fine.
  let baseline = { minMountedPerWidth: 18 }
  try { baseline = JSON.parse(fs.readFileSync('scripts/visual-matrix-baseline.json', 'utf8')) } catch {}
  const shortfalls = matrix.runs.filter(run => run.panels.filter(panel => panel.mounted).length < (baseline.minMountedPerWidth ?? 18))
  if (shortfalls.length) {
    console.log('MATRIX-FAIL ' + JSON.stringify(shortfalls.map(run => ({ width: run.width, mounted: run.panels.filter(panel => panel.mounted).length }))))
    process.exitCode = 1
  }
  if (matrix.runs.length !== widths.length) process.exitCode = 1
}

// Tooltip journey (M1.5): hover a panel-header icon button and prove the themed bubble really appears.
// The unit test runs in jsdom; this one checks the real renderer, real positioning and real styling.
if (process.argv.includes('--tooltip')) {
  const report = { passed: false, checks: {} }
  try {
    const box = await evaluate(`(() => { const buttons = Array.from(document.querySelectorAll('.ui-icon-button')).filter(el => el.offsetParent !== null && el.getAttribute('aria-label')); const button = buttons[0]; if (!button) return null; const rect = button.getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), label: button.getAttribute('aria-label') } })()`)
    report.anchor = box
    if (!box) throw new Error('no icon button in a panel header')
    await callWithTimeout('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, 5000)
    await sleep(600)
    const bubble = await evaluate(`(() => { const tooltip = document.querySelector('[role="tooltip"]'); if (!tooltip) return null; const rect = tooltip.getBoundingClientRect(); const style = getComputedStyle(tooltip); return { text: (tooltip.textContent || '').trim(), top: Math.round(rect.top), height: Math.round(rect.height), background: style.backgroundColor, color: style.color, ariaDescribedBy: !!document.querySelector('[aria-describedby="' + tooltip.id + '"]') } })()`)
    report.bubble = bubble
    report.checks.bubbleVisible = !!bubble && bubble.height > 8
    report.checks.hasText = !!bubble && bubble.text.length > 0 && bubble.text.includes(String(box.label || '').slice(0, 2))
    report.checks.themedNotSystem = !!bubble && bubble.background !== 'rgba(0, 0, 0, 0)'
    report.checks.ariaLinked = !!bubble && bubble.ariaDescribedBy
    report.shots = [await screenshot('tooltip-01-hover')]
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/tooltip-journey.json', JSON.stringify(report, null, 2))
  console.log('TOOLTIP ' + JSON.stringify({ passed: report.passed, checks: report.checks, text: report.bubble?.text }))
  if (!report.passed) process.exitCode = 1
}

if (process.argv.some(argument => argument.startsWith('--measure='))) {
  const selector = process.argv.find(argument => argument.startsWith('--measure=')).slice('--measure='.length)
  const expression = '(() => { const panel = document.querySelector("[data-panel-type]") || document; return Array.from(panel.querySelectorAll(' + JSON.stringify(selector) + ')).slice(0, 6).map(element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { width: Math.round(rect.width), height: Math.round(rect.height), background: style.backgroundColor, border: style.borderColor, role: element.getAttribute("role") || element.type || "" } }) })()'
  console.log('MEASURE ' + selector + ' ' + JSON.stringify(await evaluate(expression)))
}

// `--comfy-persist` proves a page we own really persists: type into the ComfyUI address field, press
// 保存并连接, read the value back from SQLite through `settings.getAll`, then reload the panel and check the
// field shows the stored value. Asserting the input value alone would pass even if nothing was saved.
if (process.argv.includes('--comfy-persist')) {
  const report = { passed: false, checks: {} }
  const waitForLocal = async (expression, attempts = 120) => { for (let index = 0; index < attempts; index += 1) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  try {
    await waitForLocal(`!!document.querySelector('select.ui-panel-select')`)
    const switched = await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'comfyui'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    report.checks.panelOpened = switched === true
    await sleep(1200)
    const target = 'http://127.0.0.1:8199'
    const typed = await evaluate(`(() => { const input = document.querySelector('[data-panel-type="comfyui"] input.ui-field'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(target)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    report.checks.fieldTyped = typed === true
    await sleep(400)
    const clicked = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); if (!panel) return false; const button = Array.from(panel.querySelectorAll('button')).find(element => (element.textContent || '').includes('保存')); if (!button) return false; button.click(); return true })()`)
    report.checks.saveClicked = clicked === true
    await sleep(1200)
    const stored = await evaluate(`(async () => { const all = await window.api.settings.getAll(); return all.comfyui_base_url })()`)
    report.stored = stored
    report.checks.storedInDatabase = stored === target
    // Reload the panel by switching away and back: the field must come from the database, not from state.
    await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'tasks'); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await sleep(800)
    await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'comfyui'); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await sleep(1500)
    const shown = await evaluate(`(() => { const input = document.querySelector('[data-panel-type="comfyui"] input.ui-field'); return input ? input.value : null })()`)
    report.shownAfterReload = shown
    report.checks.restoredFromDatabase = shown === target
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/comfy-persist.json', JSON.stringify(report, null, 2))
  console.log('COMFY-PERSIST ' + JSON.stringify({ passed: report.passed, checks: report.checks, stored: report.stored, shown: report.shownAfterReload }))
  if (!report.passed) process.exitCode = 1
}

// `--style-contract` checks that the baseline classes are actually APPLIED, not merely present in the
// stylesheet. It builds throwaway elements with each class, reads computed styles, and compares against the
// values the vendored primitives dictate. A class that exists but lost its rule (typo, later override,
// cascade order) passes a grep and fails this.
if (process.argv.includes('--style-contract')) {
  const contract = [
    // Badge (source: rounded-full border px-2 py-0.5 text-xs gap-1 shrink-0 w-fit whitespace-nowrap)
    { className: 'ui-badge', tag: 'span', property: 'borderRadius', expect: '999px' },
    { className: 'ui-badge', tag: 'span', property: 'display', expect: 'inline-flex' },
    { className: 'ui-badge', tag: 'span', property: 'whiteSpace', expect: 'nowrap' },
    { className: 'ui-badge', tag: 'span', property: 'flexShrink', expect: '0' },
    { className: 'ui-badge', tag: 'span', property: 'gap', expect: '4px' },
    { className: 'ui-badge', tag: 'span', property: 'paddingTop', expect: '2px' },
    { className: 'ui-badge', tag: 'span', property: 'paddingLeft', expect: '7px' },
    // Inputs and controls (source: h-9 for the standard field, 32x18 / 26x15 switches)
    { className: 'ui-field', tag: 'input', property: 'height', expect: '36px' },
    { className: 'ui-switch', tag: 'button', property: 'width', expect: '32px' },
    { className: 'ui-switch', tag: 'button', property: 'height', expect: '18px' },
    { className: 'ui-switch ui-switch-sm', tag: 'button', property: 'width', expect: '26px' },
    { className: 'ui-checkbox', tag: 'input', property: 'width', expect: '16px' },
    { className: 'ui-checkbox', tag: 'input', property: 'borderRadius', expect: '4px' },
    { className: 'ui-radio', tag: 'input', property: 'borderRadius', expect: '999px' },
    { className: 'ui-icon-button', tag: 'button', property: 'width', expect: '30px' },
    // Segmented control (source: h-9 rounded-lg bg-muted p-[3px])
    { className: 'ui-segmented', tag: 'div', property: 'minHeight', expect: '36px' },
    { className: 'ui-segmented', tag: 'div', property: 'paddingTop', expect: '3px' },
    // Surfaces
    { className: 'ui-popover-surface', tag: 'div', property: 'borderRadius', expect: '8px' },
    { className: 'ui-popover-panel', tag: 'div', property: 'width', expect: '288px' },
    { className: 'ui-popover-panel', tag: 'div', property: 'paddingTop', expect: '16px' },
    { className: 'ui-tooltip', tag: 'div', property: 'position', expect: 'fixed' },
    { className: 'ui-tooltip', tag: 'div', property: 'paddingTop', expect: '6px' },
    { className: 'ui-nav-tab', tag: 'button', property: 'position', expect: 'relative' },
    { className: 'ui-nav-tab', tag: 'button', property: 'fontWeight', expect: '400' },
  ]
  const measured = await evaluate(`(() => { const contract = ${JSON.stringify('CONTRACT')}; return contract.map(item => { const element = document.createElement(item.tag); element.className = item.className; document.body.appendChild(element); const style = getComputedStyle(element); const value = style[item.property] || ''; element.remove(); return { className: item.className, property: item.property, expected: item.expect, actual: value, ok: value === item.expect } }) })()`.replace('"CONTRACT"', JSON.stringify(contract)))
  const failures = (measured || []).filter(item => !item.ok)
  fs.writeFileSync('artifacts/visual/ui-parity/style-contract.json', JSON.stringify({ passed: failures.length === 0, measured, failures }, null, 2))
  console.log('STYLE-CONTRACT ' + JSON.stringify({ passed: failures.length === 0, total: (measured || []).length, failures }))
  if (failures.length) process.exitCode = 1
}

// `--selection-popup` drives the floating selection assistant end to end: open it through IPC, find the
// second CDP target (the popup is its own BrowserWindow), click a real action button there, and assert the
// captured text came from the main process and that applying an action hides the window.
if (process.argv.includes('--selection-popup')) {
  const report = { passed: false, checks: {} }
  const targets = async () => (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json())
  try {
    const before = (await targets()).length
    await evaluate(`window.api.selection.open()`)
    await sleep(1500)
    const list = await targets()
    report.checks.popupWindowOpened = list.length > before
    const popup = list.find(item => item.url.includes('#selection-assistant'))
    report.popupUrl = popup?.url ?? null
    report.checks.popupHasRoute = Boolean(popup)
    if (popup) {
      const { WebSocket } = await import('ws')
      const socket = new WebSocket(popup.webSocketDebuggerUrl)
      await new Promise(resolve => socket.on('open', resolve))
      let id = 1
      const pending = new Map()
      socket.on('message', raw => { const message = JSON.parse(raw); const settle = pending.get(message.id); if (settle) { pending.delete(message.id); settle(message.result) } })
      const call = (method, params) => new Promise(resolve => { const current = id++; pending.set(current, resolve); socket.send(JSON.stringify({ id: current, method, params })) })
      await call('Runtime.enable', {})
      const evalIn = async expression => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 15000 })).result?.value
      const bodyText = await evalIn(`document.body.innerText`)
      report.popupText = String(bodyText ?? '').slice(0, 120)
      report.checks.showsTitle = /划词助手/.test(String(bodyText ?? ''))
      const buttons = await evalIn(`Array.from(document.querySelectorAll('button')).map(button => button.textContent || '')`)
      report.buttons = buttons
      report.checks.hasThreeActions = (buttons ?? []).filter(label => /复制为标签语法|复制为单行|存为提示词素材/.test(label)).length === 3
      const clicked = await evalIn(`(() => { const button = Array.from(document.querySelectorAll('button')).find(item => /复制为单行/.test(item.textContent || '')); if (!button) return false; button.click(); return true })()`)
      report.checks.actionClicked = clicked === true
      socket.close()
      await sleep(1200)
      const after = (await targets()).filter(item => item.url.includes('#selection-assistant'))
      report.checks.hiddenAfterApply = after.length > 0
    }
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/selection-popup.json', JSON.stringify(report, null, 2))
  console.log('SELECTION-POPUP ' + JSON.stringify({ passed: report.passed, checks: report.checks, text: report.popupText }))
  if (!report.passed) process.exitCode = 1
}

// `--slim` lists the narrowest elements inside the audited panel. It exists because a sliver in a
// screenshot (the 8px strip beside 输出) cannot be identified by eye and a selector guess may miss it.
if (process.argv.includes('--slim')) {
  const expression = '(() => { const panel = document.querySelector("[data-panel-type]") || document; return Array.from(panel.querySelectorAll("*")).map(element => { const rect = element.getBoundingClientRect(); return { tag: element.tagName.toLowerCase(), cls: (element.className || "").toString().slice(0, 50), w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.left) } }).filter(item => item.w > 0 && item.w < 20 && item.h > 8).slice(0, 12) })()'
  console.log('SLIM ' + JSON.stringify(await evaluate(expression)))
}
console.log(JSON.stringify(report, null, 2))
ws.close()
killTree()
process.exit(report.ok ? 0 : 1)
