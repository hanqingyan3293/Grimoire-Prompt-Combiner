// Manifest-driven Cherry UI screenshot catalog capture.
// Uses a fresh Electron profile, the authentic source-shell entry, real navigation IPC,
// and CDP screenshots. It never mutates DOM, React state, caches, or preload APIs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'
import { verifiedCapture } from './cherry-ui-capture-evidence.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogRoot = path.join(root, 'artifacts/cherry-ui-catalog')
const runRoot = path.join(root, 'artifacts/cherry-ui-catalog-runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`)
const manifestPath = path.join(catalogRoot, '截图清单.json')
const markdownPath = path.join(catalogRoot, '截图清单.md')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const require = createRequire(import.meta.url)
const electron = require('electron')
const WebSocket = require('ws')
const artifact = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
fs.mkdirSync(catalogRoot, { recursive: true })
fs.mkdirSync(runRoot, { recursive: true })
if (!fs.existsSync(artifact)) throw new Error(`缺少 source-shell 构建产物：${artifact}`)

const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-cherry-ui-catalog-')))
const port = await new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(error => error ? reject(error) : resolve(value)) })
})
let child
let socket
let nextId = 1
const pending = new Map()
const failures = []
const interactionItems = [
  { sequence: 71, category: '06', categoryName: '聊天命令与弹窗', name: '会话右键菜单', sourceFile: 'src/vendor/cherry/source/src/renderer/components/chat/actions/ResourceListActionContextMenu.tsx', route: '/app/chat', status: '源组件已挂载', kind: 'context-menu' },
  { sequence: 72, category: '06', categoryName: '聊天命令与弹窗', name: '快捷面板', sourceFile: 'src/vendor/cherry/source/src/renderer/components/QuickPanel', route: '/app/chat', status: '源组件已挂载', kind: 'quick-panel' },
  { sequence: 73, category: '06', categoryName: '聊天命令与弹窗', name: '消息确认弹窗', sourceFile: 'src/vendor/cherry/source/src/renderer/components/chat/actions/ActionConfirmDialog.tsx', route: '/app/chat', status: '源组件已挂载', kind: 'dialog' },
  { sequence: 74, category: '05', categoryName: '数据设置子面板', name: '本地备份设置', sourceFile: 'src/vendor/cherry/source/src/renderer/pages/settings/DataSettings/LocalBackupSettings.tsx', route: '/settings/data?panel=local_backup', status: '源组件已挂载', kind: 'data-panel' },
  { sequence: 75, category: '05', categoryName: '数据设置子面板', name: '导入外部数据', sourceFile: 'src/vendor/cherry/source/src/renderer/pages/settings/DataSettings/ImportMenuSettings.tsx', route: '/settings/data?panel=import_settings', status: '源组件已挂载', kind: 'data-panel' },
  { sequence: 76, category: '05', categoryName: '数据设置子面板', name: 'Markdown导出', sourceFile: 'src/vendor/cherry/source/src/renderer/pages/settings/DataSettings/MarkdownExportSettings.tsx', route: '/settings/data?panel=markdown_export', status: '源组件已挂载', kind: 'data-panel' },
  { sequence: 77, category: '02', categoryName: '源壳与标签页', name: '真实源壳启动台标签页', sourceFile: 'src/vendor/cherry/source/src/renderer/components/layout/TabRouter.tsx', route: '/app/launchpad', status: '源组件已挂载', kind: 'source-shell' },
  { sequence: 78, category: '02', categoryName: '源壳与标签页', name: '真实源壳设置标签页', sourceFile: 'src/vendor/cherry/source/src/renderer/components/layout/TabRouter.tsx', route: '/settings/provider', status: '源组件已挂载', kind: 'source-shell' },
  { sequence: 79, category: '08', categoryName: '受阻与不可用界面', name: '源壳运行时能力诊断', sourceFile: 'src/vendor/cherry/source/src/renderer/pages/agents/AgentPage.tsx', route: '/app/agents', status: '受阻诊断', kind: 'agent-blocker' }
]

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function call(method, params = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeout)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }), error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error) }
    })
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result?.result?.value
}
async function waitFor(predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  const expression = typeof predicate === 'string' ? predicate : `(${predicate.toString()})()`
  let value
  while (Date.now() < deadline) {
    value = await evaluate(expression)
    if (value) return value
    await sleep(250)
  }
  throw new Error(`${label} 超时`)
}
async function screenshot(file) {
  const result = await call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
}
function routePath(item) {
  if (item.route === '/settings/mcp/settings/$serverId') return '/settings/mcp/settings/mcp_fixture_docs'
  if (item.route === '/settings/mcp/$') return '/settings/mcp/bailian'
  if (item.route === '/settings/skills/$skillId') return '/settings/skills/fixture-skill'
  if (item.route === '/settings/scheduled-tasks/$taskId') return '/settings/scheduled-tasks/fixture-task'
  if (item.route === '/app/paintings/$') return '/app/paintings/zhipu'
  if (item.route === '/app/mini-app/$appId') return '/app/mini-app/fixture-app'
  if (item.route === '/settings/scheduled-tasks/') return '/settings/scheduled-tasks'
  if (item.route === '/settings/skills/') return '/settings/skills'
  // The source index files have trailing-slash registrations, while the main-process
  // navigation admission deliberately rejects empty path segments. Their concrete index
  // route is the corresponding non-slash path, which is what a user reaches after redirect.
  if (item.route === '/app/mini-app/' || item.route === '/app/paintings/') return item.route.slice(0, -1)
  if (item.route === '/settings/' || item.route === '/settings/mcp/') return item.route.slice(0, -1)
  return item.route
}
function expectedSignals(item) {
  const route = item.route
  const signals = {
    '/app': ['应用'],
    '/app/agents': ['添加智能体'],
    '/app/browser': ['浏览器'],
    '/app/chat': ['对话'],
    '/app/code': ['Claude Code'],
    '/app/file-preview': ['文件'],
    '/app/files': ['所有文件'],
    '/app/knowledge': ['知识库'],
    '/app/launchpad': ['应用'],
    '/app/mini-app/': ['小程序'],
    '/app/mini-app/$appId': ['小程序'],
    '/app/notes': ['笔记'],
    '/app/paintings/': ['杰作'],
    '/app/paintings/$': ['杰作'],
    '/app/release-notes': ['更新日志'],
    '/app/translate': ['目标语言'],
    '/settings/': ['添加服务商'],
    '/settings': ['添加服务商'],
    '/settings/about': ['关于'],
    '/settings/api-gateway': ['API 网关'],
    '/settings/appearance': ['外观'],
    '/settings/archive': ['归档'],
    '/settings/browser': ['浏览器'],
    '/settings/channels': ['频道'],
    '/settings/code-execution': ['外观'],
    '/settings/data': ['数据'],
    '/settings/dependencies': ['环境依赖'],
    '/settings/device-connections': ['设备互联'],
    '/settings/file-processing': ['文档处理'],
    '/settings/general': ['通用'],
    '/settings/local-models': ['本地模型'],
    '/settings/mcp': ['Fixture 文档服务'],
    '/settings/mcp/': ['Fixture 文档服务'],
    '/settings/mcp/$': ['阿里云百炼'],
    '/settings/mcp/builtin': ['内置服务器'],
    '/settings/mcp/marketplaces': ['市场'],
    '/settings/mcp/mcp-install': ['安装'],
    '/settings/mcp/npx-search': ['搜索'],
    '/settings/mcp/servers': ['MCP'],
    '/settings/mcp/settings/$serverId': ['Fixture 文档服务'],
    '/settings/model': ['模型'],
    '/settings/notifications': ['通知'],
    '/settings/ocr': ['OCR'],
    '/settings/prompts': ['提示词'],
    '/settings/provider': ['添加服务商'],
    '/settings/quick-assistant': ['快捷助手'],
    '/settings/scheduled-tasks': ['定时任务'],
    '/settings/scheduled-tasks/': ['定时任务'],
    '/settings/scheduled-tasks/$taskId': ['定时任务'],
    '/settings/screenshot': ['截图'],
    '/settings/search': ['没有匹配的设置'],
    '/settings/selection-assistant': ['划词助手'],
    '/settings/shortcut': ['快捷键'],
    '/settings/skills': ['错误', 'ipcApi 路由未桥接：skill.list_catalog'],
    '/settings/skills/': ['错误', 'ipcApi 路由未桥接：skill.list_catalog'],
    '/settings/skills/$skillId': ['技能'],
    '/settings/system': ['通用'],
    '/settings/usage': ['用量'],
    '/settings/websearch': ['网络搜索']
  }
  return signals[route] || []
}
function sourceRouteEntries() {
  // These three rows are interaction surfaces, not routes. They must only be marked with a
  // PNG after a real context-menu/keyboard/dialog action is driven; a plain /app/chat frame
  // is not evidence that the menu or dialog opened.
  const actionKinds = new Set(['context-menu', 'quick-panel', 'dialog'])
  return manifest.items.filter(item => item.route && item.status !== '非渲染器' && !actionKinds.has(item.kind))
}
function updateManifest() {
  manifest.generatedAt = new Date().toISOString()
  manifest.captureRun = path.relative(root, runRoot).replaceAll(path.sep, '/')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const lines = ['# Cherry Studio 2.1.4 UI 截图清单', '', `生成时间：${manifest.generatedAt}`, '', '| 序号 | 类别 | 名称 | 路由/窗口 | 状态 | 截图 | 无 PNG 原因 |', '|---:|---|---|---|---|---|---|']
  for (const item of manifest.items) {
    const reason = item.screenshot ? '' : (item.note || (item.status === '非渲染器' ? '非渲染器条目，不生成 PNG' : '独立窗口/平台生命周期未接入，保留无 PNG 诊断'))
    lines.push(`| ${String(item.sequence).padStart(4, '0')} | ${item.categoryName} | ${item.name} | ${item.route ?? item.window ?? ''} | ${item.status} | ${item.screenshot ?? '无 PNG'} | ${reason} |`)
  }
  fs.writeFileSync(markdownPath, lines.join('\n') + '\n')
}
function ensureInteractionItems() {
  // 80/81 were an earlier duplicate of the source-window inventory rows 61/62. Remove
  // only those generated duplicates; the source inventory rows remain authoritative.
  manifest.items = manifest.items.filter(item => item.sequence !== 80 && item.sequence !== 81)
  for (const item of interactionItems) {
    const existing = manifest.items.find(candidate => candidate.sequence === item.sequence)
    if (!existing) manifest.items.push({ ...item, screenshot: null, capture: 'pending' })
    else if (['context-menu', 'quick-panel', 'dialog'].includes(existing.kind) && !verifiedCapture(existing, catalogRoot)) {
      // These three rows previously inherited ordinary /app/chat frames. Those are not
      // action evidence. Keep them pending until a real pointer/keyboard action opens the
      // menu/panel/dialog and a non-zero visible bounding box is asserted.
      existing.screenshot = null
      existing.capture = 'pending'
      delete existing.captureEvidence
    }
  }
  manifest.items.sort((a, b) => a.sequence - b.sequence)
}
async function cleanup() {
  try { socket?.close() } catch {}
  if (child?.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}

async function main() {
  ensureInteractionItems()
  // Old startup frames are historical evidence only; do not attach a previous run's
  // PNG to this run's main-window capture verdict.
  child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], {
    cwd: root,
    env: { ...process.env, GRIMOIRE_UI_CATALOG_CAPTURE: '1', GRIMOIRE_CHERRY_ENTRY: 'source-shell' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  const deadline = Date.now() + 45000
  let target
  while (!target && Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find(entry => entry.type === 'page' && entry.url === pathToFileURL(artifact).href)
    } catch {}
    if (!target) await sleep(300)
  }
  if (!target) throw new Error('未找到隔离 source-shell Cherry 页面')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 10000)
    socket.once('open', () => { clearTimeout(timer); resolve() })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
  socket.on('message', data => {
    const message = JSON.parse(data.toString())
    if (message.id === undefined) return
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  const sourceConstants = fs.readFileSync(path.join(root, 'src/vendor/cherry/source/src/shared/utils/constants.ts'), 'utf8')
  const privacyVersion = sourceConstants.match(/LATEST_PRIVACY_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1]
  if (!privacyVersion) throw new Error('Source privacy version could not be read')
  const info = await evaluate(`window.api.ipcApi.request('app.get_info')`)
  if (info?.ok !== true || path.resolve(info.data.appDataPath).toLowerCase() !== path.resolve(profile).toLowerCase()) throw new Error('Isolated profile verification failed; refusing preference writes')
  await evaluate(`(async () => {
    const entries = ${JSON.stringify({
      'cherry_pref.app.onboarding.provider_setup.status': 'skipped',
      'cherry_pref.app.privacy.policy_version': privacyVersion,
      'cherry_pref.app.privacy.data_collection.enabled': false
    })}
    for (const [key, value] of Object.entries(entries)) await window.api.settings.set(key, JSON.stringify(value))
    return true
  })()`)
  await call('Page.navigate', { url: pathToFileURL(artifact).href })
  await waitFor(() => {
    const root = document.querySelector('[data-ui="app.content"]') || document.querySelector('#root')
    return !!root && (root.innerText || '').trim().length > 30
  }, 'source-shell 首屏')
  const entries = sourceRouteEntries()
  for (const item of entries) {
    const actual = routePath(item)
    const signals = expectedSignals(item)
    try {
      let nav
      if (item.kind === 'data-panel') {
        nav = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: '/settings/data' })`)
        if (nav?.ok !== true) throw new Error(`数据设置导航被拒绝：${JSON.stringify(nav)}`)
        await waitFor(`(() => {
          try {
            const cache = JSON.parse(localStorage.getItem('cs_cache_persist') || '{}')
            const tabs = [...(cache['ui.tab.pinned_tabs'] || []), ...(cache['ui.tab.normal_tabs'] || [])]
            return tabs.find(tab => tab.id === cache['ui.tab.active_tab_id'])?.url === '/settings/data'
          } catch { return false }
        })()`, '数据设置页面')
        const panelLabels = { local_backup: '本地备份', import_settings: '导入外部应用数据', markdown_export: 'Markdown 导出' }
        const label = panelLabels[actual.split('panel=')[1]]
        const clicked = await evaluate(`(() => {
          const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"]'))
          const node = nodes.find(el => (el.textContent || '').trim() === ${JSON.stringify(label)} && el.getBoundingClientRect().width > 0)
          if (!node) return false
          node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          return true
        })()`)
        if (!clicked) throw new Error(`数据设置子面板入口未找到：${label}`)
        nav = { ok: true, data: undefined }
      } else if (actual === '/settings' || actual === '/settings/' || actual === '/settings/system' || actual === '/settings/code-execution' || actual === '/app') {
        const redirectTarget = actual === '/settings/system' ? '/settings/general' : actual === '/settings/code-execution' ? '/settings/appearance' : actual === '/app' ? '/app/launchpad' : '/settings/provider'
        nav = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: ${JSON.stringify(redirectTarget)} })`)
      } else if (actual === '/settings/mcp/bailian') {
        nav = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: ${JSON.stringify('/settings/mcp')} })`)
        await sleep(800)
        const clicked = await evaluate(`(() => {
          const nodes = Array.from(document.querySelectorAll('button,[role="menuitem"],[role="button"]'))
          const node = nodes.find(el => (el.textContent || '').includes('阿里云百炼') && el.getBoundingClientRect().width > 0)
          if (!node) return false
          const r = node.getBoundingClientRect()
          node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }))
          return true
        })()`)
        if (!clicked) throw new Error('MCP provider menu item 阿里云百炼 未找到')
      } else {
        nav = await evaluate(`window.api.ipcApi.request('navigation.open_route_in_main', { path: ${JSON.stringify(actual)} })`)
      }
      if (nav?.ok !== true) throw new Error(`导航被拒绝：${JSON.stringify(nav)}`)
      await waitFor(`(() => {
        const text = document.body?.innerText || ''
        const fatal = text.includes('打开调试面板') && text.includes('重新加载')
        let route = ''
        try {
          const cache = JSON.parse(localStorage.getItem('cs_cache_persist') || '{}')
          const tabs = [...(cache['ui.tab.pinned_tabs'] || []), ...(cache['ui.tab.normal_tabs'] || [])]
          route = tabs.find(tab => tab.id === cache['ui.tab.active_tab_id'])?.url || ''
        } catch {}
        const requested = ${JSON.stringify(actual)}
        const routeOk = route === requested || route.startsWith(requested + '?') || (requested.startsWith('/settings/data?panel=') && route === '/settings/data') || (requested === '/settings' && route === '/settings/provider') || (requested === '/settings/' && route === '/settings/provider') || (requested === '/settings/system' && route === '/settings/general') || (requested === '/settings/code-execution' && route === '/settings/appearance') || (requested === '/app' && route === '/app/launchpad') || ((requested === '/settings/mcp' || requested === '/settings/mcp/') && route === '/settings/mcp/servers') || requested === '/settings/mcp/bailian'
        const panelKey = requested.startsWith('/settings/data?panel=') ? requested.split('panel=')[1] : ''
        const panelNeed = ({ local_backup: '本地备份', import_settings: '导入设置', markdown_export: 'Markdown 导出' })[panelKey] || ''
        const panelOk = !panelKey || text.includes(panelNeed)
        return routeOk && !fatal && text.trim().length > 30 && panelOk && ${JSON.stringify(signals)}.every(signal => text.includes(signal))
      })()`, `${actual} 内容断言`)
      const safeName = `${String(item.sequence).padStart(4, '0')}_${item.categoryName}-${item.name}`.replace(/[\\/:*?"<>|]/g, '-')
      const filename = `${item.category}-${safeName}.png`
      const destination = path.join(catalogRoot, filename)
      await screenshot(destination)
      item.screenshot = filename
      item.capture = 'passed'
      item.captureEvidence = { run: path.relative(root, runRoot).replaceAll(path.sep, '/'), actualRoute: actual, viewport: { width: 1920, height: 1080 }, theme: 'light', zoom: 1, realDpi: 'renderer viewport; native DPI not proven', exitCode: 0 }
    } catch (error) {
      item.capture = 'failed'
      item.screenshot = null
      let diagnostic = null
      try {
        diagnostic = await evaluate(`(() => {
          const cache = JSON.parse(localStorage.getItem('cs_cache_persist') || '{}')
          const tabs = [...(cache['ui.tab.pinned_tabs'] || []), ...(cache['ui.tab.normal_tabs'] || [])]
          return { hash: location.hash, route: tabs.find(tab => tab.id === cache['ui.tab.active_tab_id'])?.url || '', text: (document.body?.innerText || '').slice(0, 1200) }
        })()`)
      } catch {}
      item.captureEvidence = { run: path.relative(root, runRoot).replaceAll(path.sep, '/'), actualRoute: actual, noPngReason: error instanceof Error ? error.message : String(error), diagnostic, exitCode: 1 }
      failures.push({ sequence: item.sequence, route: item.route, error: item.captureEvidence.noPngReason, diagnostic })
    }
  }
  ensureInteractionItems()
  manifest.manualAcceptance = 'pending'
  manifest.captureSummary = { attempted: entries.length + (manifest.items.find(item => item.sequence === 60)?.screenshot ? 1 : 0), captured: manifest.items.filter(item => item.capture === 'passed').length, failed: failures.length, failures, interactionRowsPending: interactionItems.filter(item => !manifest.items.find(existing => existing.sequence === item.sequence)?.screenshot).length }
  manifest.pendingNoPng = manifest.items.filter(item => !item.screenshot).map(item => ({ sequence: item.sequence, name: item.name, status: item.status, route: item.route ?? null, window: item.window ?? null, reason: item.note || (item.status === '非渲染器' ? '非渲染器条目，不生成 PNG' : '独立窗口/平台生命周期未接入，保留无 PNG 诊断') }))
  updateManifest()
  fs.writeFileSync(path.join(runRoot, 'capture-report.json'), JSON.stringify({ runRoot, profile, failures, manifest: path.relative(root, manifestPath) }, null, 2))
  if (failures.length) throw new Error(`${failures.length} 个 UI 条目未通过真实内容断言；详情见 ${path.relative(root, runRoot)}`)
}

try {
  await main()
  console.log(`截图目录已更新：${path.relative(root, catalogRoot)}`)
} finally {
  await cleanup()
}
