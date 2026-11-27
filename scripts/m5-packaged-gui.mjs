#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pngHeader, fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { buildFingerprint } from './journey-evidence.mjs'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')
const root = process.cwd()
const executable = path.join(root, 'release/win-unpacked/Grimoire.exe')
const archive = path.join(root, 'release/win-unpacked/resources/app.asar')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const startedAt = Date.now()
const outDir = path.join(root, 'artifacts/m5')
const shotDir = path.join(outDir, 'packaged-gui', stamp)
fs.mkdirSync(shotDir, { recursive: true })
const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-packaged-gui-')))
const checks = []
const screenshots = []
const uncaught = []
const consoleErrors = []
const forcedNavigation = []
const check = (name, passed, details = {}) => checks.push({ name, passed: Boolean(passed), ...details })
const hash = file => fileSha256(file)
const walkFiles = dir => {
  const files = []
  const walk = current => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk(dir)
  return files.sort()
}
const currentBuild = () => {
  const distFiles = walkFiles(path.join(root, 'dist'))
  const shell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
  return buildFingerprint([...distFiles, ...(fs.existsSync(shell) ? [shell] : [])], { root })
}
const currentSourceShellSha = () => {
  const shell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
  return fs.existsSync(shell) ? hash(shell) : null
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(error => error ? reject(error) : resolve(value)) })
  })
}

function createClient(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const events = []
  let nextId = 1
  socket.on('message', data => {
    const message = JSON.parse(data.toString())
    if (message.id === undefined) { events.push(message); return }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }), error => { if (error) { pending.delete(id); reject(error) } })
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result?.result?.value
  }
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 15000)
    socket.once('open', () => { clearTimeout(timer); resolve() })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
  return { socket, ready, call, evaluate, events, close: () => { try { socket.close() } catch {} } }
}

async function waitUntil(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last } catch {}
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error(label + ' timeout')
}

async function listTargets(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list')
  return response.json()
}

