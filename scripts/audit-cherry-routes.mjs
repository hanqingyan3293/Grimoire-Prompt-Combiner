// Walks the compat route registry in ONE launched window and reports, per route, whether
// the page rendered real content or fell into the "路由未实现" fallback / an error boundary.
//
//   npm run build && npm run audit:cherry-routes
//
// Requires a prior build: the window loads the COMPILED preload and compat bundle, so a
// registry edit is invisible here until `npm run build` runs. That is a harness property,
// not a bug — and it is the reason a stale run can look like a passing one.
//
// A route that resolves but renders `unknown` is the interesting failure: the registry
// would have accepted the id while the dispatched page is a fallback, which reads as a
// working deep link to anyone who only checks that the hash stuck.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { surfaceIdentity, pngDigest } from './cherry-ui-capture-evidence.mjs'

const root = process.cwd()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-routes-'))
const outDir = path.join(root, 'artifacts/visual/cherry-routes')
fs.mkdirSync(outDir, { recursive: true })

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.', `--user-data-dir=${userData}`, '--remote-debugging-port=9346'],
  // `GRIMOIRE_OPEN_CHERRY` opens the Cherry window and LEAVES IT OPEN; it must NOT be
  // `GRIMOIRE_VISUAL_CAPTURE`, which additionally runs the app's own viewport/theme matrix
  // and then calls `app.quit()` on a timer. With the capture flag set, this audit raced the
  // app's self-termination: whichever route was in flight when the app quit got no CDP
  // response and was reported FAIL. The failure followed the LAST POSITION, not the route —
  // About failed last, and after reordering, notifications failed last instead. That
  // signature is what identified this as an audit bug rather than a page bug.
  { cwd: root, env: { ...process.env, GRIMOIRE_OPEN_CHERRY: '1' }, stdio: 'ignore', shell: process.platform === 'win32' }
)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

