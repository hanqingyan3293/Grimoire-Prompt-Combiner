// Real Electron/MainApp smoke. Requires the existing isolated source-shell build;
// does not build, replace preload, mock APIs, or alter the default compat entry.
// Full smoke: node scripts/audit-cherry-source-shell.mjs
// Independent bounded IPC acceptance: node scripts/audit-cherry-source-shell.mjs --file-tree-acceptance
// Both require coordinator confirmation that compiled dist is stable before launch.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildFingerprint } from './journey-evidence.mjs'
import { fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { manifestDigest } from './m5-evidence.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const artifact = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
// Never overwrite prior successful evidence (or a failed assertion's diagnostics).
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
const outDir = path.join(root, 'artifacts/source-shell', runId)
fs.mkdirSync(outDir, { recursive: true })
const sourcePhases = ['source-bootstrap', 'tab-interaction', 'navigation-producer', 'tab-close', 'distinct-routes', 'source-reload', 'reload-handshake', 'reload-route-switch', 'agent-page', 'agent-create', 'agent-select', 'agent-rename', 'agent-new-conversation']
const fileTreeOnly = process.argv.includes('--file-tree-acceptance')
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
const distFiles = walkFiles(path.join(root, 'dist'))
const sourceShellFiles = walkFiles(path.dirname(artifact))
const artifactSha256 = fs.existsSync(artifact) ? fileSha256(artifact) : null
const build = buildFingerprint([...distFiles, ...(artifactSha256 ? [artifact] : [])], { root })
const sourceShellDistDigest = manifestDigest(sourceShellFiles.map(file => ({ path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: fileSha256(file) })))
const report = { startedAt: new Date().toISOString(), runId, artifact, artifactSha256, sourceShellDistDigest, buildFingerprint: build, acceptance: fileTreeOnly ? 'bounded-file-tree-ipc' : 'full-source-shell', passed: false, observations: [], events: [], checks: {} }
if (fileTreeOnly) report.fullSmoke = { status: 'NOT_RUN', blockers: ['Genuine runtime prewarm unavailable', 'Source runtime stream acceptance not verified'], scope: 'Independent file-tree acceptance does not waive or pass the full smoke prewarm/stream gates.' }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, ws, profile, fixture, cleaning
let phase = 'preflight'
let nextId = 1
const pending = new Map()
const output = []
function writeReport() {
  report.capabilityBlockers = [...new Set(report.events.flatMap(event => {
    if (!sourcePhases.includes(event.phase)) return []
    const text = event.method === 'Runtime.exceptionThrown'
      ? event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text
      : (event.params.args || []).map(arg => arg.value || arg.description || '').join(' ')
    return [...String(text).matchAll(/(?:DataApi|ipcApi) 路由未桥接：[^\n]+/g)].map(match => match[0])
  }))]
  report.phase = phase
  fs.writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(outDir, 'electron.log'), output.join(''))
}
async function cleanup() {
  if (cleaning) return cleaning
  cleaning = (async () => {
    ws?.terminate()
    if (child?.pid) {
      // Direct Electron executable, not npx: this PID owns only our process tree.
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', timeout: 15000 })
        report.teardown = { pid: child.pid, status: killed.status, output: (killed.stdout || '') + (killed.stderr || '') }
        if (killed.status !== 0 && !report.electronExit) {
          report.passed = false
          report.cleanupError = `Owned Electron PID teardown failed: ${killed.error?.message || killed.status}`
          process.exitCode = 1
        }
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
        report.teardown = { pid: child.pid }
      }
    }
    if (profile) {
      try {
        await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        report.profileRemoved = true
      } catch (error) { report.passed = false; report.profileRemoved = false; report.cleanupError = error.message; process.exitCode = 1 }
    }
    // This fresh mkdtemp container has only files created by this harness. No
    // registered pre-existing workspace or source path is ever removed.
    if (fixture) {
      try {
        await fs.promises.rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
        report.fixtureRemoved = true
      } catch (error) { report.passed = false; report.fixtureRemoved = false; report.fixtureCleanupError = error.message; process.exitCode = 1 }
    }
    writeReport()
  })()
  return cleaning
}
function call(method, params = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeout)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }), error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error) }
    })
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
const stateExpression = `(() => {
  const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
  const content = document.querySelector('[data-ui="app.content"]');
  const tabbar = document.querySelector('[data-ui="app.tab-bar"]');
  const text = (document.body?.innerText || '').trim();
  // Read-only inspection of the genuine source CacheService localStorage contract.
  const cache = JSON.parse(localStorage.getItem('cs_cache_persist') || '{}');
  const session = { normalTabs: cache['ui.tab.normal_tabs'] || [], pinnedTabs: cache['ui.tab.pinned_tabs'] || [], activeTabId: cache['ui.tab.active_tab_id'] || '' };
  return { session, url: location.href, title: document.title, readyState: document.readyState,
    rootChildren: document.getElementById('root')?.childElementCount || 0,
    apiPresent: !!window.api, tabbar: visible(tabbar), content: visible(content),
    contentText: content?.innerText || '', sidebar: visible(document.getElementById('app-sidebar')),
    tabs: [...document.querySelectorAll('[data-tab-id]')].filter(visible).map(el => ({ id: el.dataset.tabId, label: el.getAttribute('aria-label'), text: el.innerText })),
    launchpadButton: visible(document.querySelector('[data-launchpad-button]')),
    agentPage: [...document.querySelectorAll('[data-ui="agent.view"]')].filter(visible).map(el => ({ text: el.innerText, rows: [...el.querySelectorAll('[role="option"]')].filter(visible).map(row => ({ text: row.innerText, selected: row.getAttribute('aria-selected'), html: row.outerHTML.slice(0, 2500) })), surfaces: [...el.querySelectorAll('[data-ui], [contenteditable="true"], textarea')].filter(visible).map(node => ({ ui: node.dataset.ui, tag: node.tagName, text: node.innerText?.slice(0, 800) })) })),
    fatalFallback: /似乎出现了一些问题|Something went wrong|Component Error|渲染失败/.test(text) || (text.includes('打开调试面板') && text.includes('重新加载')),
    text: text.slice(0, 16000) };
})()`
async function snapshot(name) {
  const state = await evaluate(stateExpression)
  report.observations.push({ name, at: new Date().toISOString(), state })
  const shot = await call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
  writeReport()
  return state
}
async function clickElement(expression, label) {
  const point = await evaluate(`(() => {
    const el = ${expression};
    if (!el) throw new Error(${JSON.stringify(`Missing clickable ${label}`)});
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const style = getComputedStyle(el);
    if (!r.width || !r.height || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0 || !el.contains(document.elementFromPoint(x, y))) throw new Error(${JSON.stringify(`Hidden/obscured ${label}`)});
    return { x, y };
  })()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  report.observations.push({ name: 'actual-click', at: new Date().toISOString(), label, point })
}
async function waitState(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  let state
  while (Date.now() < deadline) {
    state = await evaluate(stateExpression)
    if (state.fatalFallback) throw new Error(`${label}: source fatal fallback`)
    if (predicate(state)) return state
    await sleep(250)
  }
  report.observations.push({ name: `${label}-timeout`, at: new Date().toISOString(), state })
  throw new Error(`${label}: DOM/persisted-state assertion timed out`)
}
const sessionTabs = state => [...state.session.pinnedTabs, ...state.session.normalTabs]
const routeOf = state => sessionTabs(state).find(tab => tab.id === state.session.activeTabId)?.url
const healthy = state => state.tabbar && state.content && !state.fatalFallback && (state.contentText.trim().length > 30 || state.agentPage.some(page => page.surfaces.some(surface => surface.ui === 'chat.composer') && page.surfaces.some(surface => surface.ui === 'part:conversation-navigation')))
const settingsButton = `[...document.querySelectorAll('button[aria-label]')].find(el => /^(设置|Settings)$/.test(el.getAttribute('aria-label')) && el.getBoundingClientRect().width > 0)`
// Whole-run timeout includes startup and teardown, not merely renderer polling.
const watchdog = setTimeout(async () => {
  report.error = `Whole-run timeout in ${phase}`
  process.exitCode = 1
  await cleanup()
  process.exit(1)
}, 150000)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  report.error = `Interrupted: ${signal}`
  process.exitCode = 1
  await cleanup()
  process.exit(1)
})
async function runFileTreeAcceptance() {
  phase = 'bounded-file-tree-ipc'
  // Windows TEMP can contain an 8.3 alias (ADMINI~1). Match the repository's
  // realpath canonicalization before constructing fixture paths or event joins.
  fixture = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-file-tree-acceptance-')))
  const workspacePath = path.join(fixture, 'workspace')
  fs.mkdirSync(workspacePath)
  const seedPath = path.join(workspacePath, 'snapshot-seed.md')
  const eventPath = path.join(workspacePath, 'watcher-added.md')
  const disposedPath = path.join(workspacePath, 'after-dispose.md')
  fs.writeFileSync(seedPath, 'Harness-owned snapshot fixture\n', { flag: 'wx' })
  report.fileTree = { fixture, workspacePath, eventPath, quietWindowMs: 3000, eventTimeoutMs: 10000, events: [] }
  const evidence = report.fileTree
  const normalized = value => path.resolve(value).replace(/\\/g, '/').toLowerCase()
  const request = (route, input) => evaluate(`window.api.ipcApi.request(${JSON.stringify(route)}, ${JSON.stringify(input)})`)
  const observerKey = `__grimoireFileTreeAudit_${process.pid}`
  const observer = `window[${JSON.stringify(observerKey)}]`
  let treeId, subscribed = false, disposed = false
  try {
    evidence.registration = await evaluate(`window.api.dataApi.request({ id: 'file-tree-' + crypto.randomUUID(), method: 'POST', path: '/agent-workspaces', body: ${JSON.stringify({ path: workspacePath, name: 'Bounded file-tree acceptance fixture' })} })`)
    const workspace = evidence.registration?.data
    if (evidence.registration?.status !== 201 || workspace?.type !== 'user' || !workspace.id || normalized(workspace.path) !== normalized(workspacePath)) throw new Error('Real user workspace registration did not return fresh canonical fixture workspace')
    evidence.readback = await evaluate(`window.api.dataApi.request({ id: 'file-tree-' + crypto.randomUUID(), method: 'GET', path: ${JSON.stringify('/agent-workspaces/' + workspace.id)} })`)
    if (evidence.readback?.status !== 200 || evidence.readback.data?.id !== workspace.id || normalized(evidence.readback.data.path) !== normalized(workspacePath)) throw new Error('Registered user workspace readback failed')
    report.checks.fileTreeRealUserWorkspaceRegistered = true

    // Invalid and unregistered paths are safe refusal probes: no production path
    // is offered, and the parent fixture container itself was never registered.
    evidence.invalidPath = await request('file.tree.create', { rootPath: 'relative-fixture-path' })
    evidence.unregisteredPath = await request('file.tree.create', { rootPath: fixture })
    report.checks.fileTreeInvalidPathRefused = evidence.invalidPath?.ok === false && evidence.invalidPath.error?.code === 'INVALID_INPUT'
    report.checks.fileTreeUnregisteredPathRefused = evidence.unregisteredPath?.ok === false && evidence.unregisteredPath.error?.code === 'ROOT_NOT_AUTHORIZED'
    if (!report.checks.fileTreeInvalidPathRefused || !report.checks.fileTreeUnregisteredPathRefused) throw new Error('Invalid/unregistered fixture path refusal failed')
    evidence.crossOwner = 'NOT_RUN: invalid/unregistered path refusal exercised instead; no additional owner window manufactured.'

    evidence.create = await request('file.tree.create', { rootPath: workspacePath, options: { maxDepth: 1, respectGitignore: false } })
    const created = evidence.create?.data
    const seed = Object.values(created?.snapshot?.children || {}).find(node => node.basename === path.basename(seedPath))
    if (evidence.create?.ok !== true || typeof created.treeId !== 'string' || !created.treeId || !Number.isSafeInteger(created.revision) || created.revision < 0 || created.snapshot?.kind !== 'directory' || normalized(created.snapshot.path) !== normalized(workspacePath) || seed?.kind !== 'file' || normalized(seed.path) !== normalized(seedPath)) throw new Error('file.tree.create genuine fixture snapshot/identity assertion failed')
    treeId = created.treeId
    report.checks.fileTreeSnapshotJoined = true
    // Observe the genuine source-named preload subscription. This stores only
    // audit observations, never patches APIs, DOM, React state or components.
    await evaluate(`(() => {
      const state = { events: [], unsubscribe: undefined };
      state.unsubscribe = window.api.ipcApi.on('file.tree.mutation', payload => state.events.push(payload));
      if (typeof state.unsubscribe !== 'function') throw new Error('Source mutation subscription returned no unsubscribe');
      ${observer} = state;
      return true;
    })()`)
    subscribed = true
    evidence.activate = await request('file.tree.activate', { treeId, revision: created.revision })
    if (evidence.activate?.ok !== true || evidence.activate.data !== true) throw new Error('file.tree.activate rejected actual snapshot revision')
    report.checks.fileTreeSubscriptionThenActivation = true
    let lastRevision = created.revision
    async function waitMutation(type, expectedPath) {
      const deadline = Date.now() + evidence.eventTimeoutMs
      while (Date.now() < deadline) {
        evidence.events = await evaluate(`${observer}.events`)
        const joined = evidence.events.filter(payload => payload.treeId === treeId)
        let revision = created.revision
        for (const payload of joined) {
          if (!Number.isSafeInteger(payload.revision) || payload.revision !== revision + 1) throw new Error('Mutation treeId/revision sequence not contiguous with create snapshot')
          revision = payload.revision
        }
        const matched = joined.find(payload => payload.revision > lastRevision && payload.event?.type === type && normalized(payload.event.path) === normalized(expectedPath))
        if (matched) { lastRevision = matched.revision; return matched }
        await sleep(100)
      }
      throw new Error(`Actual fixture watcher ${type} event timed out`)
    }
    fs.writeFileSync(eventPath, 'Harness-owned watcher fixture\n', { flag: 'wx' })
    evidence.added = await waitMutation('added', eventPath)
    if (evidence.added.event.kind !== 'file' || evidence.added.event.basename !== path.basename(eventPath) || normalized(evidence.added.event.parentPath) !== normalized(workspacePath)) throw new Error('Added watcher payload did not join actual fixture file and parent')
    report.checks.fileTreeActualAddEventJoined = true
    fs.unlinkSync(eventPath)
    evidence.removed = await waitMutation('removed', eventPath)
    report.checks.fileTreeActualRemoveEventJoined = evidence.removed.revision > evidence.added.revision
    evidence.dispose = await request('file.tree.dispose', { treeId })
    if (evidence.dispose?.ok !== true) throw new Error('file.tree.dispose failed')
    disposed = true
    report.checks.fileTreeDisposed = true
    evidence.reactivateDisposed = await request('file.tree.activate', { treeId, revision: lastRevision })
    if (evidence.reactivateDisposed?.ok !== true || evidence.reactivateDisposed.data !== false) throw new Error('Disposed tree unexpectedly reactivated')
    // Keep the listener alive after disposal: unsubscribe first would make the
    // no-delivery assertion vacuous. Exercise both real FS add and remove.
    evidence.atDispose = await evaluate(`${observer}.events`)
    fs.writeFileSync(disposedPath, 'Harness-owned post-dispose fixture\n', { flag: 'wx' })
    await sleep(1500)
    fs.unlinkSync(disposedPath)
    await sleep(1500)
    evidence.events = await evaluate(`${observer}.events`)
    report.checks.fileTreeNoDeliveryAfterDispose = JSON.stringify(evidence.events) === JSON.stringify(evidence.atDispose)
    if (!report.checks.fileTreeNoDeliveryAfterDispose) throw new Error('Mutation delivered after dispose while subscription remained active')
    evidence.scope = 'Real Electron/preload IPC and actual shallow filesystem watcher only. No runtime/prewarm/stream/Notes/File workflow acceptance claim.'
    writeReport()
  } finally {
    if (ws?.readyState === 1) {
      if (treeId && !disposed) {
        try { evidence.failureDispose = await request('file.tree.dispose', { treeId }) } catch (error) { evidence.failureDisposeError = error.message }
      }
      if (subscribed) await evaluate(`(() => { const state = ${observer}; if (state) { state.unsubscribe(); delete ${observer}; } return true; })()`)
    }
  }
}
try {
  if (!fs.existsSync(artifact)) throw new Error(`Missing prebuilt artifact: ${artifact}; no build performed`)
  report.compilation = { artifactExists: true, modifiedAt: fs.statSync(artifact).mtime.toISOString(), buildRunByAudit: false }
  // Read the source contract rather than transcribing a version that can go stale.
  const constants = fs.readFileSync(path.join(root, 'src/vendor/cherry/source/src/shared/utils/constants.ts'), 'utf8')
  const version = constants.match(/LATEST_PRIVACY_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1]
  if (!version) throw new Error('Cannot read source privacy-policy contract')
  const { WebSocket } = require('ws')
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)) })
  })
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-source-shell-'))
  report.profile = profile
  report.debuggerPort = port
  const env = { ...process.env, GRIMOIRE_OPEN_CHERRY: '1' }
  // Inherited flags must not run the visual fixture or cause Electron to run as Node.
  delete env.GRIMOIRE_VISUAL_CAPTURE
  delete env.ELECTRON_RUN_AS_NODE
  phase = 'electron-launch'
  child = spawn(require('electron'), ['.', `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  })
  let launchError
  child.on('error', error => { launchError = error })
  child.on('exit', (code, signal) => { report.electronExit = { code, signal } })
  child.stdout.on('data', data => output.push(data.toString()))
  child.stderr.on('data', data => output.push(data.toString()))
  report.pid = child.pid
  let target
  const deadline = Date.now() + 45000
  while (!target && Date.now() < deadline) {
    if (launchError) throw launchError
    if (report.electronExit) throw new Error(`Electron exited before Cherry selection: ${JSON.stringify(report.electronExit)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()
      report.targets = list.map(({ id, url, title }) => ({ id, url, title }))
      target = list.find(entry => entry.type === 'page' && /cherry[\\/-].*\/index\.html/.test(entry.url))
    } catch {}
    if (!target) await sleep(300)
  }
  if (!target) throw new Error('No actual Cherry compat window on this launched debugger port')
  report.selectedTarget = { id: target.id, url: target.url, title: target.title }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000)
    ws.once('open', () => { clearTimeout(timer); resolve() })
    ws.once('error', error => { clearTimeout(timer); reject(error) })
  })
  ws.on('message', data => {
    const message = JSON.parse(data.toString())
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer); pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    } else if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded', 'Inspector.targetCrashed', 'Network.loadingFailed'].includes(message.method)) {
      report.events.push({ phase, method: message.method, params: message.params })
    }
  })
  ws.on('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP closed')) }
    pending.clear()
  })
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable'); await call('Network.enable')
  // Stabilize CDP viewport coordinates across native Windows DPI/window resize.
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  phase = 'profile-verification'
  const info = await evaluate(`window.api.ipcApi.request('app.get_info')`)
  report.appInfo = info
  if (info?.ok !== true || path.resolve(info.data.appDataPath).toLowerCase() !== path.resolve(profile).toLowerCase()) {
    throw new Error('Profile isolation not verified through app.get_info; refusing all preference writes')
  }
  report.checks.isolatedProfile = true
  // Source MainWindowContent accepts 'skipped'; useIsPrivacyUpdateRequired consumes these
  // genuine persisted preference keys. No DOM, props, caches or API objects are patched.
  const preferences = {
    'cherry_pref.app.onboarding.provider_setup.status': 'skipped',
    'cherry_pref.app.privacy.policy_version': version,
    'cherry_pref.app.privacy.data_collection.enabled': false,
    ...(process.argv.includes('--interactions') ? { 'cherry_pref.agent.session.display_mode': 'time' } : {})
  }
  report.preferences = await evaluate(`(async () => {
    const entries = ${JSON.stringify(preferences)};
    const results = {};
    for (const [key, value] of Object.entries(entries)) results[key] = await window.api.settings.set(key, JSON.stringify(value));
    const stored = await window.api.settings.getAll();
    return { results, stored: Object.fromEntries(Object.keys(entries).map(key => [key, stored[key]])) };
  })()`)
  if (Object.values(report.preferences.results).some(value => value !== true) || Object.entries(preferences).some(([key, value]) => report.preferences.stored[key] !== JSON.stringify(value))) throw new Error('Real onboarding preference persistence failed')
  phase = 'source-bootstrap'
  const url = pathToFileURL(artifact).href
  report.navigation = await call('Page.navigate', { url })
  if (report.navigation.errorText) throw new Error(`Page.navigate: ${report.navigation.errorText}`)
  let state
  const mountDeadline = Date.now() + 45000
  while (Date.now() < mountDeadline) {
    state = await evaluate(stateExpression)
    report.observations.push({ name: 'bootstrap-poll', at: new Date().toISOString(), state })
    if (state.url === url && (state.fatalFallback || (state.tabbar && state.content && state.tabs.length && state.contentText.trim().length > 30))) break
    await sleep(500)
  }
  await sleep(2000)
  state = await snapshot('startup')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()
  report.checks.sameWebContents = targets.some(entry => entry.id === target.id && entry.url === url)
  report.checks.mainAppBootstrapObserved = report.events.some(event => event.phase === 'source-bootstrap' && event.method === 'Runtime.consoleAPICalled' && event.params.args?.some(arg => arg.value === 'MainApp initialized'))
  report.checks.appShellChromeMounted = state.tabbar && state.content && state.sidebar && state.tabs.length > 0
  report.checks.actualRouteContentMounted = !state.fatalFallback && (state.contentText.trim().length > 30 || state.agentPage.some(page => page.surfaces.some(surface => surface.ui === 'chat.composer') && page.surfaces.some(surface => surface.ui === 'part:conversation-navigation')))
  report.checks.appShellMounted = report.checks.appShellChromeMounted && report.checks.actualRouteContentMounted
  if (!report.checks.sameWebContents || !report.checks.mainAppBootstrapObserved || !report.checks.appShellMounted) throw new Error('Authentic MainApp/AppShell mount assertion failed; see startup.png, observations and exact CDP events')
  if (fileTreeOnly) {
    // MainApp has mounted in the existing real Cherry WebContents and announced
    // readiness itself. File-tree admission uses that registered source shell,
    // never the Grimoire window or an unregistered manufactured document.
    await runFileTreeAcceptance()
    report.passed = true
    phase = 'bounded-file-tree-complete'
    console.log('PASS: bounded file-tree IPC acceptance only; full smoke prewarm/stream blockers remain')
  } else {
  if (!process.argv.includes('--interactions')) {
  phase = 'tab-interaction'
  // Drive the source + button with actual CDP input, never manufacture tab props.
  const button = await evaluate(`(() => { const r = document.querySelector('[data-launchpad-button]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...button, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button, button: 'left', clickCount: 1 })
  await sleep(2000)
  const after = await snapshot('new-tab')
  report.checks.sourceTabButtonWorks = after.tabs.length > state.tabs.length && after.contentText.trim().length > 30 && !after.fatalFallback
  if (!report.checks.sourceTabButtonWorks) throw new Error('Actual source + button did not create a second content-bearing tab')
  async function selectTab(id) {
    await clickElement(`[...document.querySelectorAll('[data-tab-id]')].find(el => el.dataset.tabId === ${JSON.stringify(id)} && el.getBoundingClientRect().width > 0)`, `source tab ${id}`)
    await sleep(1000)
  }
  await selectTab(state.tabs[0].id)
  const restored = await snapshot('original-tab-restored')
  report.checks.originalTabRestored = restored.contentText.trim() === state.contentText.trim() && restored.tabs.length === after.tabs.length && !restored.fatalFallback
  const newTab = after.tabs.find(tab => !state.tabs.some(original => original.id === tab.id))
  await selectTab(newTab.id)
  const returned = await snapshot('new-tab-restored')
  report.checks.newTabRestored = returned.contentText.trim() === after.contentText.trim() && returned.tabs.length === after.tabs.length && !returned.fatalFallback
  if (!report.checks.originalTabRestored || !report.checks.newTabRestored) throw new Error('Actual source tab switching did not restore each page content')
  phase = 'navigation-producer'
  // Exercise the actual renderer -> main producer -> registered source sender event
  // path. MainWindowRuntime itself must announce readiness; the audit never announces
  // it on the source's behalf or writes tab/router/cache state.
  await selectTab(state.tabs[0].id)
  report.navigationProducer = {
    route: 'navigation.open_route_in_main', input: { path: '/app/launchpad' },
    result: await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/launchpad' })`)
  }
  const producerDeadline = Date.now() + 10000
  let producerState
  while (Date.now() < producerDeadline) {
    producerState = await evaluate(stateExpression)
    if (producerState.contentText.trim() === after.contentText.trim() && !producerState.fatalFallback) break
    await sleep(250)
  }
  producerState = await snapshot('ipc-open-route')
  report.checks.realNavigationProducerWorks = report.navigationProducer.result?.ok === true && producerState.contentText.trim() === after.contentText.trim() && producerState.tabs.length === after.tabs.length && !producerState.fatalFallback
  if (!report.checks.realNavigationProducerWorks) throw new Error('Real navigation.open_route_in_main did not deliver to the ready source shell and activate its existing launchpad tab')
  phase = 'tab-close'
  if (newTab.id === 'home' || state.tabs[0].id !== 'home') throw new Error('Close test requires genuine home plus a non-home launchpad tab')
  await selectTab(newTab.id)
  await clickElement(`[...document.querySelectorAll('[data-tab-id]')].find(el => el.dataset.tabId === ${JSON.stringify(newTab.id)})?.querySelector('[role="button"]')`, 'non-home launchpad close')
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 350 })
  await waitState(s => healthy(s) && s.tabs.length === state.tabs.length && !s.tabs.some(tab => tab.id === newTab.id) && s.tabs.some(tab => tab.id === 'home') && s.session.activeTabId === 'home' && !sessionTabs(s).some(tab => tab.id === newTab.id), 'close launchpad and retain home')
  const closed = await snapshot('launchpad-closed-home-retained')
  report.checks.closeNonHomeRetainsHome = closed.contentText.trim() === state.contentText.trim()
  if (!report.checks.closeNonHomeRetainsHome) throw new Error('Closed launchpad but home page content was not restored')

  phase = 'distinct-routes'
  await clickElement(`document.querySelector('[data-launchpad-button]')`, 'recreate launchpad')
  await waitState(s => healthy(s) && s.tabs.length === closed.tabs.length + 1 && routeOf(s) === '/app/launchpad', 'recreated launchpad persistence')
  const launchpad = await snapshot('launchpad-before-settings')
  const launchpadId = launchpad.session.activeTabId
  await clickElement(settingsButton, 'source settings button')
  await waitState(s => healthy(s) && routeOf(s)?.startsWith('/settings') && sessionTabs(s).length === sessionTabs(launchpad).length + 1, 'source settings distinct route')
  const settings = await snapshot('settings-distinct-route')
  const settingsId = settings.session.activeTabId
  report.distinctRoutes = { launchpadId, settingsId, launchpadRoute: routeOf(launchpad), settingsRoute: routeOf(settings) }
  report.checks.distinctRouteContent = settingsId !== launchpadId && settings.contentText.trim() !== launchpad.contentText.trim()
  if (!report.checks.distinctRouteContent) throw new Error('Source settings click did not produce distinct route content')
  // Settings intentionally uses a focused tabbar (Back button), not all tab buttons.
  // The genuine producer exits focus mode; the settings button reuses the singleton.
  const switchToLaunchpad = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/launchpad' })`)
  if (switchToLaunchpad?.ok !== true) throw new Error('Pre-reload route producer rejected launchpad')
  await waitState(s => healthy(s) && s.session.activeTabId === launchpadId && s.contentText.trim() === launchpad.contentText.trim(), 'launchpad distinct state restored')
  await snapshot('launchpad-distinct-route-restored')
  await clickElement(settingsButton, 'reuse source singleton settings')
  await waitState(s => healthy(s) && s.session.activeTabId === settingsId && routeOf(s) === routeOf(settings) && sessionTabs(s).length === sessionTabs(settings).length && s.contentText.trim() === settings.contentText.trim(), 'settings singleton state restored')
  const beforeReload = await snapshot('before-reload')
  report.checks.distinctRoutesRestore = true

  phase = 'source-reload'
  const eventStart = report.events.length
  // A marker read from the native performance clock proves a new document, not a
  // premature assertion against the still-visible pre-reload page. No marker writes.
  const oldTimeOrigin = await evaluate('performance.timeOrigin')
  await call('Page.reload', { ignoreCache: true })
  const reloadDeadline = Date.now() + 15000
  let documentChanged = false
  while (Date.now() < reloadDeadline) {
    try { documentChanged = await evaluate('performance.timeOrigin') !== oldTimeOrigin } catch (error) {
      if (!/context|Cannot find|Inspected target navigated/i.test(error.message)) throw error
    }
    if (documentChanged) break
    await sleep(250)
  }
  if (!documentChanged) throw new Error('Page.reload never created a new document')
  await waitState(s => healthy(s) && s.url === url && s.session.activeTabId === settingsId && routeOf(s) === routeOf(beforeReload), 'reload active settings restore', 45000)
  const newTimeOrigin = await evaluate('performance.timeOrigin')
  const reloaded = await snapshot('after-reload')
  const stableSession = s => sessionTabs(s).map(({ id, url, type, isPinned }) => ({ id, url, type, isPinned: !!isPinned }))
  report.reload = { oldTimeOrigin, newTimeOrigin, before: beforeReload.session, after: reloaded.session }
  report.checks.actualPageReload = newTimeOrigin !== oldTimeOrigin
  report.checks.persistedTabsRestore = JSON.stringify(stableSession(reloaded)) === JSON.stringify(stableSession(beforeReload)) && !sessionTabs(reloaded).some(tab => tab.id === newTab.id) && sessionTabs(reloaded).some(tab => tab.id === 'home')
  report.checks.activeRouteRestore = reloaded.session.activeTabId === settingsId && routeOf(reloaded) === routeOf(beforeReload) && reloaded.contentText.trim() === beforeReload.contentText.trim()
  report.checks.reloadBootstrapObserved = report.events.slice(eventStart).some(event => event.method === 'Runtime.consoleAPICalled' && event.params.args?.some(arg => arg.value === 'MainApp initialized'))
  if (!report.checks.actualPageReload || !report.checks.persistedTabsRestore || !report.checks.activeRouteRestore || !report.checks.reloadBootstrapObserved) throw new Error('Page.reload failed genuine persisted tabs/active settings route/new MainApp bootstrap assertions')

  phase = 'reload-handshake'
  report.reloadProducer = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/launchpad' })`)
  if (report.reloadProducer?.ok !== true) throw new Error('Post-reload navigation producer rejected request')
  await waitState(s => healthy(s) && s.session.activeTabId === launchpadId && routeOf(s) === '/app/launchpad' && s.contentText.trim() === launchpad.contentText.trim(), 'post-reload lifecycle handshake and launchpad delivery')
  await snapshot('reload-producer-launchpad')
  report.checks.reloadLifecycleHandshake = true

  phase = 'reload-route-switch'
  await selectTab('home')
  await waitState(s => healthy(s) && s.session.activeTabId === 'home' && s.contentText.trim() === state.contentText.trim(), 'reload home dormant route wake')
  await snapshot('reload-home-restored')
  await selectTab(launchpadId)
  await waitState(s => healthy(s) && s.session.activeTabId === launchpadId && s.contentText.trim() === launchpad.contentText.trim(), 'reload launchpad click restore')
  await snapshot('reload-launchpad-restored')
  await clickElement(settingsButton, 'post-reload settings singleton')
  await waitState(s => healthy(s) && s.session.activeTabId === settingsId && s.contentText.trim() === settings.contentText.trim() && JSON.stringify(stableSession(s)) === JSON.stringify(stableSession(beforeReload)), 'reload settings click restore without duplicates')
  await snapshot('reload-settings-restored')
  report.checks.reloadRouteSwitchRestore = true

  }
  phase = 'agent-page'
  report.agentNavigation = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/agents' })`)
  if (report.agentNavigation?.ok !== true) throw new Error(`navigation.open_route_in_main /app/agents: ${JSON.stringify(report.agentNavigation)}`)
  await waitState(s => healthy(s) && routeOf(s)?.startsWith('/app/agents') && s.agentPage.length === 1, 'actual AgentPage mounted')
  await snapshot('agent-page-before-create')
  phase = 'agent-create'
  // Normal registered sender + actual preload/main dispatch. Subscriptions observe
  // committed effects only; no API/React/cache/DOM objects are patched.
  report.agentApi = await evaluate(`(async () => {
    const effects = [];
    const unsubscribe = window.api.dataApi.onDataChanged(value => effects.push(value));
    const request = (method, path, body, params) => window.api.dataApi.request({ id: 'p4-' + crypto.randomUUID(), method, path, ...(body === undefined ? {} : { body }), ...(params === undefined ? {} : { params }) });
    try {
      // Real persisted provider/model fixture, no key or network request. POST
      // initializes an empty model list; PATCH is the actual source sync contract.
      const provider = await request('POST', '/providers', { providerId: 'smoke-provider', name: 'UI smoke provider' });
      const providerModels = provider.status === 201 ? await request('PATCH', '/providers/smoke-provider', { models: [{ id: 'smoke-model', name: 'Smoke model' }] }) : undefined;
      const model = providerModels?.status === 200 ? await request('GET', '/models/smoke-provider::smoke-model') : undefined;
      const fixture = { provider, providerModels, model };
      if (model?.status !== 200 || model.data?.id !== 'smoke-provider::smoke-model') return { fixture, effects };
      const blueprint = await window.api.ipcApi.request('ai.agent.create', { type: 'pi', name: 'UI smoke blueprint', model: model.data.id });
      if (!blueprint.ok) return { fixture, blueprint, effects };
      const agentId = blueprint.data.id;
      const created = await request('POST', '/agent-sessions', { agentId, name: 'UI smoke session', workspace: { type: 'system' } });
      if (created.error) return { fixture, blueprint, created, effects };
      const id = created.data.id;
      // Genuine existing append-event IPC persists fixture text history. This
      // creates no runtime task, and does not spoof any source streaming event.
      const historyEvent = await window.api.agent.sessions.appendEvent({ sessionId: id, type: 'message', data: { role: 'user', content: 'P4 persisted source history marker' } });
      const messages = await request('GET', '/agent-sessions/' + id + '/messages');
      const detail = await request('GET', '/agent-sessions/' + id);
      const list = await request('GET', '/agent-sessions', undefined, { agentId });
      const latest = await request('GET', '/agent-sessions/latest', undefined, { agentId });
      await new Promise(resolve => setTimeout(resolve, 400));
      return { fixture, blueprint, created, historyEvent, messages, detail, list, latest, effects };
    } finally { unsubscribe(); }
  })()`)
  const api = report.agentApi
  report.checks.authoritativeProviderModelFixture = api.fixture?.provider?.status === 201 && api.fixture?.providerModels?.status === 200 && api.fixture?.model?.status === 200 && api.fixture.model.data.id === 'smoke-provider::smoke-model' && api.fixture.model.data.providerId === 'smoke-provider' && api.fixture.model.data.apiModelId === 'smoke-model'
  if (!report.checks.authoritativeProviderModelFixture) throw new Error(`Actual provider/model fixture POST/PATCH/GET failed: ${JSON.stringify(api.fixture)}`)
  if (api.blueprint?.ok !== true) throw new Error(`ai.agent.create: ${JSON.stringify(api.blueprint)}`)
  if (api.created?.status !== 201) throw new Error(`POST /agent-sessions: ${JSON.stringify(api.created)}`)
  const createdSession = api.created.data
  report.checks.persistedMessageRead = api.messages?.status === 200 && api.messages.data?.items?.some(message => message.id === api.historyEvent?.id && message.sessionId === createdSession.id && message.role === 'user' && message.data?.parts?.some(part => part.type === 'text' && part.text === 'P4 persisted source history marker'))
  if (!report.checks.persistedMessageRead) throw new Error(`GET /agent-sessions/:sessionId/messages did not return actual appended history: ${JSON.stringify(api.messages)}`)
  const sameSession = value => value?.id === createdSession.id && value.agentId === api.blueprint.data.id && value.workspaceId === createdSession.workspaceId && JSON.stringify(value.workspace) === JSON.stringify(createdSession.workspace)
  report.checks.sessionJoinedDetailListLatest = sameSession(api.detail?.data) && api.list?.data?.items?.some(sameSession) && sameSession(api.latest?.data?.session)
  report.checks.realSystemWorkspaceJoined = createdSession.workspace?.type === 'system' && !!createdSession.workspace.path && createdSession.workspace.id === createdSession.workspaceId && path.resolve(createdSession.workspace.path).toLowerCase().startsWith(path.resolve(profile).toLowerCase() + path.sep)
  report.checks.realSessionMembershipEffects = api.effects.flat().some(effect => effect.endpoint === '/agent-sessions' && effect.kind === 'membership' && effect.entityIds?.includes(createdSession.id))
  report.workspaceProvisioning = 'Registered system allocation only; filesystem creation deferred until runtime, not asserted.'
  report.fixtureModel = 'smoke-provider::smoke-model is registered through actual provider POST + model-list PATCH and verified by model-detail GET; no API key, provider network request or runtime invocation. Catalog registration does not claim executable provider configuration.'
  if (!report.checks.sessionJoinedDetailListLatest || !report.checks.realSystemWorkspaceJoined || !report.checks.realSessionMembershipEffects) throw new Error('Actual session detail/list/latest/workspace/effects join assertions failed')
  await waitState(s => s.agentPage.some(page => page.text.includes('UI smoke blueprint') || page.text.includes('UI smoke session')), 'real create effects render blueprint/session')
  await snapshot('agent-created-real-effects')
  phase = 'agent-select'
  const sessionRow = `[...document.querySelectorAll('[data-ui="agent.view"] [role="option"]')].find(el => el.innerText.includes('UI smoke session') && el.getBoundingClientRect().width > 0)`
  // If the source chose a collapsed blueprint group, click that genuine rendered
  // row first; expanding a group is not a manufactured navigation/state update.
  const hasSessionRow = await evaluate(`!!(${sessionRow})`)
  if (!hasSessionRow) {
    await clickElement(`[...document.querySelectorAll('[data-ui="agent.view"] [role="option"], [data-ui="agent.view"] button')].find(el => el.innerText.includes('UI smoke blueprint') && el.getBoundingClientRect().width > 0)`, 'rendered blueprint row')
    await sleep(1000)
    await snapshot('agent-blueprint-clicked')
  }
  if (hasSessionRow) await clickElement(sessionRow, 'rendered UI smoke session row')
  await waitState(s => healthy(s) && routeOf(s)?.includes(createdSession.id) && s.tabs.some(tab => tab.text === 'UI smoke session'), 'rendered blueprint/session actual AgentPage selection')
  await waitState(s => s.agentPage.some(page => page.surfaces.some(surface => surface.ui === 'chat.message-list' && surface.text.includes('P4 persisted source history marker'))), 'actual source message list loads persisted marker')
  const selected = await snapshot('agent-session-selected')
  report.checks.actualSourcePersistedHistoryRendered = selected.agentPage.some(page => page.surfaces.some(surface => surface.ui === 'chat.message-list' && surface.text.includes('P4 persisted source history marker')))
  report.mainContentScope = 'Actual persisted user history text is verified in API response by event ID and rendered source message-list. This does not claim runtime, prewarm or send readiness.'
  report.selectionMechanism = hasSessionRow ? 'actual session row click' : 'actual blueprint row click selecting existing latest session'
  report.checks.actualBlueprintOrSessionSelected = routeOf(selected).includes(createdSession.id) && selected.tabs.some(tab => tab.text === 'UI smoke session')
  report.checks.agentSessionMainContent = selected.agentPage.some(page => page.surfaces.some(surface => surface.ui === 'part:conversation-main' && surface.text.includes('UI smoke blueprint') && !surface.text.includes('请选择智能体')) && page.surfaces.some(surface => surface.ui === 'chat.message-list') && page.surfaces.some(surface => surface.ui === 'chat.composer'))
  if (!report.checks.actualBlueprintOrSessionSelected || !report.checks.agentSessionMainContent) throw new Error('AgentPage session identity/main conversation surface assertion failed')
  if (process.argv.includes('--interactions')) {
    phase = 'agent-interactions'
    const visibleSurface = selector => `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => {
        const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 && !node.inert;
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.innerText, bounds: { x: r.x, y: r.y, width: r.width, height: r.height } };
    })()`
    async function captureSurface(name, selector) {
      const deadline = Date.now() + 10000;
      let surface;
      while (Date.now() < deadline) {
        surface = await evaluate(visibleSurface(selector));
        if (surface && surface.bounds.width > 80 && surface.bounds.height > (name === 'quick-panel-open' ? 80 : 40)) {
          await sleep(500);
          surface = await evaluate(visibleSurface(selector));
          if (surface && surface.bounds.height > (name === 'quick-panel-open' ? 80 : 40)) break;
        }
        await sleep(100);
      }
      if (!surface || surface.bounds.width <= 80 || surface.bounds.height <= (name === 'quick-panel-open' ? 80 : 40)) throw new Error(`Interaction surface never reached settled visible bounds: ${name}`);
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
      report.interactions ??= {};
      report.interactions[name] = { inputMethod: 'CDP Input.dispatchMouseEvent', surface, sessionId: createdSession.id, observedRoute: routeOf(await evaluate(stateExpression)), screenshot: `${name}.png` };
      writeReport();
    }
    async function escape() {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
    }
    const rowPoint = await evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-ui="agent.view"] [role="option"]')].find(el => el.innerText.includes('UI smoke session') && el.getBoundingClientRect().width > 0);
      if (!row) throw new Error('Persisted session context-menu row unavailable');
      const r = row.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (!row.contains(document.elementFromPoint(x, y))) throw new Error('Session row obscured');
      return { x, y };
    })()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rowPoint });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...rowPoint, button: 'right', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rowPoint, button: 'right', clickCount: 1 });
    await captureSurface('session-context-menu', '[role="menu"]');
    await escape();
    if (await evaluate(visibleSurface('[role="menu"]'))) throw new Error('Session context menu Escape did not dismiss');
    report.checks.sessionContextMenuActualOpenAndDismiss = true;
    await clickElement(`document.querySelector('[data-ui="agent.view"] button[aria-label="输入快捷面板"]')`, 'source QuickPanel launcher');
    await captureSurface('quick-panel-open', '[data-testid="quick-panel"]:not([inert])');
    const activeQuickRow = `(() => [...document.querySelectorAll('[data-testid="quick-panel"] [data-active="true"]')].map(el => el.getAttribute('data-id')))()`;
    const beforeKeyboard = await evaluate(activeQuickRow);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await sleep(200);
    const afterKeyboard = await evaluate(activeQuickRow);
    if (JSON.stringify(beforeKeyboard) === JSON.stringify(afterKeyboard)) throw new Error('QuickPanel ArrowDown did not change active row');
    report.interactions['quick-panel-open'].keyboardNavigation = { before: beforeKeyboard, after: afterKeyboard };
    await escape();
    if (await evaluate(visibleSurface('[data-testid="quick-panel"]:not([inert])'))) throw new Error('QuickPanel Escape did not dismiss');
    const panelHistory = await evaluate(`window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: ${JSON.stringify('/agent-sessions/' + createdSession.id + '/messages')} })`);
    if (panelHistory.status !== 200 || JSON.stringify(panelHistory.data.items.map(message => message.id)) !== JSON.stringify(api.messages.data.items.map(message => message.id))) throw new Error('QuickPanel journey changed persisted message history');
    report.interactions['quick-panel-open'].noMessageSent = true;
    report.checks.quickPanelActualOpenAndDismiss = true;

    const messagePoint = await evaluate(`(() => {
      const list = document.querySelector('[data-ui="agent.view"] [data-ui="chat.message-list"]');
      const r = list.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 70 };
    })()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...messagePoint });
    await clickElement(`document.querySelector('[data-ui="agent.view"] [data-ui="chat.message-list"] button[aria-label="删除"]')`, 'persisted message delete confirmation');
    await captureSurface('message-delete-confirm', '[role="dialog"]');
    await clickElement(`[...document.querySelectorAll('[role="dialog"] button')].find(el => /^(取消|Cancel)$/.test(el.innerText.trim()))`, 'message delete cancel');
    await sleep(400);
    const readback = await evaluate(`window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: ${JSON.stringify('/agent-sessions/' + createdSession.id + '/messages')} })`);
    if (readback.status !== 200 || !readback.data.items.some(message => message.id === api.historyEvent.id)) throw new Error('Cancel did not preserve exact persisted message');
    report.interactions['message-delete-confirm'].cancelPreservedMessage = true;
    report.checks.messageDeleteActualConfirmCancel = true;
    writeReport();
  }
  phase = 'agent-rename'
  report.rename = await evaluate(`(async () => {
    const request = (method, path, body, params) => window.api.dataApi.request({ id: 'p4-' + crypto.randomUUID(), method, path, ...(body === undefined ? {} : { body }), ...(params === undefined ? {} : { params }) });
    const path = '/agent-sessions/' + ${JSON.stringify(createdSession.id)};
    const patch = await request('PATCH', path, { name: 'UI smoke session renamed', isNameManuallyEdited: true });
    return { patch, detail: await request('GET', path), list: await request('GET', '/agent-sessions', undefined, { agentId: ${JSON.stringify(api.blueprint.data.id)} }), latest: await request('GET', '/agent-sessions/latest', undefined, { agentId: ${JSON.stringify(api.blueprint.data.id)} }) };
  })()`)
  const renamed = value => sameSession(value) && value.name === 'UI smoke session renamed' && value.isNameManuallyEdited === true
  report.checks.renamePreservesJoinedWorkspace = renamed(report.rename.patch?.data) && renamed(report.rename.detail?.data) && report.rename.list?.data?.items?.some(renamed) && renamed(report.rename.latest?.data?.session)
  if (!report.checks.renamePreservesJoinedWorkspace) throw new Error('PATCH /agent-sessions/:sessionId failed rename/workspace preservation')
  await waitState(s => routeOf(s)?.includes(createdSession.id) && s.agentPage.length === 1 && s.tabs.some(tab => tab.text.includes('UI smoke session renamed')), 'real rename effects update active session tab')
  await snapshot('agent-session-renamed')
  report.checks.renameRealUiEffects = true
  phase = 'agent-new-conversation'
  report.agentActions = await evaluate(`[...document.querySelectorAll('[data-ui="agent.view"] button')].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ label: el.getAttribute('aria-label'), title: el.getAttribute('title'), text: el.innerText }))`)
  const newConversationButton = `[...document.querySelectorAll('[data-ui="agent.view"] button')].find(el => /新建会话|新会话|新建对话|新任务|New (session|conversation|task)/i.test(el.getAttribute('aria-label') || '') && el.getBoundingClientRect().width > 0 && getComputedStyle(el).pointerEvents !== 'none' && Number(getComputedStyle(el).opacity) > 0 && (() => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })())`
  if (await evaluate(`!!(${newConversationButton})`)) {
    await clickElement(newConversationButton, 'source new conversation action')
    await sleep(1500)
    const newTask = await snapshot('agent-new-conversation-result')
    const selectedId = new URL(routeOf(newTask), 'https://source.invalid').searchParams.get('sessionId')
    if (!selectedId) throw new Error('Actual new task action did not select a session URL')
    report.newTaskReadback = await evaluate(`(async () => {
      const request = (path, params) => window.api.dataApi.request({ id: 'p4-' + crypto.randomUUID(), method: 'GET', path, ...(params === undefined ? {} : { params }) });
      return { detail: await request('/agent-sessions/' + ${JSON.stringify(selectedId)}), messages: await request('/agent-sessions/' + ${JSON.stringify(selectedId)} + '/messages'), list: await request('/agent-sessions', { agentId: ${JSON.stringify(api.blueprint.data.id)} }) };
    })()`)
    report.checks.sourceNewTaskCreatesStoredSession = selectedId !== createdSession.id && report.newTaskReadback.detail?.status === 200 && report.newTaskReadback.detail.data.agentId === api.blueprint.data.id && report.newTaskReadback.detail.data.workspace?.type === 'system' && report.newTaskReadback.messages?.status === 200 && report.newTaskReadback.messages.data.items.length === 0 && report.newTaskReadback.list?.data?.items?.some(session => session.id === selectedId) && report.newTaskReadback.list.data.items.some(session => session.id === createdSession.id && session.name === 'UI smoke session renamed')
    if (!report.checks.sourceNewTaskCreatesStoredSession) throw new Error('Actual new task action failed distinct stored empty session/readback/original retention assertions')
  } else {
    report.newConversationAction = 'Not visible in current source layout; no synthetic action dispatched.'
  }
  writeReport()
  report.agentCapabilityBlockers = report.capabilityBlockers.filter(text => /agent-sessions.*messages|ai\.agent\.session|file\.tree|GET \/models\//.test(text))
  report.checks.agentConversationCapabilitiesAvailable = report.agentCapabilityBlockers.length === 0
  report.checks.noUncaughtSourceExceptions = !report.events.some(event => sourcePhases.includes(event.phase) && event.method === 'Runtime.exceptionThrown')
  if ((!process.argv.includes('--interactions') && !report.checks.sourceTabButtonWorks) || !report.checks.noUncaughtSourceExceptions) throw new Error('Source tab interaction or uncaught-exception assertion failed')
  if (!report.checks.agentConversationCapabilitiesAvailable) throw new Error(`AgentPage selected and rename persisted, but conversation capability BLOCKED: ${report.agentCapabilityBlockers.join('; ')}`)
  report.passed = true
  phase = 'complete'
  console.log(process.argv.includes('--interactions') ? 'PASS: focused source AgentPage menu/QuickPanel/message-confirm-cancel journeys; tabs/reload not run in this mode' : 'PASS: real source shell tabs/reload plus blueprint/session create, joined workspace, actual AgentPage selection and rename')
  }
} catch (error) {
  report.error = error.stack || String(error)
  process.exitCode = 1
  if (ws?.readyState === 1) {
    try { await snapshot('failure') } catch (captureError) { report.captureError = captureError.message }
  }
  console.error(`FAIL (${phase}): ${error.message}`)
} finally {
  await cleanup()
  clearTimeout(watchdog)
  console.log(`Evidence: ${outDir}`)
}
