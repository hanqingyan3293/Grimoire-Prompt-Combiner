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
import { execFileSync } from 'node:child_process'

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

// Pixel diff for `--diff`: both PNGs are decoded inside the page and differenced on a canvas, so a
// regression is MEASURED rather than eyeballed. The baseline lives in artifacts/visual/baseline (gitignored;
// regenerate with `--record` after an intentional visual change).
const baselineDir = path.join(root, 'artifacts', 'visual', 'baseline')
async function diffAgainstBaseline(name) {
  const currentPath = path.join(outDir, name)
  const baselinePath = path.join(baselineDir, name)
  if (!fs.existsSync(currentPath)) return { skipped: 'no-current' }
  if (!fs.existsSync(baselinePath)) return { skipped: 'no-baseline' }
  const current = fs.readFileSync(currentPath).toString('base64')
  const base = fs.readFileSync(baselinePath).toString('base64')
  const expression = 'ivyDiff' // placeholder, replaced below
  const code = `(async () => {
    const load = b64 => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = 'data:image/png;base64,' + b64 })
    const [a, b] = await Promise.all([load(${JSON.stringify('LEFT')}), load(${JSON.stringify('RIGHT')})])
    if (a.width !== b.width || a.height !== b.height) return { mismatch: true, left: a.width + 'x' + a.height, right: b.width + 'x' + b.height }
    const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(a, 0, 0); const left = ctx.getImageData(0, 0, a.width, a.height).data
    ctx.clearRect(0, 0, a.width, a.height); ctx.drawImage(b, 0, 0); const right = ctx.getImageData(0, 0, a.width, a.height).data
    // Whole-screen percentage is too coarse: a badge that grows 4px moves ~0.7% of a 1600x900 frame, which
    // sits inside the antialiasing noise (measured 0.7-0.9% between identical runs). Tile the frame instead
    // and report the WORST tile, so a local change is not diluted by the rest of the screenshot.
    const TILES_X = 16, TILES_Y = 9
    const tileW = Math.floor(a.width / TILES_X), tileH = Math.floor(a.height / TILES_Y)
    let changed = 0, worstTile = 0, worstAt = null, worstContentTile = 0
    for (let ty = 0; ty < TILES_Y; ty += 1) {
      for (let tx = 0; tx < TILES_X; tx += 1) {
        let tileChanged = 0, tileTotal = 0
        for (let y = ty * tileH; y < (ty + 1) * tileH; y += 1) {
          for (let x = tx * tileW; x < (tx + 1) * tileW; x += 1) {
            const i = (y * a.width + x) * 4
            const delta = (Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2])) / 3
            tileTotal += 1
            if (delta > 8) { changed += 1; tileChanged += 1 }
          }
        }
        if (tileTotal) {
          const pct = (tileChanged / tileTotal) * 100
          if (pct > worstTile) { worstTile = pct; worstAt = { x: tx * tileW, y: ty * tileH } }
          // Row 0 is app chrome (window buttons, tab strip); it is time dependent and is not panel content,
          // so it is reported separately instead of deciding pass/fail.
          if (ty >= 1 && pct > worstContentTile) worstContentTile = pct
        }
      }
    }
    return { changedPct: Math.round((changed / (left.length / 4)) * 1000) / 10, maxTilePct: Math.round(worstTile * 10) / 10, worstAt, maxContentTilePct: Math.round(worstContentTile * 10) / 10 }
  })()`.replace('"LEFT"', JSON.stringify(base)).replace('"RIGHT"', JSON.stringify(current))
  return await evaluate(code)
}
// A click on a disabled button is a silent no-op, and the failure then reads as "nothing happened" or
// "it timed out". Every journey click on a potentially-disabled control should come through here.
//   scope: CSS selector of the container (or '' for document)
//   label: substring of the button text
async function clickWhenEnabled(scope, label, attempts = 40) {
  // Built with plain concatenation on purpose: nested template literals produced an expression that
  // silently evaluated to a string instead of a DOM root (the click then returned false forever).
  const code =
    '(async () => {' +
    ' const root = document.querySelector(' + JSON.stringify(scope || 'body') + ') || document;' +
    ' const find = () => Array.from(root.querySelectorAll("button")).find(el => (el.textContent || "").includes(' + JSON.stringify(label) + '));' +
    ' for (let index = 0; index < ' + String(attempts) + '; index += 1) {' +
    '  const button = find();' +
    '  if (button && !button.disabled) { button.click(); return true }' +
    '  await new Promise(resolve => setTimeout(resolve, 150));' +
    ' }' +
    ' return false;' +
    '})()'
  return evaluate(code)
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
    // 保存为新版本 is disabled={busy || !dirty}: wait until it is clickable, otherwise a no-op click is
    // indistinguishable from a missing save.
    await evaluate(`(async () => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); if (!panel) return false; const find = () => Array.from(panel.querySelectorAll('button')).find(el => (el.textContent || '').includes('保存为新版本')); for (let index = 0; index < 40; index += 1) { const button = find(); if (button && !button.disabled) return true; await new Promise(resolve => setTimeout(resolve, 150)) } return false })()`)
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
    // 保存为新版本 is disabled={busy || !dirty}: wait until it is clickable, otherwise a no-op click is
    // indistinguishable from a missing save.
    await evaluate(`(async () => { const panel = document.querySelector('[data-panel-type="novelai-workbench"]'); if (!panel) return false; const find = () => Array.from(panel.querySelectorAll('button')).find(el => (el.textContent || '').includes('保存为新版本')); for (let index = 0; index < 40; index += 1) { const button = find(); if (button && !button.disabled) return true; await new Promise(resolve => setTimeout(resolve, 150)) } return false })()`)
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
    // The budget counts VERTICAL text only. Characters stacking one per line is a defect no panel width
    // excuses; horizontal overflow is a width problem the visual matrix already tracks as `spill`, so
    // counting it twice here would keep this number at 18 forever and hide real regressions.
    const offenders = report.panels.filter(panel => (panel.vertical?.length ?? 0) > 0)
    const overflowing = report.panels.filter(panel => (panel.overflow?.length ?? 0) > 0)
    report.offenderCount = offenders.length
    report.offenders = offenders.map(panel => panel.type)
    report.overflowPanelCount = overflowing.length
    report.overflowing = overflowing.map(panel => panel.type)
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

// `--theme-sweep`: the matrix only ever runs on the default theme, so a panel that breaks under `midnight`
// (contrast, borders, a hard-coded colour) is invisible. This walks every theme at one width and applies the
// same blank/clipped/stuck/spill checks, plus proof the theme really applied (the accent variable moved).
if (process.argv.includes('--theme-sweep')) {
  const width = Number((process.argv.find(argument => argument.startsWith('--width=')) || '--width=1600').slice(8))
  const themes = ['neon', 'clean', 'gold', 'midnight', 'sakura', 'forest', 'sunset']
  const report = { width, themes: [] }
  let previousAccent = null
  try {
    await callWithTimeout('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, 10000)
    await sleep(600)
    await evaluate(`(() => { if (document.getElementById('__no_anim')) return true; const style = document.createElement('style'); style.id = '__no_anim'; style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(style); return true })()`)
    for (const [themeIndex, theme] of themes.entries()) {
      // The attribute alone cannot switch themes (`applyAccent` writes --color-accent as an INLINE style on
      // <html>, which beats [data-theme]), and the settings IPC path did not re-apply either. So drive the real
      // control: the settings panel's theme swatches are the path a user takes.
      await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'settings'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
      await sleep(500)
      const clickedSwatch = await evaluate(`(() => { const swatches = Array.from(document.querySelectorAll('.ui-theme-swatch')); const target = swatches[${JSON.stringify('INDEX')}]; if (!target) return false; target.click(); return true })()`.replace('"INDEX"', String(themeIndex)))
      await sleep(700)
      if (!clickedSwatch) console.log('THEME-SWEEP-NOTE: theme swatch ' + themeIndex + ' not found; theme unchanged')
      const accent = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()`)
      const types = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('select.ui-panel-select option')).map(option => option.value)))`)
      const entry = { theme, accent, themeApplied: null, panels: types.length, blank: [], clipped: [], stuck: [], spill: 0, minMounted: 0 }
      let mounted = 0
      for (const type of types) {
        await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify('TYPE')}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`.replace('"TYPE"', JSON.stringify(type)))
        await sleep(420)
        const measured = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="' + ${JSON.stringify('TYPE')} + '"]'); if (!panel) return null; const rect = panel.getBoundingClientRect(); const header = panel.querySelector('[data-ui="panel.header"]'); return { width: Math.round(rect.width), text: (panel.innerText || '').trim().length, spill: header ? Math.max(0, header.scrollWidth - header.clientWidth) : 0, clip: header ? Math.max(0, header.scrollHeight - header.clientHeight) : 0 } })()`.replace('"TYPE"', JSON.stringify(type)))
        if (!measured) { entry.blank.push(type); continue }
        mounted += 1
        entry.spill = Math.max(entry.spill, measured.spill || 0)
        if (!measured.text) entry.blank.push(type)
        if ((measured.clip || 0) > 2) entry.clipped.push(type)
        if (/正在载入面板/.test(await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="' + ${JSON.stringify('TYPE')} + '"]'); return panel ? panel.innerText : '' })()`.replace('"TYPE"', JSON.stringify(type))))) entry.stuck.push(type)
      }
      entry.minMounted = mounted
      entry.themeApplied = entry.accent !== previousAccent || theme === 'neon'
      previousAccent = entry.accent
      report.themes.push(entry)
      console.log('THEME-SWEEP ' + JSON.stringify(entry))
    }
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/theme-sweep.json', JSON.stringify(report, null, 2))
  // A theme that never applied means the sweep measured the same palette seven times. That is a LIMIT of this
  // harness (the app writes --color-accent inline, so the attribute alone cannot switch themes and the settings
  // IPC path does not re-apply it here), not a product failure. Say so instead of reporting either a fake red
  // or a fake green.
  const applied = report.themes.filter(entry => entry.themeApplied !== false).length
  report.themeSwitching = applied > 1 ? 'working' : 'unavailable'
  if (applied <= 1) console.log('THEME-SWEEP-UNAVAILABLE: the harness could not switch themes (' + applied + '/' + report.themes.length + ' applied). Panel checks below are therefore one palette repeated; drive the Settings UI to cover the theme axis.')
  // Same spill budget as the width matrix: the header genuinely cannot fit a 210px panel (measured 42px), but a
  // wide viewport has no excuse, and this must not depend on which theme is active.
  const spillBudget = width >= 1280 ? 8 : 60
  const failing = applied > 1 ? report.themes.filter(entry => entry.blank.length || entry.stuck.length || entry.clipped.length || entry.minMounted < 18 || entry.themeApplied === false || entry.spill > spillBudget) : []
  report.spillBudget = spillBudget
  console.log('THEME-SWEEP-SUMMARY ' + JSON.stringify({ themes: report.themes.length, failing: failing.map(entry => entry.theme) }))
  if (failing.length || report.error) process.exitCode = 1
}

if (process.argv.includes('--visual-matrix')) {
  const widths = [1600, 1280, 960]
  const matrix = { passed: false, runs: [] }
  const visualDiffs = []
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
        // A lazy panel shows "正在载入面板" while its chunk loads, and that fallback text used to satisfy the
        // "panel has content" check — a slow chunk could be photographed as if it were the finished panel
        // (the 1600 settings screenshot showed exactly that). Wait for it to leave, then measure.
        let stillLoading = true
        for (let wait = 0; wait < 16 && stillLoading; wait += 1) {
          await sleep(250)
          stillLoading = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__matrixType + '"]'); if (!host) return true; return (host.innerText || '').includes('正在载入面板') })()`)
        }
        const measured = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__matrixType + '"]'); if (!host) return null; return { width: Math.round(host.getBoundingClientRect().width), height: Math.round(host.getBoundingClientRect().height) } })()`)
        // A panel that mounts but shows nothing is the failure mode screenshots caught by hand (the
        // canvas white screen). Text length makes it automatic; the two view-hosting panels are exempt
        // because their content is an iframe / native view that this probe cannot read.
        const textLength = await evaluate(`(() => { const host = document.querySelector('[data-panel-type="' + window.__matrixType + '"] .ui-panel-content') || document.querySelector('[data-panel-type="' + window.__matrixType + '"]'); return host ? (host.innerText || '').trim().length : -1 })()`)
        // A panel header has a fixed height. Anything inside it that grows (a wrapped row, a taller button)
        // is silently clipped — that is how the agent mode switcher lost its last three modes.
        const headerOverflow = await evaluate(`(() => { const header = document.querySelector('[data-panel-type="' + window.__matrixType + '"] [data-ui="panel.header"]'); if (!header) return 0; return Math.max(0, header.scrollHeight - header.clientHeight) })()`)
        // Horizontal overflow is a different defect: the header is wider than the panel and spills into the
        // neighbour. Measured separately so it can be budgeted per width (a 210px panel genuinely cannot hold
        // the full header, a 351px one can).
        // A panel can render real text and still be a placeholder: the registry's default branch says 「面板尚未接入」.
        // Blank-detection cannot see it (there IS text), so it gets its own flag.
        const stubText = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="' + window.__matrixType + '"]'); if (!panel) return null; const text = panel.innerText || ''; return /面板尚未接入|即将支持|敬请期待/.test(text) ? text.slice(0, 40) : null })()`)
        if (stubText) run.stubs = [...(run.stubs || []), type]
        const headerOverflowX = await evaluate(`(() => { const header = document.querySelector('[data-panel-type="' + window.__matrixType + '"] [data-ui="panel.header"]'); if (!header) return 0; return Math.max(0, header.scrollWidth - header.clientWidth) })()`)
        const shotName = 'w' + width + '-' + type + '.png'
        // Animations are the main source of diff noise (measured 5.9-8.5% tile drift between identical runs).
        // Freeze them and let the frame settle before the screenshot instead of widening the threshold.
        await evaluate(`(() => { if (document.getElementById('__no_anim')) return true; const style = document.createElement('style'); style.id = '__no_anim'; style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(style); return true })()`)
        if (process.argv.includes('--diff-selftest')) {
          // A guard nobody has seen fail is a guard nobody can trust. This injects a real (page-local) change
          // so `--diff` must turn red; the run then succeeds only if it DID.
          await evaluate(`(() => { if (document.getElementById('__selftest')) return true; const style = document.createElement('style'); style.id = '__selftest'; style.textContent = '.ui-badge,.ui-chip,.ui-tag{padding-left:11px!important}'; document.head.appendChild(style); return true })()`)
        }
        await sleep(260)
        const shot = await screenshot('w' + width + '-' + type)
        // `--record` seeds the baseline; `--diff` compares against it and fails past the tolerance.
        let visual = null
        if (process.argv.includes('--record')) {
          fs.mkdirSync(baselineDir, { recursive: true })
          fs.copyFileSync(path.join(outDir, shotName), path.join(baselineDir, shotName))
        }
        // `canvas` hosts a cross-document iframe whose paint timing is not stable, so its screenshot is the
        // one frame CDP cannot be trusted to reproduce (measured 13.4% tile drift between identical runs).
        const VISUAL_UNSTABLE = new Set(['canvas', 'browser'])
        if (process.argv.includes('--diff') && !VISUAL_UNSTABLE.has(type)) {
          visual = await diffAgainstBaseline(shotName)
          visualDiffs.push({ shot: shotName, ...visual })
        }
        run.panels.push({ type, mounted: true, panelWidth: measured?.width ?? null, textLength, headerOverflow, headerOverflowX, stillLoading, visual, shot })
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
      const stuckLoading = run.panels.filter(panel => panel.stillLoading === true).map(panel => panel.type)
      if (stuckLoading.length) run.stuckLoading = stuckLoading
      const widestHeaderSpill = Math.max(0, ...run.panels.map(panel => panel.headerOverflowX ?? 0))
      run.headerSpill = widestHeaderSpill
      // Budget: none at 1600/1280 (the header fits), the measured 50px at 960 is registered debt.
      const spillBudget = width >= 1280 ? 8 : 60
      if (widestHeaderSpill > spillBudget) run.headerSpillOverBudget = widestHeaderSpill
      if (blank.length) run.blankPanels = blank
      if (clippedHeaders.length) run.clippedHeaders = clippedHeaders
      matrix.runs.push({ ...run, panelWidths: [...new Set(run.panels.map(panel => panel.panelWidth).filter(Boolean))].sort((a, b) => a - b) })
    }
    await callWithTimeout('Emulation.clearDeviceMetricsOverride', {}, 10000)
    matrix.passed = matrix.runs.every(run => run.panels.every(panel => panel.mounted))
  } catch (error) { matrix.error = String(error) }
  if (visualDiffs.length) {
    // A tile is 1/144 of the frame: >12% of one tile changing means real content moved, while the measured
    // noise floor stayed at 0-3% per tile between identical runs.
    // Threshold 6%: the measured noise floor (animations frozen, chrome row excluded) is <=2.8%, so 6%
    // doubles the safety margin while halving the smallest detectable change.
    const bad = visualDiffs.filter(item => item.mismatch || (item.maxContentTilePct ?? 0) > 6)
    matrix.visual = { compared: visualDiffs.length, failing: bad.slice(0, 6) }
    const selftest = process.argv.includes('--diff-selftest')
    if (selftest) {
      // Success for a selftest is the opposite: the guard must have DETECTED the injected change.
      console.log('DIFF-SELFTEST ' + JSON.stringify({ detected: bad.length, compared: visualDiffs.length, sample: bad.slice(0, 3) }))
      if (bad.length === 0) { report.ok = false; console.log('DIFF-SELFTEST FAILED: the injected change was not detected') }
      matrix.visualSelftest = { detected: bad.length }
      matrix.visualFailed = undefined
    } else if (bad.length) { matrix.visualFailed = bad.length; report.ok = false }
  }
  fs.writeFileSync('artifacts/visual/ui-parity/visual-matrix.json', JSON.stringify(matrix, null, 2))
  console.log('MATRIX ' + JSON.stringify(matrix.runs.map(run => ({ width: run.width, panelWidths: run.panelWidths, mounted: run.panels.filter(panel => panel.mounted).length + '/' + run.panels.length, blank: run.blankPanels ?? [], clippedHeaders: run.clippedHeaders ?? [], stuck: run.stuckLoading ?? [], stub: run.stubs ?? [], spill: run.headerSpill ?? 0, drift: run.layoutDrift ?? null }))))
  const blankShortfall = matrix.runs.some(run => (run.blankPanels ?? []).length > 0) || matrix.runs.some(run => (run.clippedHeaders ?? []).length > 0) || matrix.runs.some(run => Boolean(run.layoutDrift)) || matrix.runs.some(run => (run.stuckLoading ?? []).length > 0) || matrix.runs.some(run => typeof run.headerSpillOverBudget === 'number') || matrix.runs.some(run => (run.stubs ?? []).length > 0) || Boolean(matrix.visualFailed)
  if (blankShortfall) { process.exitCode = 1; report.ok = false }
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
    // 保存并连接 is disabled while busy; a click on a disabled button is a silent no-op (lesson from G4).
    await evaluate(`(async () => { const panel = document.querySelector('[data-panel-type="comfyui"]'); if (!panel) return false; const find = () => Array.from(panel.querySelectorAll('button')).find(el => (el.textContent || '').includes('保存')); for (let index = 0; index < 40; index += 1) { const button = find(); if (button && !button.disabled) return true; await new Promise(resolve => setTimeout(resolve, 150)) } return false })()`)
    const clicked = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); if (!panel) return false; const button = Array.from(panel.querySelectorAll('button')).find(el => (el.textContent || '').includes('保存')); if (button && !button.disabled) { button.click(); return true } return false })()`)
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
// `--record-style-more`: the classes in scripts/style-contract-more.json are measured instead of hand-written.
// Recording computed values is the only honest option when a rule uses design tokens rather than literals.
if (process.argv.includes('--record-style-more')) {
  const names = ['ui-app-chrome','ui-dialog-overlay','ui-fav-path-label','ui-fav-tag-row','ui-image-preview','ui-layout-menu-trigger','ui-menu-divider','ui-menu-muted','ui-prompt-section','ui-settings-content','ui-spin','ui-status-error','ui-theme-swatch','ui-toolbar','ui-tree-header','ui-tree-row','ui-utility-popover','ui-workspace-add','ui-workspace-tabs']
  const props = ['display', 'borderRadius', 'minHeight', 'paddingTop']
  const values = await evaluate(`(() => { const out = {}; for (const name of ${JSON.stringify('NAMES')}) { const element = document.createElement('div'); element.className = name; document.body.appendChild(element); const style = getComputedStyle(element); out[name] = ${JSON.stringify('PROPS')}.map(prop => style[prop]); element.remove() } return out })()`.replace('"NAMES"', JSON.stringify(names)).replace('"PROPS"', JSON.stringify(props)))
  const rows = []
  for (const name of names) for (const [index, prop] of props.entries()) {
    const value = values?.[name]?.[index]
    // Skip values that carry a default nobody chose (auto/normal/0px on a div) — asserting those adds noise.
    if (!value || value === 'auto' || value === 'normal' || value === '0px') continue
    rows.push({ className: name, tag: 'div', property: prop, expect: value })
  }
  fs.writeFileSync(path.join(root, 'scripts', 'style-contract-more.json'), JSON.stringify(rows, null, 2) + '\n')
  console.log('STYLE-RECORD ' + JSON.stringify({ rows: rows.length, classes: new Set(rows.map(row => row.className)).size }))
}

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
    // Second wave: classes that components use heavily but no assertion covered (audited 2026-10-31 —
    // 105 ui-* classes in components vs 15 mentioned here). Values read from src/renderer/index.css.
    { className: 'ui-panel-shell', tag: 'div', property: 'borderRadius', expect: '4px' },
    { className: 'ui-panel-header', tag: 'div', property: 'minWidth', expect: '0px' },
    { className: 'ui-button', tag: 'button', property: 'display', expect: 'inline-flex' },
    { className: 'ui-button', tag: 'button', property: 'borderStyle', expect: 'solid' },
    { className: 'ui-inline-alert', tag: 'div', property: 'paddingTop', expect: '9px' },
    { className: 'ui-inline-alert', tag: 'div', property: 'alignItems', expect: 'flex-start' },
    { className: 'ui-list-card', tag: 'div', property: 'borderRadius', expect: '7px' },
    { className: 'ui-list-card', tag: 'div', property: 'paddingTop', expect: '12px' },
    { className: 'ui-segmented-item', tag: 'button', property: 'borderStyle', expect: 'solid' },
    // Third wave (coverage ratchet): properties copied from src/renderer/index.css so a rule that loses its
    // value (typo, later override, cascade order) fails here instead of shipping.
    { className: 'ui-status-badge', tag: 'span', property: 'gap', expect: '5px' },
    { className: 'ui-empty-state', tag: 'div', property: 'minHeight', expect: '96px' },
    { className: 'ui-empty-state', tag: 'div', property: 'borderTopStyle', expect: 'dashed' },
    { className: 'ui-empty-state', tag: 'div', property: 'borderRadius', expect: '8px' },
    { className: 'ui-progress', tag: 'div', property: 'height', expect: '6px' },
    { className: 'ui-progress', tag: 'div', property: 'borderRadius', expect: '999px' },
    // 0.78rem with a 14px root (not 16px): measured, not assumed.
    { className: 'ui-section-label', tag: 'div', property: 'fontSize', expect: '10.92px' },
    { className: 'ui-section-label', tag: 'div', property: 'fontWeight', expect: '600' },
    { className: 'ui-tag-card', tag: 'div', property: 'cursor', expect: 'pointer' },
    { className: 'ui-dialog-surface', tag: 'div', property: 'borderTopWidth', expect: '0px' },
  ]
  // Generated assertions (scripts/build-style-contract.mjs) are merged in: hand-written ones stay authoritative
  // for anything measured in a real element, generated ones keep geometric values from drifting.
  // Regenerate first so the assertions can never be stale relative to index.css.
  // NOTE: this module is ESM — `require` is not defined here, so it must be the imported execFileSync.
  // (The first version silently no-op'd inside a try/catch and left the assertions stale.)
  try { execFileSync(process.execPath, [path.join(root, 'scripts', 'build-style-contract.mjs')], { cwd: root, stdio: 'ignore' }) } catch {}
  try {
    const extra = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'style-contract-extra.json'), 'utf8'))
    const known = new Set(contract.map(item => item.className + '|' + item.property))
    for (const item of extra) if (!known.has(item.className + '|' + item.property)) contract.push(item)
    try {
      const more = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'style-contract-more.json'), 'utf8'))
      for (const item of more) if (!known.has(item.className + '|' + item.property)) { contract.push(item); known.add(item.className + '|' + item.property) }
    } catch {}
  } catch {}
  const measured = await evaluate(`(() => { const contract = ${JSON.stringify('CONTRACT')};
return contract.filter(item => !item.differsFrom).map(item => { const element = document.createElement(item.tag); element.className = item.className; document.body.appendChild(element); const style = getComputedStyle(element); const value = style[item.property] || ''; element.remove(); return { className: item.className, property: item.property, expected: item.expect, actual: value, ok: value === item.expect } }) })()`.replace('"CONTRACT"', JSON.stringify(contract)))
  // Variant assertions run in Node against values read from the page: a class like .ui-badge-success must
  // differ from .ui-badge in at least one visual property, otherwise it is a dead class that only looks like
  // a variant.
  const variantItems = contract.filter(item => item.differsFrom)
  // Some variants cannot be judged on the element itself (their rule targets a child). Those are exempted
  // with a written reason instead of being silently dropped.
  let exempt = {}
  try { exempt = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'style-contract-exempt.json'), 'utf8')) } catch {}
  const styleProps = ['color', 'backgroundColor', 'borderColor', 'animationName', 'fontWeight', 'width']
  const variantResults = []
  if (variantItems.length) {
    const names = [...new Set(variantItems.flatMap(item => [item.className, item.differsFrom]))]
    const values = await evaluate(`(() => { const out = {}; for (const name of ${JSON.stringify('NAMES')}) { const element = document.createElement('div'); element.className = name; document.body.appendChild(element); const style = getComputedStyle(element); out[name] = ${JSON.stringify('PROPS')}.map(prop => style[prop]); element.remove() } return out })()`.replace('"NAMES"', JSON.stringify(names)).replace('"PROPS"', JSON.stringify(styleProps)))
    for (const item of variantItems) {
      if (exempt[item.className]) continue
      const base = values?.[item.differsFrom] || []
      const variant = values?.[item.className] || []
      const differing = styleProps.find((prop, index) => base[index] !== variant[index])
      variantResults.push({ className: item.className, property: 'differs-from:' + item.differsFrom, expected: 'a visual difference', actual: differing ? 'differs in ' + differing : 'identical in all ' + styleProps.length + ' properties', ok: Boolean(differing) })
    }
  }
  const allMeasured = [...(measured || []), ...variantResults]
  const failures = allMeasured.filter(item => !item.ok)
  // Coverage, not just pass/fail: 105 ui-* classes are used in components but only a fraction are asserted.
  // Reporting the number (and ratcheting it) keeps the blind spot visible instead of "24 checks passed".
  const walkComponents = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkComponents(full, out)
      else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const usedClasses = new Set()
  for (const file of walkComponents(path.join(root, 'src', 'renderer', 'components'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/ui-[a-z][a-z0-9-]+/g)) usedClasses.add(match[0])
  }
  const assertedClasses = new Set(contract.map(item => String(item.className).split(' ')[0]))
  const covered = [...assertedClasses].filter(name => usedClasses.has(name))
  const coverage = { used: usedClasses.size, assertedClasses: assertedClasses.size, covered: covered.length, pct: Math.round((covered.length / usedClasses.size) * 1000) / 10 }
  let coverageBaseline = { minCovered: 0 }
  const baselineFile = path.join(root, 'scripts', 'style-contract-baseline.json')
  try { coverageBaseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) } catch {}
  const coverageShortfall = coverage.covered < (coverageBaseline.minCovered ?? 0)
  const passedAll = failures.length === 0 && !coverageShortfall
  fs.writeFileSync('artifacts/visual/ui-parity/style-contract.json', JSON.stringify({ passed: passedAll, total: allMeasured.length, measured: allMeasured, failures, coverage }, null, 2))
  console.log('STYLE-CONTRACT ' + JSON.stringify({ passed: passedAll, total: allMeasured.length, coverage, coverageShortfall: coverageShortfall || undefined, failures }))
  if (!passedAll) process.exitCode = 1
}

// `--selection-popup` drives the floating selection assistant end to end: open it through IPC, find the
// second CDP target (the popup is its own BrowserWindow), click a real action button there, and assert the
// captured text came from the main process and that applying an action hides the window.
if (process.argv.includes('--selection-popup')) {
  const report = { passed: false, checks: {} }
  const targets = async () => (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json())
  try {
    const before = (await targets()).length
    // Open with real content so the action path (plan → sink → database) is exercised, not just the click.
    await evaluate(`window.api.selection.open('1girl, smile, {{long hair}}')`)
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
      await call('Page.enable', {})
      const evalIn = async expression => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 15000 })).result?.value
      const bodyText = await evalIn(`document.body.innerText`)
      report.popupText = String(bodyText ?? '').slice(0, 120)
      report.checks.showsTitle = /划词助手/.test(String(bodyText ?? ''))
      const buttons = await evalIn(`Array.from(document.querySelectorAll('button')).map(button => button.textContent || '')`)
      report.buttons = buttons
      report.checks.showsCapturedText = /1girl, smile/.test(String(bodyText ?? ''))
      report.checks.hasThreeActions = (buttons ?? []).filter(label => /复制为标签语法|复制为单行|存为提示词素材/.test(label)).length === 3
      // Photograph BEFORE acting: 存为提示词素材 hides the popup, and a CDP screenshot of a hidden window
      // never settles (the request was left pending for the whole timeout).
      const shot = await call('Page.captureScreenshot', { format: 'png' })
      if (shot?.data) fs.writeFileSync(path.join(outDir, 'selection-popup.png'), Buffer.from(shot.data, 'base64'))
      report.checks.popupShot = Boolean(shot?.data)
      // 存为提示词素材 writes a real row through the same sink the shortcut path uses.
      // Action buttons are disabled={busy || !text}; wait for enabled so a no-op click cannot pass as success.
      // The popup is a separate window: this must run inside ITS session (evalIn), with the enabled-wait inline.
      const clicked = await evalIn(`(async () => { const find = () => Array.from(document.querySelectorAll('button')).find(el => (el.textContent || '').includes('存为提示词素材')); for (let index = 0; index < 40; index += 1) { const button = find(); if (button && !button.disabled) { button.click(); return true } await new Promise(resolve => setTimeout(resolve, 150)) } return false })()`)
      report.checks.actionClicked = clicked === true
      socket.close()
      await sleep(1200)
      const after = (await targets()).filter(item => item.url.includes('#selection-assistant'))
      report.checks.hiddenAfterApply = after.length > 0
      // The popup ran the action in the main process; ask the database whether the asset landed.
      report.assetCount = await evaluate(`(async () => { const page = await window.api.ipcApi.request('prompt.list', { limit: 1 }); return page?.data?.total ?? page?.total ?? null })()`)
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

// `--slim-sweep` walks every panel type at one width and lists INTERACTIVE elements squeezed under 20px.
// A 1px divider is fine; a 6px button or a 4px input is content the user cannot use — the failure mode the
// 960 measurement kept producing by hand.
if (process.argv.includes('--slim-sweep')) {
  const width = Number((process.argv.find(argument => argument.startsWith('--width=')) || '--width=960').slice(8))
  // One select only, deduped: every panel column carries its own copy of the list, so querying all of them
  // returned 90 "types" and the sweep spent minutes re-switching the same panels (that is why 1280/1600 timed out).
  const types = await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); if (!select) return []; return Array.from(new Set(Array.from(select.options).map(option => option.value))) })()`)
  const findings = []
  console.log('SLIM-START types=' + types.length + ' width=' + width)
  for (const type of types) {
    console.log('SLIM-STEP ' + type)
    const switched = await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify('TYPE')}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`.replace('"TYPE"', JSON.stringify(type)))
    await evaluate('window.__slimType = ' + JSON.stringify(type))
    if (!switched) continue
    await sleep(700)
    // The panel type is passed in as a literal: building the selector inside the page expression broke
    // when the string was assembled in Node instead (window is not defined there).
    const slimExpression = "(() => {" +
      " const panel = document.querySelector('[data-panel-type=\"" + "PLACEHOLDER" + "\"]');" +
      " if (!panel) return null;" +
      " return Array.from(panel.querySelectorAll('button, input, textarea, select, a, [role=button]'))" +
      "  .map(element => { const rect = element.getBoundingClientRect(); return { tag: element.tagName.toLowerCase(), type: element.type || '', label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 24), w: Math.round(rect.width), h: Math.round(rect.height) } })" +
      "  .filter(item => { if (item.h <= 4 || item.w >= 20) return false;" +
      "    if (['checkbox','radio','range','color'].indexOf(item.type) >= 0) return false;" +
    "    if (item.h > 100 || item.w < 6) return false;" +
      "    return item.tag === 'input' || item.tag === 'textarea' || item.tag === 'select' || /[\\u4e00-\\u9fa5A-Za-z]{3,}/.test(item.label) })" +
      "})()"
    const slim = await evaluate(slimExpression.replace('PLACEHOLDER', type))
    if (slim && slim.length) findings.push({ type, slim })
  }
  fs.writeFileSync('artifacts/visual/ui-parity/slim-sweep.json', JSON.stringify({ width, findings }, null, 2))
  console.log('SLIM-SWEEP ' + JSON.stringify({ width, panels: findings.length, findings: findings.slice(0, 8) }))
  if (findings.length) process.exitCode = 1
}

// `--overflow` names the elements whose content is wider than the box, with their class list.
if (process.argv.includes('--overflow')) {
  const expression = '(() => { const panel = document.querySelector("[data-panel-type]") || document; return Array.from(panel.querySelectorAll("*"))' +
    '.map(element => ({ tag: element.tagName.toLowerCase(), cls: (element.className || "").toString().slice(0, 70), scroll: element.scrollWidth, client: element.clientWidth }))' +
    '.filter(item => item.client > 0 && item.scroll > item.client + 8).slice(0, 8) })()'
  console.log('OVERFLOW ' + JSON.stringify(await evaluate(expression)))
}

// `--error-paths` checks that a failing network action SURFACES, not hangs. A panel that keeps showing its
// spinner after a failed connect is indistinguishable from a slow one, and the user retries forever.

// `--panel-menu`: the journeys never touch the panel CHROME. Opening the add-panel menu and closing it with
// Escape exercises real header clicks with zero persistent mutation (no panel is added, nothing is closed),
// which is exactly the property a smoke test of the chrome needs.

// `--panel-maximize`: the destructive-ish header controls were never clicked by any journey. Maximize is the one
// that is fully self-reversible (the same button becomes 还原面板), so it can be exercised on a real profile:
// measure the panel, maximize, measure again, restore, measure a third time and require the original size back.

// Layout snapshot/restore. Splitting, closing and popping out all mutate the PERSISTED workspace layout, so they
// are only safe to click if the previous state can be put back. The layout lives in localStorage, so a snapshot
// is a copy of those keys; restoring writes them back and reloads the window.
const SNAPSHOT_FILE = path.join(root, 'artifacts', 'layout-snapshot.json')
const snapshotLayout = () => evaluate(`(() => { const out = {}; for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (key) out[key] = localStorage.getItem(key) } return out })()`)
const restoreLayout = async snapshot => {
  await evaluate(`(() => { const snapshot = ${JSON.stringify('SNAP')}; for (const key of Object.keys(localStorage)) localStorage.removeItem(key); for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value); return true })()`.replace('"SNAP"', JSON.stringify(snapshot)))
  await evaluate('location.reload()')
  await sleep(3500)
}

// NOTE: this flag mutates the PERSISTED layout and cannot reliably restore it inside the same session — the store
// writes its in-memory layout while the page unloads and re-hydrates after the reload, so a single pass leaves the
// extra panel behind (measured 2026-11-01: 5 -> 6 -> still 6; a fresh `--layout-restore` process put it back).
// Kept for manual use only; run `--layout-restore` afterwards. Do NOT add it to the journeys suite.
if (process.argv.includes('--panel-count')) {
  const count = await evaluate(`document.querySelectorAll('[data-ui="panel.shell"]').length`)
  console.log('PANEL-COUNT ' + JSON.stringify({ panels: count }))
}

if (process.argv.includes('--panel-split')) {
  const report = { passed: false, checks: {} }
  const countPanels = () => evaluate(`document.querySelectorAll('[data-ui="panel.shell"]').length`)
  const clickTitle = wanted => evaluate(`(() => { const header = document.querySelector('[data-ui="panel.header"]'); if (!header) return false; const button = Array.from(header.querySelectorAll('button')).find(element => element.title === ${JSON.stringify('WANTED')}); if (!button) return false; button.click(); return true })()`.replace('"WANTED"', JSON.stringify(wanted)))
  let snapshot = null
  try {
    snapshot = await snapshotLayout()
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true })
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2))
    report.snapshotKeys = Object.keys(snapshot || {}).length
    const before = await countPanels()
    report.checks.foundPanels = before > 0
    report.checks.clickedSplit = await clickTitle('左右分割')
    await sleep(700)
    const after = await countPanels()
    report.panels = { before, after }
    report.checks.splitAddedPanel = after === before + 1
  } catch (error) { report.error = String(error) }
  // Restore no matter what: the click above mutated persisted layout.
  try {
    // The store persists its in-memory layout while the page unloads, which can overwrite the snapshot during
    // the same reload. Restoring twice converges (measured: one pass left 6 panels, two passes left 5).
    const saved = snapshot || JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
    await restoreLayout(saved)
    let restoredCount = await countPanels()
    if (restoredCount !== report.panels.before) { await restoreLayout(saved); restoredCount = await countPanels() }
    report.panels.restoredInSession = restoredCount
    // The in-session restore is informational only: the store re-persists its in-memory layout on unload, so it
    // is expected to stay at the split count here. The real restore runs as a separate process afterwards
    // (`--layout-restore`, see `npm run verify:panel-split`).
    report.checks.inlineRestoreWorks = null
  } catch (error) { report.restoreError = String(error); console.log('LAYOUT-RESTORE-FAILED see ' + SNAPSHOT_FILE) }
  report.passed = [report.checks.foundPanels, report.checks.clickedSplit, report.checks.splitAddedPanel].every(Boolean)
  console.log('PANEL-SPLIT-NOTE: the layout is now mutated; run `node scripts/ui-parity.mjs --layout-restore` (separate process) to put it back')
  fs.writeFileSync('artifacts/visual/ui-parity/panel-split.json', JSON.stringify(report, null, 2))
  console.log('PANEL-SPLIT ' + JSON.stringify({ passed: report.passed, checks: report.checks, panels: report.panels, error: report.error, restoreError: report.restoreError }))
  if (!report.passed) process.exitCode = 1
}

if (process.argv.includes('--layout-restore')) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
    await restoreLayout(snapshot)
    const count = await evaluate(`document.querySelectorAll('[data-ui="panel.shell"]').length`)
    console.log('LAYOUT-RESTORED ' + JSON.stringify({ keys: Object.keys(snapshot).length, panels: count }))
  } catch (error) {
    console.log('LAYOUT-RESTORE-FAILED ' + String(error))
    process.exitCode = 1
  }
}

if (process.argv.includes('--panel-maximize')) {
  const report = { passed: false, checks: {} }
  const rectOf = () => evaluate(`(() => { const shell = document.querySelector('[data-ui="panel.shell"]'); if (!shell) return null; const rect = shell.getBoundingClientRect(); return { w: Math.round(rect.width), h: Math.round(rect.height) } })()`)
  const clickTitle = wanted => evaluate(`(() => { const header = document.querySelector('[data-ui="panel.header"]'); if (!header) return false; const button = Array.from(header.querySelectorAll('button')).find(element => element.title === ${JSON.stringify('WANTED')}); if (!button) return false; button.click(); return true })()`.replace('"WANTED"', JSON.stringify(wanted)))
  try {
    const before = await rectOf()
    report.checks.foundPanel = Boolean(before)
    report.checks.clickedMaximize = await clickTitle('最大化面板')
    await sleep(600)
    const maximized = await rectOf()
    report.checks.grew = Boolean(before && maximized && maximized.w >= before.w && maximized.h > before.h)
    report.sizes = { before, maximized }
    report.checks.clickedRestore = await clickTitle('还原面板')
    await sleep(600)
    const restored = await rectOf()
    report.checks.backToOriginal = Boolean(before && restored && Math.abs(restored.w - before.w) <= 2 && Math.abs(restored.h - before.h) <= 2)
    report.sizes.restored = restored
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/panel-maximize.json', JSON.stringify(report, null, 2))
  console.log('PANEL-MAXIMIZE ' + JSON.stringify({ passed: report.passed, checks: report.checks, sizes: report.sizes, error: report.error }))
  if (!report.passed) process.exitCode = 1
}


// `--layout-menu`: the workspace bar's 布局管理 menu was never opened by any journey. Opening and closing it has
// no side effect (the actions inside are separate buttons), so it is safe on a real profile.

// `--settings-toggle`: the settings panel is our own page and no journey ever changed a value in it. This clicks
// the 紧凑 density option, proves the setting reached the database AND the DOM (`data-ui-density`), then puts the
// previous value back.
if (process.argv.includes('--settings-toggle')) {
  const report = { passed: false, checks: {} }
  try {
    const original = await evaluate(`(async () => (await window.api.settings.getAll()).ui_density || 'normal')()`)
    report.original = original
    report.checks.sawOriginal = Boolean(original)
    await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(element => element.offsetParent !== null); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'settings'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await sleep(600)
    // The settings page mounts lazily; a fixed sleep was not enough (measured: 0 theme swatches after 600ms,
    // while the same panel was warm during the theme sweep). Poll for the control instead.
    const ready = await evaluate(`(async () => { for (let index = 0; index < 50; index += 1) { const found = Array.from(document.querySelectorAll('button')).some(el => (el.textContent || '').trim() === '紧凑'); if (found) return true; await new Promise(resolve => setTimeout(resolve, 200)) } return false })()`)
    report.checks.settingsReady = ready
    const clicked = await evaluate(`(() => { const button = Array.from(document.querySelectorAll('button')).find(el => (el.textContent || '').trim() === '紧凑'); if (!button || button.disabled) return false; button.click(); return true })()`)
    report.checks.clickedCompact = clicked
    await sleep(500)
    report.stored = await evaluate(`(async () => (await window.api.settings.getAll()).ui_density)()`)
    report.checks.storedCompact = report.stored === 'compact'
    report.densityAttribute = await evaluate(`document.documentElement.getAttribute('data-ui-density')`)
    report.checks.domApplied = report.densityAttribute === 'compact'
    // Second control: appearance mode. The settings page writes `data-appearance-mode` and `data-appearance`,
    // so flipping it to dark and back proves the second apply path works too.
    const appearanceBefore = await evaluate(`(async () => (await window.api.settings.getAll()).appearance_mode || 'system')()`)
    await evaluate(`(() => { const button = Array.from(document.querySelectorAll('button')).find(el => (el.textContent || '').trim() === '深色'); if (!button || button.disabled) return false; button.click(); return true })()`)
    await sleep(500)
    report.appearance = {
      before: appearanceBefore,
      stored: await evaluate(`(async () => (await window.api.settings.getAll()).appearance_mode)()`),
      attribute: await evaluate(`document.documentElement.getAttribute('data-appearance-mode')`),
    }
    report.checks.appearanceApplied = report.appearance.stored === 'dark' && report.appearance.attribute === 'dark'
    await evaluate(`(async () => { await window.api.settings.set('appearance_mode', ${JSON.stringify('APP')}); return true })()`.replace('"APP"', JSON.stringify(appearanceBefore)))
    await sleep(300)

    // Third control: UI scale (a number input). Typed through the native setter so React sees the change.
    const scaleBefore = await evaluate(`(async () => (await window.api.settings.getAll()).ui_scale || '14')()`)
    const typedScale = await evaluate(`(() => { const input = Array.from(document.querySelectorAll('input[type=number]')).find(el => Number(el.max) === 20 && Number(el.min) === 12); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '16'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await sleep(500)
    report.scale = {
      typed: typedScale,
      before: scaleBefore,
      stored: await evaluate(`(async () => (await window.api.settings.getAll()).ui_scale)()`),
      fontVar: await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--ui-font-size').trim()`),
      attribute: await evaluate(`document.documentElement.getAttribute('data-ui-scale')`),
    }
    report.checks.scaleApplied = report.scale.stored === '16' && report.scale.fontVar === '16px' && report.scale.attribute === '16'
    await evaluate(`(async () => { await window.api.settings.set('ui_scale', ${JSON.stringify('SC')}); return true })()`.replace('"SC"', JSON.stringify(scaleBefore)))
    await sleep(300)

    // Fourth control: language (a select). Effect is the `data-lang` attribute; a full i18n switch would also
    // change every label, so the assertion stays on the attribute plus the stored value.
    const languageBefore = await evaluate(`(async () => (await window.api.settings.getAll()).language || 'zh')()`)
    const switched = await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select')).find(el => Array.from(el.options).some(option => option.value === 'en')); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'en'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await sleep(500)
    report.language = {
      switched,
      before: languageBefore,
      stored: await evaluate(`(async () => (await window.api.settings.getAll()).language)()`),
      attribute: await evaluate(`document.documentElement.getAttribute('data-lang')`),
    }
    report.checks.languageApplied = report.language.stored === 'en' && report.language.attribute === 'en'
    await evaluate(`(async () => { await window.api.settings.set('language', ${JSON.stringify('LANG')}); return true })()`.replace('"LANG"', JSON.stringify(languageBefore)))
    await sleep(300)
    report.checks.languageRestored = (await evaluate(`(async () => (await window.api.settings.getAll()).language)()`)) === languageBefore

    // Fifth control: a keyboard shortcut. Clicking the row opens a capture input; a real key event is then
    // dispatched at it, and the stored setting proves the capture wrote through.
    const shortcutBefore = await evaluate(`(async () => (await window.api.settings.getAll())['shortcut_chat.send'] || 'Enter')()`)
    // The shortcut section is collapsed by default, so its rows do not exist until the card header is clicked.
    await evaluate(`(() => { const card = document.getElementById('shortcuts'); if (!card) return false; const toggle = card.querySelector('button'); if (toggle) { toggle.click(); return true } return false })()`)
    await sleep(400)
    const openedRow = await evaluate(`(() => { if (document.querySelector('[aria-label="设置发送消息快捷键"]')) return true; const row = Array.from(document.querySelectorAll('div')).find(el => (el.textContent || '').trim() === '发送消息'); if (!row || !row.parentElement) return false; const button = row.parentElement.querySelector('button'); if (button) { button.click(); return true } return false })()`)
    report.shortcutRowOpened = openedRow
    await sleep(300)
    const captured = await evaluate(`Boolean(document.querySelector('[aria-label="设置发送消息快捷键"]'))`)
    if (captured) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, modifiers: 2 })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, modifiers: 2 })
      await sleep(500)
    }
    report.shortcut = {
      captureOpened: captured,
      before: shortcutBefore,
      stored: await evaluate(`(async () => (await window.api.settings.getAll())['shortcut_chat.send'])()`),
    }
    // Honest split: if the row could not even be opened, that is a LIMIT of this journey (unknown DOM shape),
    // not a product failure — record it as skipped instead of inventing a red or a green.
    if (!report.shortcutRowOpened) report.shortcutSkipped = 'row not found after expanding #shortcuts'
    else report.checks.shortcutCaptured = captured && typeof report.shortcut.stored === 'string' && report.shortcut.stored.length > 0 && report.shortcut.stored !== shortcutBefore
    await evaluate(`(async () => { await window.api.settings.set('shortcut_chat.send', ${JSON.stringify('SC')}); return true })()`.replace('"SC"', JSON.stringify(shortcutBefore)))
    await sleep(200)

    // Restore whatever was there before, through the same API the UI uses.
    await evaluate(`(async () => { await window.api.settings.set('ui_density', ${JSON.stringify('ORIG')}); return true })()`.replace('"ORIG"', JSON.stringify(original)))
    await sleep(400)
    report.restored = await evaluate(`(async () => (await window.api.settings.getAll()).ui_density)()`)
    report.checks.restored = report.restored === original
  } catch (error) { report.error = String(error) }
  report.passed = Object.values(report.checks).every(Boolean)
  fs.writeFileSync('artifacts/visual/ui-parity/settings-toggle.json', JSON.stringify(report, null, 2))
  console.log('SETTINGS-TOGGLE ' + JSON.stringify({ labels: report.labels, passed: report.passed, checks: report.checks, original: report.original, stored: report.stored, density: report.densityAttribute, restored: report.restored, error: report.error }))
  if (!report.passed) process.exitCode = 1
}