let target = null
for (let i = 0; i < 90 && !target; i += 1) {
  await sleep(1000)
  try {
    const list = await (await fetch('http://127.0.0.1:9346/json/list')).json()
    // Select the CHERRY window explicitly. `includes('index.html')` also matches the main
    // renderer, and a Vite dev server (`http://localhost:5173/`) opened by a parallel session
    // appears in this list too — the audit was intermittently driving the WRONG window, which
    // is why a route could report `unimplemented` here while passing in an isolated probe.
    // Matching on the compat bundle path is unambiguous.
    target = list.find(entry => entry.url && entry.url.includes('cherry') && entry.url.includes('index.html'))
      || list.find(entry => entry.title === 'Cherry Compatibility Surface')
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
await new Promise(resolve => ws.on('open', resolve))
// ONE message listener with a pending-request map, rather than a listener added and removed
// per call.
//
// The per-call version had two defects that both showed up as an unexplained `undefined`:
// `Math.random()` ids collide by the birthday paradox over the ~40 round trips in a run
// (two in-flight calls settling off the same reply), and a call that timed out never removed
// its listener, so leaked listeners accumulated across the route loop and each one re-parsed
// every later message. The map makes the id counter monotonic and guarantees a timed-out
// request's entry is deleted, so nothing accumulates across routes.
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
const send = (method, params) => {
  const id = nextId++
  return new Promise(resolve => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
/**
 * Evaluate with a hard timeout. A page whose render throws can leave the runtime unable to
 * answer, and an unbounded await there stalls the whole audit instead of failing one route
 * — which is how the About route's crash originally showed up (as a hang, not a FAIL).
 * Resolves `null` on timeout so the caller reports the route rather than dying.
 */
/** Runs one CDP call with a hard timeout; a timed-out call's pending entry is dropped. */
async function callWithTimeout(method, params, timeoutMs) {
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

const evaluate = async (expression, timeoutMs = 12000) => {
  const result = await callWithTimeout('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
  return result?.result?.value
}

await send('Runtime.enable', {})

// Wait for the shell to be READY, not for a fixed duration.
//
// A fixed 6s hold was flaky in exactly one situation: the first run after a full rebuild, when
// every lazily-split chunk is still cold on disk. That run failed 8 of 26 routes — the LAST
// eight, in list order — and passed on every subsequent run. Failures that follow POSITION
// rather than route identity are the signature of the harness not being ready, so the fix is to
// wait on a real readiness signal and keep a generous cap for the genuinely broken case.
const READY_TIMEOUT_MS = 45000
const READY_POLL_MS = 500
let ready = false
for (let waited = 0; waited < READY_TIMEOUT_MS; waited += READY_POLL_MS) {
  // The shell is mounted once the root element has children AND the route registry has applied a
  // concrete hash. Both are cheap, synchronous reads.
  const state = await evaluate(`(() => {
    const root = document.querySelector('[data-cherry-root]')
    return JSON.stringify({
      mounted: !!root && root.childElementCount > 0,
      hash: window.location.hash || ''
    })
  })()`)
  try {
    const parsed = JSON.parse(state)
    if (parsed.mounted && parsed.hash) { ready = true; break }
  } catch {}
  await sleep(READY_POLL_MS)
}
if (!ready) {
  console.error('audit: the Cherry shell did not become ready within ' + READY_TIMEOUT_MS + 'ms; refusing to report per-route verdicts from an unmounted window')
  ws.close()
  await teardown(child, userData)
  process.exit(1)
}
// One settle beat after mount so the first route's lazy chunk is not competing with boot work.
await sleep(1500)

// Every id in `COMPAT_ROUTE_PATHS` plus the parameterized MCP detail route.
//
// READ FROM THE REGISTRY, not transcribed. The previous version was a hardcoded literal under
// this same comment, so it had silently gone stale: seven newly registered `/app/*` routes were
// absent from the list while the script still printed "all 16 routes rendered" - a gate that
// stops auditing the moment you add a route, and says so in the confident voice of a pass.
// `/settings/mcp/servers` is kept because the registry aliases it to the MCP list route; it is
// a distinct deep link worth exercising even though it resolves to the same id.
// The registry is TypeScript and this script is plain Node, so it is read as TEXT. That is
// enough: the `COMPAT_ROUTE_PATHS` object literal only needs its string values, and the
// parameterized detail pattern is a single named export alongside it.
const registryText = fs.readFileSync(path.join(root, 'src/vendor/cherry/compat/src/route-registry.ts'), 'utf8')
const pathsBlockStart = registryText.indexOf('COMPAT_ROUTE_PATHS')
const pathsBlockEnd = registryText.indexOf('} as const', pathsBlockStart)
const descriptorText = fs.readFileSync(path.join(root, 'src/vendor/cherry/compat/src/settings-route-descriptors.ts'), 'utf8')
const descriptorBlock = descriptorText.slice(descriptorText.indexOf('REMAINING_SETTINGS_PATHS'), descriptorText.indexOf('} as const'))
const DESCRIPTOR_PATHS = [...descriptorBlock.matchAll(/:\s*'([^']+)'/g)].map(match => match[1])
// Derived from the wrapper that actually decides it. The previous literal list had gone
// stale: general/api-gateway/websearch/selection-assistant were mounted as read-only source
// pages, so the audit demanded the OLD diagnostic strings and reported four false failures.
const sourceSettingsText = fs.readFileSync(path.join(root, 'src/vendor/cherry/compat/src/CompatSourceSettings.tsx'), 'utf8')
const sourceSettingsBlock = sourceSettingsText.slice(sourceSettingsText.indexOf('const SOURCE_SETTINGS'), sourceSettingsText.indexOf('} as const', sourceSettingsText.indexOf('const SOURCE_SETTINGS')))
// ids are `settings-api-gateway`, paths are `/settings/api-gateway` — converting one to the
// other is what the first attempt got wrong (it produced `/settings-api-gateway`, matched
// nothing, and the four pages kept their stale diagnostic signals).
const MOUNTED_SOURCE_SETTINGS = new Set([...sourceSettingsBlock.matchAll(/'?(settings-[a-z-]+)'?:\s*\{/g)].map(match => '/settings/' + match[1].replace(/^settings-/, '')))
const SOURCE_SETTINGS_PATHS = new Set([...MOUNTED_SOURCE_SETTINGS, '/settings/model', '/settings/search', '/settings/file-processing', '/settings/ocr', '/settings/local-models'])
const DIAGNOSTIC_PATHS = DESCRIPTOR_PATHS.filter(route => !SOURCE_SETTINGS_PATHS.has(route))
const REGISTRY_PATHS = [...DESCRIPTOR_PATHS, ...[...registryText.slice(pathsBlockStart, pathsBlockEnd).matchAll(/:\s*'([^']+)'/g)].map(m => m[1])]
if (REGISTRY_PATHS.length === 0) {
  // Fail loudly. An empty list would make this gate report "all 0 routes rendered" and pass.
  console.error('audit: could not read COMPAT_ROUTE_PATHS from the route registry; refusing to report a pass')
  await teardown(child, userData)
  process.exit(1)
}

const ROUTES = [
  ...REGISTRY_PATHS,
  '/settings/skills/fixture-skill',
  '/settings/scheduled-tasks/fixture-task',
  // The registry aliases this to the MCP list route; kept because it is a distinct deep link
  // worth exercising even though it resolves to the same id.
  '/settings/mcp/servers',
  // The source's catch-all under /app/paintings/* is matched by a PATTERN, not a literal in
  // `COMPAT_ROUTE_PATHS`, so a registry-derived list cannot contain it. Exercised explicitly
  // because it is the exact URL the launchpad's 绘画 tile navigates to.
  '/app/paintings/zhipu',
  // BLOCKED diagnostic, also pattern-matched. The launchpad's 小程序 tile lands here, so it is
  // asserted like any other route: it must render its own explanation, not the generic
  // "route not implemented" list and not an empty shell.
  '/app/mini-app'
]

/**
 * Per-route text that must be present, because "the page rendered SOMETHING" is not the
 * question this gate exists to answer.
 *
 * WHY: the verdict used to be `!unimplemented && !boundary && body.length > 40`. Mutation-tested
 * by renaming a registry KEY (`launchpad` -> `launchpadX`) while leaving its path alone: the hash
 * still resolved, the shell fell through to the chat main slot, and the launchpad route rendered
 * the CHAT COMPOSER. The audit reported OK - the body was 207 chars of chat chrome, well over 40,
 * with no boundary and no "路由未实现". That is precisely the "resolves but renders the wrong page"
 * case this script's own header calls the interesting failure, and it was invisible.
 *
 * The strings are the pages' own headings, taken from the renders rather than invented. A route
 * missing from this map is checked against a MINIMUM length only, which is weaker - so the map is
 * expected to grow as routes are registered.
 */
const ROUTE_REDIRECTS = {
  '/settings': '/settings/provider',
  '/settings/system': '/settings/general',
  '/settings/code-execution': '/settings/appearance'
}

const ROUTE_SIGNALS = {
  '/app/chat': ['新对话'],
  '/app/agents': ['添加助手', '主题'],
  '/app/launchpad': ['应用'],
  // Distinctive PAGE strings, never the sidebar rail labels. The rail renders 会话/助手/主题/
  // Provider/MCP/外观/常规/数据/依赖/通知/关于/提示词/用量/快捷键/回收站 on EVERY route, so a
  // signal drawn from those passes on a route that rendered no page at all. Each string below
  // was dumped from the actual render rather than assumed — three guesses had to be corrected
  // (`辅助智能体`, `大师之作`, `浏览器`), which is the check earning its place.
  '/app/browser': ['导入浏览器数据', '正在加载页面'],
  '/app/notes': ['新建笔记'],
  '/app/translate': ['译为', '目标语言'],
  '/app/paintings': ['给你的下一幅杰作', '选择模型'],
  // The launchpad's 绘画 tile navigates to `/app/paintings/<defaultProvider>`; the source has a
  // catch-all route for that, so it renders the same page. Verified by CLICKING the tile — reading
  // the registry alone would not have shown that the click landed on 路由未实现.
  '/app/paintings/zhipu': ['给你的下一幅杰作'],
  // Mounted for the launchpad's 文件 tile. Its two endpoints are unbridged, so the signal asserts
  // the page's own chrome renders; the data error is visible on the page rather than hidden.
  // Now backed by real routes (`/files/entries`, `/files/entries/stats`), so the page renders its
  // library chrome instead of a data error. Asserts the type sidebar, which only renders once the
  // page's own query layer is mounted.
  '/app/files': ['类型', '图片', '所有文件'],
  '/app/file-preview': ['无法预览此文件', '文件预览需要有效的本地绝对路径。'],
  // Asserts the DIAGNOSTIC, not a page: the route must keep naming the tab-shell dependency.
  // Without a signal it would pass on any non-empty render, including a blank shell.
  '/app/mini-app': ['小程序尚未接入', '标签页承载'],
  '/app/knowledge': ['暂无知识库'],
  '/app/code': ['Claude Code', '未安装'],
  '/settings/provider': ['添加服务商'],
  '/settings/model': ['默认助手模型', '快速模型', '翻译模型', '绘画模型'],
  '/settings/browser': ['允许 AI 控制浏览器', '通过内置浏览器打开网站链接', '浏览记录'],
  '/settings/screenshot': ['启用截图', '自动识别文字', '文字识别'],
  '/settings/file-processing': ['源文档处理设置已挂载', '加载可用处理器失败'],
  '/settings/ocr': ['源 OCR 设置已挂载', '加载可用处理器失败'],
  '/settings/local-models': ['源本地模型设置已挂载', '本地模型'],
  '/settings/search': ['没有匹配的设置'],
  '/settings/mcp': ['MCP 服务器', '添加', '未配置服务器'],
  '/settings/mcp/servers': ['MCP 服务器', '添加', '未配置服务器'],
  '/settings/mcp/settings/fixture-mcp': ['Fixture 文档服务'],
  '/settings/mcp/bailian': ['API Token'],
  '/settings/appearance': ['主题颜色', '右键菜单样式', '对话列表位置'],
  '/settings/data': ['数据目录', '云备份设置', '重置数据'],
  '/settings/dependencies': ['环境依赖', '管理应用运行所需的二进制工具'],
  '/settings/notifications': ['对话完成通知', '应用更新', '小程序通知'],
  // Grimoire replaces the source About page (it named Cherry Studio and linked Cherry's feedback
  // address); the signals are now this build's own sections.
  '/settings/about': ['魔导书 Grimoire', '上游与许可'],
  // Not a page: the deliberate BLOCKED diagnostic, asserted by its own heading so the route
  // cannot start reporting OK if the page is ever replaced by an empty surface.
  '/settings/general': ['常规设置尚未接入'],
  '/settings/prompts': ['添加提示词'],
  '/settings/usage': ['最近 30 天'],
  '/settings/shortcut': ['退出全屏'],
  '/settings/archive': ['批量管理', '自动清理周期']
}

// Structural signals for the mounted read-only source pages. Text signals were the reason
// four healthy pages failed after the wrapper changed: the assertions were the OLD page text.
const ROUTE_SELECTORS = {}
for (const mountedPath of MOUNTED_SOURCE_SETTINGS) {
  const id = 'settings-' + mountedPath.slice('/settings/'.length)
  ROUTE_SELECTORS[mountedPath] = ['[data-ui="compat.settings.source-readonly"][data-settings-route="' + id + '"]']
}
// General also hosts the domain capability report (moved out of the dead branch on 2026-10-27).
ROUTE_SELECTORS['/settings/general'] = ['[data-ui="compat.settings.source-readonly"][data-settings-route="settings-general"]', '[data-ui="compat.domain-capabilities"]']
delete ROUTE_SIGNALS['/settings/general']

for (const route of [...DIAGNOSTIC_PATHS, '/settings/skills/fixture-skill', '/settings/scheduled-tasks/fixture-task']) {
  ROUTE_SIGNALS[route] = ['缺失的后端 / 集成合同', '源组件：', '（未挂载）', '本页仅报告阻塞']
}
const catalogDirectory = path.join(root, 'artifacts/cherry-ui-catalog')
const catalogFile = path.join(catalogDirectory, '截图清单.json')
const catalog = process.argv.includes('--catalog-diagnostics') ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : null
if (catalog) {
  const info = await evaluate(`window.api.ipcApi.request('app.get_info')`)
  if (info?.ok !== true || fs.realpathSync.native(info.data.appDataPath).toLowerCase() !== fs.realpathSync.native(userData).toLowerCase()) throw new Error('Catalog diagnostics profile isolation verification failed')
}
const failed = []
for (const route of ROUTES) {
  // Navigate and READ in separate evaluate calls, waiting in Node between them.
  //
  // The first version awaited `setTimeout` INSIDE the page and hung forever on a route
  // whose component throws during render: an error-boundary crash leaves the page's task
  // queue in a state where that promise never settles, so the audit stalled instead of
  // reporting the failing route. Waiting on the Node side means a broken page still yields
  // a verdict — and this is exactly the route that turned out to be broken.
  await evaluate(`(window.location.hash = '#${route}', 'set')`)
  await sleep(1600)
  const signalKey = ROUTE_REDIRECTS[route] ?? route
  const gateSignals = ROUTE_SIGNALS[signalKey] ?? []
  const gateSelectors = ROUTE_SELECTORS[signalKey] ?? []
  const verdict = await evaluate(`JSON.stringify((() => {
    const body = (document.body.innerText || '').trim()
    // The blocked-route fallback renders this heading; it is the honest placeholder for an
    // unregistered path, so finding it means the registry did NOT match. The PATH it names
    // is captured too: it distinguishes "the registry rejected the path we asked for" from
    // "the navigation never landed", which look identical from the byte count alone.
    const unimplemented = body.includes('路由未实现')
    // The source error boundary renders 「似乎出现了一些问题…」 with 打开调试面板 / 重新加载.
    // The original regex did NOT match that text, so a route whose component threw was
    // reported OK — verified on /settings/shortcut, which crashed with
    // "Cannot read properties of undefined (reading 'onRegistrationConflict')" and still
    // passed the audit. Detection now keys on the boundary's OWN signature (the button pair
    // plus the heading) as well as the English strings, so a translated or reworded boundary
    // is still caught.
    const boundaryHeading = /似乎出现了一些问题|出错了|Something went wrong|Component Error|渲染失败/.test(body)
    const boundaryButtons = body.includes('打开调试面板') && body.includes('重新加载')
    const boundary = boundaryHeading || boundaryButtons
    const shownPath = (body.match(/路由未实现：([^\\s]+)/) || [])[1] || ''
    // The thrown message is surfaced so a failing route names its own cause in the report.
    const errorText = boundary ? (body.match(/(Cannot read[^\\n]{0,120}|TypeError[^\\n]{0,120}|Error:[^\\n]{0,120})/) || [])[1] || '' : ''
    // EXPECTED-CONTENT CHECK. Without it a route that silently renders the chat slot passes;
    // see the ROUTE_SIGNALS comment above for the mutation that proved it.
    const isSettings = ${JSON.stringify(route)}.startsWith('/settings')
    const content = isSettings ? document.querySelector('[data-ui="settings.content"]') : document.body
    const contentText = (content?.innerText || '').trim()
    const bounds = content?.getBoundingClientRect()
    const contentVisible = !!bounds && bounds.width > 0 && bounds.height > 0
    const observedPath = window.location.hash.slice(1).split('?')[0]
    const routeMatched = observedPath === ${JSON.stringify(ROUTE_REDIRECTS[route] ?? route)}
    // Settings signals must come from the routed content, not the always-present sidebar.
    const missingSignals = ${JSON.stringify(gateSignals)}.filter(s => !contentText.includes(s))
    const missingSelectors = ${JSON.stringify(gateSelectors)}.filter(sel => !document.querySelector(sel))
    return {
      rendered: routeMatched && contentVisible && !unimplemented && !boundary && contentText.length > 0 && missingSignals.length === 0 && missingSelectors.length === 0,
      unimplemented,
      ...(errorText ? { errorText } : {}),
      boundary,
      ...(missingSignals.length ? { missingSignals } : {}),
      ...(missingSelectors.length ? { missingSelectors } : {}),
      chars: body.length,
      contentChars: contentText.length,
      contentVisible,
      routeMatched,
      hash: window.location.hash,
      ...(unimplemented ? { shownPath } : {})
    }
  })())`.replace('SIGNALS', JSON.stringify(ROUTE_SIGNALS[route] ?? [])))
  let parsed
  try {
    parsed = JSON.parse(verdict)
  } catch {
    // Record WHICH failure this is: `undefined` means the runtime never answered (timeout
    // or a crashed page), while a string means it answered with something unparseable.
    parsed = {
      rendered: false,
      reason: verdict === undefined ? 'no_response' : 'probe_error',
      raw: String(verdict).slice(0, 200)
    }
  }
  if (!parsed.rendered) failed.push(route)
  console.log(route.padEnd(28), parsed.rendered ? 'OK  ' : 'FAIL', JSON.stringify(parsed))
  // Screenshot through the same timeout guard: a crashed page can also stop answering
  // `captureScreenshot`, and an unbounded await there hangs the audit for the same reason
  // the in-page await did.
  const shot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000)
  if (shot?.data) {
    const name = 'route' + route.replace(/[^a-zA-Z0-9]+/g, '-') + '.png'
    fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, 'base64'))
    if (catalog && parsed.rendered && [...DIAGNOSTIC_PATHS, '/settings/skills/fixture-skill', '/settings/scheduled-tasks/fixture-task'].includes(route)) {
      const diagnostic = await evaluate(`(() => {
        const el = document.querySelector('[data-ui="compat.settings.diagnostic"]');
        if (!el || location.hash !== ${JSON.stringify('#' + route)}) return null;
        const r = el.getBoundingClientRect(); const style = getComputedStyle(el);
        if (!r.width || !r.height || style.visibility === 'hidden') return null;
        const text = el.innerText;
        if (!text.includes(${JSON.stringify(route)}) || !text.includes('（未挂载）') || !text.includes('缺失的后端 / 集成合同')) return null;
        return { text, bounds: { x: r.x, y: r.y, width: r.width, height: r.height } };
      })()`);
      if (!diagnostic) { failed.push(route + ' diagnostic assertion'); continue }
      const pattern = route === '/settings/skills/fixture-skill' ? '/settings/skills/$skillId' : route === '/settings/scheduled-tasks/fixture-task' ? '/settings/scheduled-tasks/$taskId' : route;
      const item = catalog.items.find(row => row.route === pattern);
      if (!item) { failed.push(route + ' missing catalog row'); continue }
      const filename = `${item.category}-${String(item.sequence).padStart(4, '0')}_${item.categoryName}-${item.name}.png`;
      const destination = path.join(catalogDirectory, filename);
      fs.writeFileSync(destination, Buffer.from(shot.data, 'base64'));
      item.status = '受阻诊断'; item.capture = 'passed'; item.screenshot = filename;
      item.captureEvidence = { surfaceIdentity: surfaceIdentity(item), pngSha256: pngDigest(destination), entry: 'compat', observedRoute: route, exitCode: 0, assertion: { passed: true, kind: 'capability-diagnostic', visible: true, ...diagnostic }, action: { inputMethod: 'real hash navigation' }, nativeDpi: 'not verified' };
    }
  }
}
if (catalog) {
  catalog.manualAcceptance = 'pending';
  fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
}

if (process.argv.includes('--settings-actions')) {
  const actionReport = { passed: false, checks: {}, observations: [] }
  async function mouseClick(expression) {
    const point = await evaluate(`(() => {
      const el = ${expression}; if (!el) throw new Error('Missing source settings control');
      const r = el.getBoundingClientRect();
      const x = el.getAttribute('role') === 'option' ? r.x + Math.min(30, r.width / 2) : r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (!r.width || !r.height || !el.contains(document.elementFromPoint(x, y))) throw new Error('Source control obscured');
      return { x, y };
    })()`)
    if (!point) throw new Error('Source control point unavailable: ' + expression)
    for (const type of ['mousePressed', 'mouseReleased']) await callWithTimeout('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, 10000)
  }
  async function waitExpression(expression) {
    for (let i = 0; i < 60; i++) { const value = await evaluate(expression); if (value) return value; await sleep(100) }
    throw new Error('Source settings state assertion timed out: ' + expression)
  }
  try {
    await callWithTimeout('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, 10000)
    await evaluate(`window.location.hash = '#/settings/provider'`)
    await waitExpression(`!!document.querySelector('[data-ui="settings.navigation"] button[aria-label="搜索设置"]')`)
    await mouseClick(`document.querySelector('[data-ui="settings.navigation"] button[aria-label="搜索设置"]')`)
    await callWithTimeout('Input.insertText', { text: '右键菜单样式' }, 10000)
    const result = await waitExpression(`(() => {
      const el = document.querySelector('[data-ui="settings.search.results"]');
      if (!el || !location.hash.includes('/settings/search?q=')) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.innerText.includes('右键菜单样式') ? { text: el.innerText, hash: location.hash, bounds: { x: r.x, y: r.y, width: r.width, height: r.height } } : null;
    })()`)
    actionReport.observations.push({ name: 'source-search-results', ...result })
    actionReport.checks.realSourceSearch = true
    const shot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000)
    if (!shot?.data) throw new Error('Missing source search screenshot')
    fs.writeFileSync(path.join(outDir, 'source-settings-search.png'), Buffer.from(shot.data, 'base64'))
    for (const type of ['keyDown', 'keyUp']) await callWithTimeout('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, 10000)
    await waitExpression(`location.hash === '#/settings/appearance' && !!document.querySelector('[data-ui="settings.content"]')`)
    actionReport.checks.keyboardResultNavigation = true
    await evaluate(`window.location.hash = '#/settings/appearance?focusId=setting-appearance-theme-mode'`)
    await waitExpression(`!location.hash.includes('focusId=')`)
    actionReport.checks.oneShotFocusParamConsumed = true
    const provider = await evaluate(`window.api.dataApi.request({ id: crypto.randomUUID(), method: 'POST', path: '/providers', body: { providerId: 'settings-smoke-provider', name: '设置验收供应商' } })`)
    if (provider?.status !== 201) throw new Error('Real settings fixture provider creation failed')
    const modelWrite = await evaluate(`window.api.dataApi.request({ id: crypto.randomUUID(), method: 'PATCH', path: '/providers/settings-smoke-provider', body: { isEnabled: true, models: ['gpt-4o'] } })`)
    if (modelWrite?.status !== 200) throw new Error('Real settings fixture model registration failed')
    actionReport.fixtureReadback = await evaluate(`window.api.providers.list()`)
    actionReport.catalogReadback = await evaluate(`window.api.ai.sessions.catalog.models({ limit: 5000 })`)
    // Reload after seeding. Creating a provider through the DataApi does NOT invalidate the
    // renderer's provider caches (recorded as D10), so without a reload this journey would
    // report a product failure that is really a cache-staleness bug in a different layer.
    // The reload keeps the hash, so the focus URL still exercises the real route.
    await evaluate(`window.location.hash = '#/settings/model?focus=default'`)
    await sleep(200)
    await evaluate(`location.reload()`)
    await sleep(2500)
    await waitExpression(`!!document.querySelector('#setting-model-default-assistant-model button')`)
    await mouseClick(`document.querySelector('#setting-model-default-assistant-model button')`)
    await sleep(500)
    // The picker is virtualized: only rows in view exist in the DOM, so an unfiltered list
    // cannot be asserted by querying options. Type the model name first, then assert — that
    // is also the interaction a user performs.
    await mouseClick(`document.querySelector('[role="dialog"] input')`)
    // Search by PROVIDER name, not the model id: the catalog also contains `openai::gpt-4o`,
    // and a plain id search selects that one (verified 2026-10-27 — the persisted value came
    // back as `openai::gpt-4o`, which is a passing picker and a failing assertion of intent).
    await callWithTimeout('Input.insertText', { text: '设置验收供应商' }, 10000)
    await sleep(600)
    const modelOption = `[...document.querySelectorAll('[role="option"]')].find(el => el.innerText.includes('gpt-4o') && el.getBoundingClientRect().width > 0 && el.getAttribute('aria-disabled') !== 'true')`
    await waitExpression(`!!(${modelOption})`)
    await mouseClick(modelOption)
    await sleep(600)
    actionReport.selectionSettings = await evaluate(`window.api.settings.getAll()`)
    const preferences = await waitExpression(`(async () => {
      const settings = await window.api.settings.getAll();
      return settings['cherry_pref.chat.default_model_id'] === JSON.stringify('settings-smoke-provider::gpt-4o') ? settings : null;
    })()`)
    actionReport.checks.modelSelectionPersisted = true
    actionReport.observations.push({ name: 'model-selection-readback', defaultModel: preferences['cherry_pref.chat.default_model_id'], quickModel: preferences['cherry_pref.chat.quick_model_id'], translateModel: preferences['cherry_pref.translate.model_id'] })
    const modelShot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000)
    if (!modelShot?.data) throw new Error('Model settings screenshot missing')
    fs.writeFileSync(path.join(outDir, 'source-model-settings.png'), Buffer.from(modelShot.data, 'base64'))
    actionReport.passed = true
  } catch (error) {
    actionReport.error = String(error)
    actionReport.failureState = await evaluate(`({ hash: location.hash, text: document.body.innerText, controls: [...document.querySelectorAll('[role="dialog"], [role="option"], [role="button"], button')].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ tag: el.tagName, role: el.getAttribute('role'), text: el.innerText.slice(0, 300), rect: el.getBoundingClientRect().toJSON(), hit: (() => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + 20, r.y + r.height / 2)?.outerHTML.slice(0, 300) })() })) })`)
    failed.push('source settings action journey')
  }
  fs.writeFileSync(path.join(outDir, 'settings-actions.json'), JSON.stringify(actionReport, null, 2))
  console.log('Source settings actions:', actionReport.passed ? 'PASS' : 'FAIL', actionReport.error || '')
}


// Chat click journey: real typing, a real Enter key, a real fake-provider SSE response,
// screenshots of the streaming and settled states, plus a persistence read-back. This is the
// click-level counterpart to `smoke:stream` (which drives the protocol, not the UI).
if (process.argv.includes('--chat-journey')) {
  const chatReport = { passed: false, checks: {}, observations: [] }
  const http = await import('node:http')
  const chatPort = 17000 + Math.floor(Math.random() * 800)
  const answer = '你好，世界'
  const waitFor = async (expression, attempts = 160) => { for (let i = 0; i < attempts; i++) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) { res.writeHead(404); res.end(); return }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const frame = delta => 'data: ' + JSON.stringify({ id: 'audit', object: 'chat.completion.chunk', created: 0, model: 'audit-model', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n'
      res.write(frame({ role: 'assistant', content: '' }))
      for (const char of answer) res.write(frame({ content: char }))
      res.write('data: ' + JSON.stringify({ id: 'audit', object: 'chat.completion.chunk', created: 0, model: 'audit-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise(resolve => server.listen(chatPort, '127.0.0.1', resolve))
  try {
    const provider = await evaluate(`(async () => { try { const saved = await window.api.providers.save({ name: '点击验收供应商', access_mode: 'api', protocol: 'chat_completions', base_url: 'http://127.0.0.1:${chatPort}/v1', api_key: 'audit-key', default_model: 'audit-model', models: ['audit-model'] }); return { saved, apiKeys: Object.keys(window.api.providers) } } catch (error) { return { error: String(error) } } })()`)
    if (!provider?.saved?.id) throw new Error('provider save failed: ' + JSON.stringify(provider))
    await evaluate(`window.api.providers.setActive('` + provider.saved.id + `')`)
    await evaluate(`window.location.hash = '#/app/chat'`)
    await waitFor(`location.hash.includes('/app/chat')`)
    await waitFor(`!!document.querySelector('[data-ui="part:composer-input"]')`)
    const inputPoint = await evaluate(`(() => { const root = document.querySelector('[data-ui="part:composer-input"]'); const el = root.querySelector('[contenteditable="true"], textarea, input') || root; el.focus(); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + r.height / 2), tag: el.tagName, editable: el.getAttribute('contenteditable'), focused: document.activeElement === el } })()`)
    for (const type of ['mousePressed', 'mouseReleased']) await callWithTimeout('Input.dispatchMouseEvent', { type, x: inputPoint.x, y: inputPoint.y, button: 'left', clickCount: 1 }, 10000)
    await callWithTimeout('Input.insertText', { text: '请回答' }, 10000)
    // Read ONE field: for a contenteditable, innerText and textContent are the same text, and
    // concatenating them made a single typed message look doubled in the report.
    const readComposer = `(() => { const root = document.querySelector('[data-ui="part:composer-input"]'); const el = root.querySelector('[contenteditable="true"], textarea, input') || root; if ('value' in el && typeof el.value === 'string' && el.value) return el.value; return el.innerText || el.textContent || '' })()`
    let typed = await evaluate(readComposer)
    chatReport.observations.push({ typedAfterInsertText: String(typed) })
    if (!String(typed).includes('请回答')) {
      // Some contenteditable editors ignore CDP insertText; fall back to the editing command
      // while the element is focused, which is what a keyboard paste does.
      await evaluate(`(() => { const root = document.querySelector('[data-ui="part:composer-input"]'); const el = root.querySelector('[contenteditable="true"], textarea, input') || root; el.focus(); document.execCommand('insertText', false, '请回答'); return true })()`)
      typed = await evaluate(readComposer)
    }
    chatReport.observations.push({ composer: inputPoint, typed: String(typed).slice(0, 40) })
    chatReport.checks.realTyping = String(typed).includes('请回答')
    for (const type of ['keyDown', 'char', 'keyUp']) await callWithTimeout('Input.dispatchKeyEvent', { type, key: 'Enter', text: type === 'char' ? '\r' : undefined, windowsVirtualKeyCode: 13 }, 10000)
    const streamed = await waitFor(`document.body.innerText.includes('你好，世界') ? document.body.innerText.slice(-200) : null`)
    chatReport.checks.realSendKey = true
    const streamingShot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000)
    if (streamingShot?.data) fs.writeFileSync(path.join(outDir, 'chat-journey-streaming.png'), Buffer.from(streamingShot.data, 'base64'))
    const settled = await waitFor(`(() => { const text = document.body.innerText; return text.includes('你好，世界') && text.includes('已完成') ? text.slice(-400) : null })()`)
    chatReport.checks.streamedText = String(settled).includes(answer)
    await sleep(1500)
    const finalShot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000)
    if (finalShot?.data) fs.writeFileSync(path.join(outDir, 'chat-journey-final.png'), Buffer.from(finalShot.data, 'base64'))
    chatReport.persisted = await evaluate(`(async () => { const latest = await window.api.ai.sessions.latest({ kind: 'chat' }); if (!latest) return null; const snapshot = await window.api.ai.sessions.get(latest.id); const assistant = (snapshot.messages || []).filter(message => message.role === 'assistant').pop(); return assistant ? { id: assistant.id, status: assistant.status, text: JSON.stringify(assistant.content) } : null })()`)
    chatReport.checks.persisted = !!chatReport.persisted && String(chatReport.persisted.text).includes(answer)
    chatReport.observations.push({ streamedFirstChars: String(streamed).slice(0, 80), settledTail: String(settled).slice(-80) })
    chatReport.passed = Object.values(chatReport.checks).every(Boolean)
  } catch (error) {
    chatReport.error = String(error)
    chatReport.failureState = await evaluate(`({ hash: location.hash, text: document.body.innerText.slice(0, 800) })`).catch(() => null)
  } finally {
    server.close()
  }
  fs.writeFileSync(path.join(outDir, 'chat-journey.json'), JSON.stringify(chatReport, null, 2))
  console.log('Chat click journey:', chatReport.passed ? 'PASS' : 'FAIL', chatReport.error || '')
}

// Settings wiring journey: the read-only banner must state which switches are live, and the
// developer-mode switch must actually gate DevTools. Both are asserted here, with a screenshot.
if (process.argv.includes('--settings-wiring-journey')) {
  const wiring = { passed: false, checks: {}, observations: [] }
  const waitForLocal = async (expression, attempts = 120) => { for (let i = 0; i < attempts; i++) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  try {
    await evaluate(`window.location.hash = '#/settings/general'`)
    await waitForLocal(`!!document.querySelector('[data-ui="compat.preference-wiring"]')`)
    const wiringText = await waitForLocal(`(() => { const el = document.querySelector('[data-ui="compat.preference-wiring"]'); const text = el && el.innerText; return text && text.includes('/') ? text : null })()`)
    wiring.checks.reportRendered = /已接线\s*\d+\/\d+/.test(String(wiringText))
    wiring.observations.push({ wiringText: String(wiringText).slice(0, 300) })
    // Hidden means "not rendered to the user", which is `display:none`; the node still exists in the
    // DOM because the CSS layer hides it rather than the source component dropping it.
    const pageState = await evaluate(`(() => { const fieldset = document.querySelector('[data-settings-route="settings-general"] fieldset'); const hidden = (selector) => { const el = document.querySelector(selector); return !el || getComputedStyle(el).display === 'none' }; return { enabled: !!fieldset && fieldset.disabled === false, hiddenPrivateNetwork: hidden('#setting-general-allow-private-network'), hiddenCommit: hidden('#setting-general-commit-attribution') } })()`)
    wiring.observations.push({ pageState })
    wiring.checks.pageEditable = !!pageState && pageState.enabled === true
    wiring.checks.deadSwitchesHidden = !!pageState && pageState.hiddenPrivateNetwork === true && pageState.hiddenCommit === true
    const shot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 10000)
    if (shot?.data) fs.writeFileSync(path.join(outDir, 'settings-general-wiring.png'), Buffer.from(shot.data, 'base64'))
    // Developer mode off must be a real gate, not a stored value.
    const writeFalse = await evaluate(`window.api.settings.set('cherry_pref.app.developer_mode.enabled', 'false')`)
    const stored = await evaluate(`(async () => { const all = await window.api.settings.getAll(); return all['cherry_pref.app.developer_mode.enabled'] })()`)
    const toggleResponse = await evaluate(`(async () => { try { const result = await window.api.ipcApi.request('system.toggle_dev_tools'); return { threw: false, result } } catch (error) { return { threw: true, message: String(error) } } })()`)
    wiring.observations.push({ writeFalse, stored, toggleResponse })
    // `ipcApi.request` returns the IpcResult envelope; a refusal is `ok:false`, not a throw.
    wiring.checks.gateClosesWhenOff = !!toggleResponse && toggleResponse.threw === false && toggleResponse.result?.ok === false && toggleResponse.result?.error?.code === 'DEVELOPER_MODE_DISABLED'
    await evaluate(`window.api.settings.set('cherry_pref.app.developer_mode.enabled', 'true')`)
    const toggleOn = await evaluate(`(async () => { try { return await window.api.ipcApi.request('system.toggle_dev_tools') } catch (error) { return { ok: false, error: { code: 'THREW', message: String(error) } } } })()`)
    wiring.observations.push({ toggleOn })
    wiring.checks.gateOpensWhenOn = !!toggleOn && toggleOn.ok === true
    wiring.passed = Object.values(wiring.checks).every(Boolean)
  } catch (error) {
    wiring.error = String(error)
    wiring.failureState = await evaluate(`({ hash: location.hash, text: document.body.innerText.slice(0, 600) })`).catch(() => null)
  }
  fs.writeFileSync(path.join(outDir, 'settings-wiring-journey.json'), JSON.stringify(wiring, null, 2))
  console.log('Settings wiring journey:', wiring.passed ? 'PASS' : 'FAIL', wiring.error || '')
}

// Theme comparison journey: publish the real Grimoire palettes through the theme bridge and capture
// the same route in both appearances, then measure the difference in-page (canvas diff). A theme
// class swap that changes nothing visually would pass a class assertion but fail this one.
if (process.argv.includes('--theme-journey')) {
  const themeReport = { passed: false, checks: {} }
  const waitExpression = async (expression, attempts = 80) => { for (let i = 0; i < attempts; i++) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles/themes.css'), 'utf8')
  const readBlock = (selector) => {
    const start = css.indexOf(selector + ' {')
    if (start < 0) return {}
    const end = css.indexOf('}', start)
    const body = css.slice(start + selector.length + 2, end)
    const vars = {}
    for (const line of body.split('\n')) {
      const match = /^\s*(--color-[a-z-]+):\s*([^;]+);/.exec(line)
      if (match) vars[match[1]] = match[2].trim()
    }
    return vars
  }
  const base = readBlock(':root')
  const light = { ...base, ...readBlock('[data-appearance="light"]') }
  const dark = { ...base, ...readBlock('[data-appearance="dark"]') }
  const publish = async (mode, vars) => evaluate(`window.api.theme.publish({ mode: '${mode}', vars: ${JSON.stringify(vars)} })`)
  const shot = async (name) => {
    const data = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 15000)
    if (!data?.data) throw new Error('screenshot failed: ' + name)
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(data.data, 'base64'))
    return data.data
  }
  try {
    await evaluate(`window.location.hash = '#/app/chat'`)
    // The empty chat page renders the composer without `chat.view`; the composer is the stable anchor.
    await waitExpression(`!!document.querySelector('[data-ui="part:composer-input"]')`)
    await publish('light', light)
    await sleep(600)
    themeReport.checks.lightApplied = await evaluate(`!document.documentElement.classList.contains('dark')`)
    const lightPng = await shot('theme-light')
    await publish('dark', dark)
    await sleep(600)
    themeReport.checks.darkApplied = await evaluate(`document.documentElement.classList.contains('dark')`)
    const darkPng = await shot('theme-dark')
    themeReport.checks.filesDiffer = lightPng !== darkPng
    // Real pixel comparison: both screenshots are decoded in the page and differenced on a canvas,
    // so "the theme changed" is measured, not inferred from a class name.
    const diff = await evaluate(`(async () => {
      const load = (b64) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = 'data:image/png;base64,' + b64 })
      const [a, b] = await Promise.all([load(${JSON.stringify(lightPng)}), load(${JSON.stringify(darkPng)})])
      if (a.width !== b.width || a.height !== b.height) return { mismatch: true }
      const canvas = document.createElement('canvas')
      canvas.width = a.width; canvas.height = a.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(a, 0, 0); const left = ctx.getImageData(0, 0, a.width, a.height).data
      ctx.drawImage(b, 0, 0); const right = ctx.getImageData(0, 0, a.width, a.height).data
      let sum = 0, changed = 0
      for (let i = 0; i < left.length; i += 4) {
        const delta = (Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2])) / 3
        sum += delta
        if (delta > 8) changed += 1
      }
      const pixels = left.length / 4
      return { width: a.width, height: a.height, meanDelta: Math.round((sum / pixels) * 10) / 10, changedPct: Math.round((changed / pixels) * 1000) / 10 }
    })()`)
    themeReport.checks.pixelsDiffer = !!diff && diff.meanDelta > 3 && diff.changedPct > 5
    themeReport.observation = diff
    themeReport.passed = Object.values(themeReport.checks).every(Boolean)
  } catch (error) {
    themeReport.error = String(error)
  }
  fs.writeFileSync(path.join(outDir, 'theme-journey.json'), JSON.stringify(themeReport, null, 2))
  console.log('Theme journey:', themeReport.passed ? 'PASS' : 'FAIL', themeReport.error || '')
}

// API gateway journey: the page's start/stop buttons must drive the real server, and the running
// badge must come from `api_gateway.status` rather than a stored preference.
if (process.argv.includes('--api-gateway')) {
  const gatewayReport = { passed: false, checks: {} }
  const waitForLocal = async (expression, attempts = 80) => { for (let i = 0; i < attempts; i++) { const value = await evaluate(expression); if (value) return value; await sleep(250) } throw new Error('timed out: ' + expression) }
  try {
    await evaluate(`window.api.settings.set('cherry_pref.feature.api_gateway.enabled', 'true')`)
    await evaluate(`window.api.settings.set('cherry_pref.feature.api_gateway.api_key', JSON.stringify('matrix-key'))`)
    await evaluate(`location.hash = '#/settings/api-gateway'`)
    await waitForLocal(`!!document.querySelector('[data-settings-route="settings-api-gateway"]')`)
    const fieldset = await evaluate(`(() => { const fs = document.querySelector('[data-settings-route="settings-api-gateway"] fieldset'); return fs ? fs.disabled : 'MISSING' })()`)
    gatewayReport.checks.pageEditable = fieldset === false
    const started = await evaluate(`window.api.ipcApi.request('api_gateway.start')`)
    gatewayReport.checks.startOk = !!started && started.ok === true && started.data?.running === true
    gatewayReport.start = started?.data ?? null
    // The badge is fed by a 2s cache poll; wait for it to actually flip instead of screenshotting
    // a stale "stopped" state and calling that evidence.
    await waitForLocal("document.body.innerText.indexOf('运行中') >= 0", 20)
    gatewayReport.checks.badgeShowsRunning = true
    const status = await evaluate(`window.api.ipcApi.request('api_gateway.status')`)
    gatewayReport.checks.statusRunning = !!status && status.data?.running === true
    gatewayReport.status = status?.data ?? null
    const shot = await callWithTimeout('Page.captureScreenshot', { format: 'png' }, 15000)
    if (shot?.data) fs.writeFileSync(path.join(outDir, 'settings-api-gateway.png'), Buffer.from(shot.data, 'base64'))
    const stopped = await evaluate(`window.api.ipcApi.request('api_gateway.stop')`)
    gatewayReport.checks.stopOk = !!stopped && stopped.data?.running === false
    gatewayReport.passed = Object.values(gatewayReport.checks).every(Boolean)
  } catch (error) {
    gatewayReport.error = String(error)
    gatewayReport.state = await evaluate(`document.body.innerText.slice(0, 400)`).catch(() => null)
  }
  fs.writeFileSync(path.join(outDir, 'api-gateway-journey.json'), JSON.stringify(gatewayReport, null, 2))
  console.log('API gateway journey:', gatewayReport.passed ? 'PASS' : 'FAIL', gatewayReport.error || '')
}
// Optional P1 transport smoke through the ACTUAL sandboxed renderer/preload/main.
// This fresh profile has no blueprints: empty items is verified data, not a mock result.
// Exercises source pi blueprint creation and mutation, not runtime launch/AgentPage.
// All writes stay in this script's fresh isolated profile; no provider key is used.
if (process.argv.includes('--agent-api-smoke')) {
  const agentProbe = await evaluate(`(async () => {
    const changes = []
    const unsubscribe = window.api.dataApi.onDataChanged(effects => changes.push(effects))
    try {
      const list = await window.api.dataApi.request({ id: 'agent-smoke-list', method: 'GET', path: '/agents', params: { page: 1, limit: 1 } })
      const missing = await window.api.dataApi.request({ id: 'agent-smoke-missing', method: 'GET', path: '/agents/smoke-missing' })
      const updateMissing = await window.api.dataApi.request({ id: 'agent-smoke-update', method: 'PATCH', path: '/agents/smoke-missing', body: { name: 'not-created' } })
      const invalid = await window.api.dataApi.request({ id: 'agent-smoke-invalid', method: 'GET', path: '/agents', params: { limit: 501 } })
      await new Promise(resolve => setTimeout(resolve, 100))
      const readChangeCount = changes.length
      const created = await window.api.ipcApi.request('ai.agent.create', { type: 'pi', name: 'Agent API smoke', model: 'fixture-provider::fixture-model' })
      if (created?.ok !== true || !created.data?.id) return { list, missing, updateMissing, invalid, readChangeCount, created, unsubscribe: typeof unsubscribe }
      const id = created.data.id
      const detail = await window.api.dataApi.request({ id: 'agent-smoke-detail', method: 'GET', path: '/agents/' + encodeURIComponent(id) })
      const renamed = await window.api.dataApi.request({ id: 'agent-smoke-rename', method: 'PATCH', path: '/agents/' + encodeURIComponent(id), body: { name: 'Agent API persisted rename' } })
      const persisted = await window.api.dataApi.request({ id: 'agent-smoke-persisted', method: 'GET', path: '/agents/' + encodeURIComponent(id) })
      const afterList = await window.api.dataApi.request({ id: 'agent-smoke-after', method: 'GET', path: '/agents', params: { page: 1, limit: 1 } })
      await new Promise(resolve => setTimeout(resolve, 100))
      const committedChangeCount = changes.length
      const noop = await window.api.dataApi.request({ id: 'agent-smoke-noop', method: 'PATCH', path: '/agents/' + encodeURIComponent(id), body: { name: 'Agent API persisted rename' } })
      const refused = await window.api.ipcApi.request('ai.agent.create', { type: 'dsh', name: 'must not exist', model: 'fixture-provider::fixture-model' })
      await new Promise(resolve => setTimeout(resolve, 100))
      return { list, missing, updateMissing, invalid, readChangeCount, created, detail, renamed, persisted, afterList, noop, refused, committedChangeCount, changeCount: changes.length, changes, unsubscribe: typeof unsubscribe }
    } finally { unsubscribe() }
  })()`)
  const passed = agentProbe?.list?.status === 200
    && Array.isArray(agentProbe.list.data?.items)
    && agentProbe.list.data.items.length === 0 && agentProbe.list.data.total === 0 && agentProbe.list.data.page === 1
    && agentProbe.missing?.status === 404 && agentProbe.updateMissing?.status === 404
    && agentProbe.invalid?.status === 400 && agentProbe.readChangeCount === 0 && agentProbe.unsubscribe === 'function'
    && agentProbe.created?.ok === true && agentProbe.created.data?.type === 'pi'
    && agentProbe.detail?.status === 200 && agentProbe.detail.data?.id === agentProbe.created.data.id
    && agentProbe.renamed?.status === 200 && agentProbe.persisted?.data?.name === 'Agent API persisted rename'
    && agentProbe.afterList?.data?.total === 1 && agentProbe.afterList.data.items?.[0]?.id === agentProbe.created.data.id
    && agentProbe.noop?.status === 200 && agentProbe.refused?.ok === false
    && agentProbe.refused.error?.code === 'AGENT_SOURCE_RUNTIME_UNAVAILABLE'
    && agentProbe.committedChangeCount === 2 && agentProbe.changeCount === 2
    && agentProbe.changes?.[0]?.some(effect => effect.endpoint === '/agents' && effect.kind === 'membership' && effect.entityIds?.includes(agentProbe.created.data.id))
    && agentProbe.changes?.[1]?.some(effect => effect.endpoint === '/agents/:agentId' && effect.routeParams?.agentId === agentProbe.created.data.id)
  fs.writeFileSync(path.join(outDir, 'agent-api-smoke.json'), JSON.stringify({ passed, ...agentProbe }, null, 2))
  console.log('Agent API preload/main smoke:', passed ? 'PASS' : 'FAIL')
  if (!passed) failed.push('Agent API transport smoke')
}

console.log(
  failed.length === 0
    ? `\nall ${ROUTES.length} routes rendered; screenshots in ${path.relative(root, outDir)}`
    : `\n${failed.length}/${ROUTES.length} routes failed: ${failed.join(', ')}`
)
if (failed.length) process.exitCode = 1

ws.close()
await teardown(child, userData)
// `process.exitCode`, not `process.exit(0)` — the latter discards the failure set above.
setTimeout(() => process.exit(process.exitCode ?? 0), 1500)