function decodeUrl(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

async function tabRoute(client) {
  return client.evaluate('(() => { try { const cache = JSON.parse(localStorage.getItem("cs_cache_persist") || "{}"); const tabs = [...(cache["ui.tab.pinned_tabs"] || []), ...(cache["ui.tab.normal_tabs"] || [])]; return tabs.find(tab => tab.id === cache["ui.tab.active_tab_id"])?.url || "" } catch { return "" } })()')
}

async function snapshot(client, name) {
  const result = await client.call('Page.captureScreenshot', { format: 'png' })
  const file = path.join(shotDir, name + '.png')
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
  const header = pngHeader(file)
  const record = { name, file: path.relative(root, file).replaceAll(path.sep, '/'), sha256: hash(file), bytes: fs.statSync(file).size, png: header }
  screenshots.push(record)
  check('screenshot ' + name + ' valid PNG IHDR', Boolean(header && header.width > 0 && header.height > 0), record)
  return record
}

let child
let mainClient
let compatClient
let report
try {
  check('packaged executable exists', fs.existsSync(executable), { path: path.relative(root, executable).replaceAll(path.sep, '/'), sha256: fs.existsSync(executable) ? hash(executable) : null })
  check('packaged app.asar exists', fs.existsSync(archive), { path: path.relative(root, archive).replaceAll(path.sep, '/'), sha256: fs.existsSync(archive) ? hash(archive) : null })
  if (!fs.existsSync(executable) || !fs.existsSync(archive)) throw new Error('release/win-unpacked is missing; run npm run pack first')
  const port = await freePort()
  child = spawn(executable, ['--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], {
    cwd: root,
    env: (() => { const env = { ...process.env, GRIMOIRE_OPEN_CHERRY: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.GRIMOIRE_CHERRY_ENTRY; delete env.GRIMOIRE_VISUAL_CAPTURE; delete env.GRIMOIRE_UI_CATALOG_CAPTURE; return env })(),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-20000) })
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-20000) })
  const targets = await waitUntil(async () => {
    const list = await listTargets(port)
    const pages = list.filter(entry => entry.type === 'page')
    const main = pages.find(entry => decodeUrl(entry.url).includes('/dist/renderer/index.html'))
    const compat = pages.find(entry => decodeUrl(entry.url).includes('/dist/cherry-compat/index.html'))
    return main && compat ? { main, compat, all: pages.map(entry => decodeUrl(entry.url)) } : null
  }, 'packaged main/compat targets', 75000)
  check('main window target', Boolean(targets.main), { url: decodeUrl(targets.main.url) })
  check('compat window target', Boolean(targets.compat), { url: decodeUrl(targets.compat.url) })
  mainClient = createClient(targets.main)
  compatClient = createClient(targets.compat)
  await Promise.all([mainClient.ready, compatClient.ready])
  await Promise.all([mainClient.call('Runtime.enable'), mainClient.call('Page.enable'), mainClient.call('Log.enable'), compatClient.call('Runtime.enable'), compatClient.call('Page.enable'), compatClient.call('Log.enable')])
  // The packaged main window can remain on about:blank in this environment even
  // though its target URL is the correct file. Record the state, then navigate
  // the same webContents to the same packaged URL so preload/UI can be verified.
  const ensureLoaded = async (client, target, label) => {
    const before = await client.evaluate('({ href: location.href, ready: document.readyState, api: typeof window.api, text: (document.body?.innerText || "").length })')
    if (before.href === 'about:blank' || before.api !== 'object') {
      const navigation = await client.call('Page.navigate', { url: target.url })
      forcedNavigation.push({ window: label, targetUrl: decodeUrl(target.url), before, navigation })
      await waitUntil(() => client.evaluate('document.readyState === "complete"'), label + ' forced reload', 30000)
    }
  }
  await ensureLoaded(mainClient, targets.main, 'main')
  await ensureLoaded(compatClient, targets.compat, 'compat')
  await Promise.all([
    waitUntil(() => mainClient.evaluate('document.readyState === "complete" && (document.body?.innerText || "").trim().length > 20'), 'main DOM', 30000),
    waitUntil(() => compatClient.evaluate('document.readyState === "complete" && (document.body?.innerText || "").trim().length > 20'), 'compat DOM', 30000)
  ])
  const mainApi = await mainClient.evaluate('({ api: typeof window.api, request: typeof window.api?.ipcApi?.request, settings: typeof window.api?.settings?.getAll, settingsSet: typeof window.api?.settings?.set })')
  const compatApi = await compatClient.evaluate('({ api: typeof window.api, request: typeof window.api?.ipcApi?.request, settings: typeof window.api?.settings?.getAll, settingsSet: typeof window.api?.settings?.set })')
  check('main preload bridge present', mainApi.api === 'object' && mainApi.request === 'function', mainApi)
  check('compat preload bridge present', compatApi.api === 'object' && compatApi.request === 'function', compatApi)
  const mainInfo = await mainClient.evaluate('window.api.ipcApi.request("app.get_info")')
  const compatInfo = await compatClient.evaluate('window.api.ipcApi.request("app.get_info")')
  const profileMatches = info => info?.ok === true && path.resolve(info.data.appDataPath).toLowerCase() === path.resolve(profile).toLowerCase()
  check('main app.get_info ok', mainInfo?.ok === true, { ok: mainInfo?.ok, version: mainInfo?.data?.version, isPackaged: mainInfo?.data?.isPackaged })
  check('compat app.get_info ok', compatInfo?.ok === true, { ok: compatInfo?.ok, version: compatInfo?.data?.version, isPackaged: compatInfo?.data?.isPackaged })
  check('main isolated profile', profileMatches(mainInfo), { expected: profile, actual: mainInfo?.data?.appDataPath })
  check('compat isolated profile', profileMatches(compatInfo), { expected: profile, actual: compatInfo?.data?.appDataPath })
  check('packaged build reports isPackaged', mainInfo?.data?.isPackaged === true && compatInfo?.data?.isPackaged === true, { main: mainInfo?.data?.isPackaged, compat: compatInfo?.data?.isPackaged })
  const compatState = await compatClient.evaluate('({ href: location.href, hash: location.hash, text: (document.body?.innerText || "") })')
  const hashRoute = compatState.hash && compatState.hash.startsWith("#/") ? compatState.hash.slice(1) : ""
  const routeTokens = compatState.text.split(new RegExp("[^A-Za-z0-9/_-]+"))
  const domRoute = routeTokens.find(token => token.startsWith("/app/") || token.startsWith("/settings/")) || ""
  const defaultRoute = hashRoute || domRoute
  const defaultState = { href: compatState.href, hash: compatState.hash, route: defaultRoute, routeSource: hashRoute ? "hash" : domRoute ? "dom" : null }
  check('default compat entry route exists', typeof defaultRoute === 'string' && defaultRoute.startsWith('/'), { defaultRoute, defaultState })
  await snapshot(mainClient, 'main-window')
  await snapshot(compatClient, 'compat-default-entry')
  const sourceConstants = fs.readFileSync(path.join(root, 'src/vendor/cherry/source/src/shared/utils/constants.ts'), 'utf8')
  const privacyVersion = sourceConstants.match(/LATEST_PRIVACY_POLICY_VERSION[^']*'([^']+)'/)?.[1]
  if (!privacyVersion) throw new Error('privacy version missing')
  await compatClient.evaluate('(async () => { const entries = ' + JSON.stringify({
    'cherry_pref.app.onboarding.provider_setup.status': 'skipped',
    'cherry_pref.app.privacy.policy_version': privacyVersion,
    'cherry_pref.app.privacy.data_collection.enabled': false
  }) + '; for (const [key, value] of Object.entries(entries)) await window.api.settings.set(key, JSON.stringify(value)); return true })()')
  await compatClient.evaluate('window.api.settings.set("m5.packaged.probe", "packaged-gui-ok")')
  const settingsReadback = await compatClient.evaluate('window.api.settings.getAll()')
  const onboardingKey = settingsReadback?.['cherry_pref.app.onboarding.provider_setup.status']
  const probeValue = settingsReadback?.['m5.packaged.probe']
  check('settings IPC readback', settingsReadback !== undefined && probeValue === 'packaged-gui-ok', { probeValue, onboardingKey, keys: Object.keys(settingsReadback || {}).slice(0, 12) })
  const navigationProbe = await compatClient.evaluate('window.api.ipcApi.request("navigation.open_route_in_main", { path: "/app/launchpad" })')
  const collect = client => client.events.filter(event => event.method === 'Runtime.exceptionThrown').map(event => event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text)
  const collectConsole = client => client.events.filter(event => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error').map(event => event.params.entry.text)
  uncaught.push(...collect(mainClient).map(text => ({ window: 'main', text })), ...collect(compatClient).map(text => ({ window: 'compat', text })))
  consoleErrors.push(...collectConsole(mainClient).map(text => ({ window: 'main', text })), ...collectConsole(compatClient).map(text => ({ window: 'compat', text })))
  check('no uncaught renderer exceptions', uncaught.length === 0, { uncaught })
  report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    exitCode: 0,
    mode: 'packaged-gui-cdp',
    buildFingerprint: currentBuild(),
    sourceShellSha256: currentSourceShellSha(),
    executable: { path: path.relative(root, executable).replaceAll(path.sep, '/'), sha256: hash(executable), bytes: fs.statSync(executable).size },
    archive: { path: path.relative(root, archive).replaceAll(path.sep, '/'), sha256: hash(archive), bytes: fs.statSync(archive).size },
    profile: { path: profile, isolated: true, appDataPath: compatInfo?.data?.appDataPath },
    targets: { main: decodeUrl(targets.main.url), compat: decodeUrl(targets.compat.url), all: targets.all },
    routes: { defaultRoute, defaultState },
    api: { main: mainApi, compat: compatApi },
    readbacks: { mainAppInfo: mainInfo, compatAppInfo: compatInfo, settings: { probeValue, onboardingKey, keys: Object.keys(settingsReadback || {}).slice(0, 12) }, navigationProbe },
    forcedNavigation,
    screenshots,
    errors: { uncaught, consoleErrors },
    checks,
    stdout,
    stderr
  }
} catch (error) {
  check('execution', false, { error: error instanceof Error ? error.message : String(error) })
  report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    exitCode: 1,
    mode: 'packaged-gui-cdp',
    passed: false,
    buildFingerprint: currentBuild(),
    sourceShellSha256: currentSourceShellSha(),
    blockedReason: error instanceof Error ? error.message : String(error),
    executable: { path: path.relative(root, executable).replaceAll(path.sep, '/'), sha256: fs.existsSync(executable) ? hash(executable) : null },
    profile: { path: profile, isolated: true },
    forcedNavigation,
    checks,
    screenshots,
    errors: { uncaught, consoleErrors }
  }
} finally {
  try { mainClient?.close() } catch {}
  try { compatClient?.close() } catch {}
  const ownedPid = child?.pid || null
  let pidExited = false
  if (ownedPid) {
    spawnSync('taskkill.exe', ['/PID', String(ownedPid), '/T', '/F'], { stdio: 'ignore' })
    for (let attempt = 0; attempt < 20; attempt++) {
      const probe = spawnSync('tasklist.exe', ['/FI', 'PID eq ' + ownedPid, '/NH'], { encoding: 'utf8' })
      if (!String(probe.stdout || '').includes(String(ownedPid))) { pidExited = true; break }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  let profileRemoved = false
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
    profileRemoved = !fs.existsSync(profile)
    if (profileRemoved) break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  check('owned process exited', ownedPid ? pidExited : false, { ownedPid, pidExited })
  check('isolated profile removed', profileRemoved, { profile, profileRemoved })
  report.cleanup = { ownedPid, pidExited, profileRemoved, originalProfileTouched: false }
  report.passed = !report.blockedReason && checks.every(item => item.passed) && uncaught.length === 0
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'packaged-gui-' + stamp + '.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
  fs.writeFileSync(path.join(outDir, 'packaged-gui-latest.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
  console.log(JSON.stringify({ passed: report.passed, report: 'artifacts/m5/packaged-gui-' + stamp + '.json', checks: checks.map(item => ({ name: item.name, passed: item.passed })), routes: report.routes, cleanup: report.cleanup }))
  if (!report.passed) process.exitCode = 1
}