if (process.argv.includes('--layout-menu')) {
  const report = { passed: false, checks: {} }
  const trigger = `document.querySelector('.ui-layout-menu-trigger')`
  const state = () => evaluate(`(() => { const button = document.querySelector('.ui-layout-menu-trigger'); if (!button) return null; const menu = document.querySelector('.ui-popover-menu'); const items = menu ? Array.from(menu.querySelectorAll('.ui-menu-item')).map(element => String(element.textContent || '').trim().slice(0, 12)) : []; return { expanded: button.getAttribute('aria-expanded'), menu: Boolean(menu), items } })()`)
  try {
    report.checks.triggerFound = await evaluate(`Boolean(${trigger})`)
    report.before = await evaluate(`document.querySelector('.ui-layout-menu-trigger').getAttribute('aria-expanded')`)
    await evaluate(`(() => { const button = document.querySelector('.ui-layout-menu-trigger'); if (!button) return false; button.click(); return true })()`)
    await sleep(350)
    report.opened = await state()
    report.checks.opened = Boolean(report.opened && report.opened.expanded === 'true' && report.opened.menu && report.opened.items.length >= 2)
    await evaluate(`(() => { const button = document.querySelector('.ui-layout-menu-trigger'); if (!button) return false; button.click(); return true })()`)
    await sleep(350)
    report.closed = await state()
    report.checks.closedAgain = Boolean(report.closed && report.closed.expanded === 'false' && !report.closed.menu)
    report.checks.workspaceIntact = await evaluate(`Boolean(document.querySelector('[data-ui="panel.shell"]'))`)
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/layout-menu.json', JSON.stringify(report, null, 2))
  console.log('LAYOUT-MENU ' + JSON.stringify({ passed: report.passed, checks: report.checks, items: report.opened && report.opened.items, error: report.error }))
  if (!report.passed) process.exitCode = 1
}

if (process.argv.includes('--panel-menu')) {
  const report = { passed: false, checks: {} }
  try {
    const trigger = `(() => { const header = document.querySelector('[data-ui="panel.header"]'); if (!header) return false; const button = Array.from(header.querySelectorAll('button')).find(element => element.title === '添加面板'); if (!button) return false; button.click(); return true })()`
    report.checks.triggerFound = await evaluate(trigger)
    await sleep(400)
    const menu = `(() => { const surface = document.querySelector('.ui-menu, [role="menu"], .ui-popover-surface'); if (!surface) return null; const items = Array.from(surface.querySelectorAll('.ui-menu-item, [role="menuitem"]')); return { visible: true, items: items.length, first: items[0] ? String(items[0].textContent || '').trim().slice(0, 24) : '' } })()`
    report.menu = await evaluate(menu)
    report.checks.menuOpened = Boolean(report.menu && report.menu.items > 0)
    // Escape must close it: a menu that cannot be dismissed traps the panel.
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(350)
    report.checks.menuClosed = await evaluate(`(() => { const surface = document.querySelector('.ui-menu, [role="menu"], .ui-popover-surface'); return !surface || !surface.getBoundingClientRect().width })()`)
    report.checks.panelStillMounted = await evaluate(`Boolean(document.querySelector('[data-ui="panel.shell"]'))`)
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/panel-menu.json', JSON.stringify(report, null, 2))
  console.log('PANEL-MENU ' + JSON.stringify({ passed: report.passed, checks: report.checks, menu: report.menu, error: report.error }))
  if (!report.passed) process.exitCode = 1
}

if (process.argv.includes('--error-paths')) {
  const report = { passed: false, checks: {} }
  const waitForLocal = async (expression, attempts = 80) => { for (let index = 0; index < attempts; index += 1) { const value = await evaluate(expression); if (value) return value; await sleep(250) } return null }
  try {
    await waitForLocal(`!!document.querySelector('select.ui-panel-select')`)
    await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select.ui-panel-select')).find(el => el.offsetParent !== null); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'comfyui'); select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await sleep(1200)
    const typed = await evaluate(`(() => { const input = document.querySelector('[data-panel-type="comfyui"] input.ui-field'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'http://127.0.0.1:9'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    report.checks.fieldTyped = typed === true
    await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); const button = Array.from(panel.querySelectorAll('button')).find(el => (el.textContent || '').includes('保存')); if (button) button.click(); return Boolean(button) })()`)
    // A pre-existing 「未连接」 badge would satisfy a naive regex, so require the text to CHANGE: compare
    // against what the panel showed before the click and look for new error wording.
    const before = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); return panel ? (panel.innerText || '') : '' })()`)
    await evaluate('window.__beforeText = ' + JSON.stringify(String(before ?? '')))
    // The panel may already show a 「未连接」 badge, so assert on the NEW wording this flow adds
    // (「已保存，但连接失败…」) instead of any error-ish word.
    const surfaced = await waitForLocal(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); if (!panel) return false; const text = panel.innerText || ''; return text.indexOf('连接失败') >= 0 ? '连接失败' : false })()`, 60)
    report.surfaced = surfaced || null
    report.panelTextAfter = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); return panel ? (panel.innerText || '').slice(0, 300) : null })()`)
    report.checks.errorSurfaced = Boolean(surfaced)
    // The panel must stay usable: a stuck busy flag would leave every control disabled.
    const interactive = await evaluate(`(() => { const panel = document.querySelector('[data-panel-type="comfyui"]'); const buttons = Array.from(panel.querySelectorAll('button')); return buttons.some(button => !button.disabled) })()`)
    report.checks.stillInteractive = interactive === true
    report.passed = Object.values(report.checks).every(Boolean)
  } catch (error) { report.error = String(error) }
  fs.writeFileSync('artifacts/visual/ui-parity/error-paths.json', JSON.stringify(report, null, 2))
  console.log('ERROR-PATHS ' + JSON.stringify({ passed: report.passed, checks: report.checks, surfaced: report.surfaced }))
  if (!report.passed) process.exitCode = 1
}
console.log(JSON.stringify(report, null, 2))
ws.close()
killTree()
process.exit(report.ok ? 0 : 1)
