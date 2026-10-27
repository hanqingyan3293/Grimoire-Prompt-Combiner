import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { surfaceIdentity, preserveCapture } from './cherry-ui-capture-evidence.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoutes = path.join(root, 'src/vendor/cherry/source/src/renderer/routes')
const sourceWindows = path.join(root, 'src/vendor/cherry/source/src/renderer/windows')
const compatRegistry = path.join(root, 'src/vendor/cherry/compat/src/route-registry.ts')
const windowMatrix = path.join(root, '.agent/WINDOW_MATRIX.md')
const catalog = path.join(root, 'artifacts/cherry-ui-catalog')

const categories = [
  ['01', '主窗口与工作区'],
  ['02', '源壳与标签页'],
  ['03', '应用路由'],
  ['04', '设置路由'],
  ['05', '数据设置子面板'],
  ['06', '聊天命令与弹窗'],
  ['07', '独立窗口与弹出面板'],
  ['08', '受阻与不可用界面'],
  ['09', '非渲染器条目']
]
const categoryByName = Object.fromEntries(categories.map(([id, name]) => [name, id]))

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...walk(full))
    else result.push(full)
  }
  return result
}
function relative(file) { return path.relative(root, file).split(path.sep).join('/') }
function text(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' }
function routeRecord(file) {
  const source = text(file)
  const match = source.match(/createFileRoute\(\s*['"]([^'"]+)['"]\s*\)/)
  if (!match) return null
  const route = match[1]
  const component = source.match(/component:\s*([A-Za-z_$][\w$]*)/)?.[1] ?? 'inline/unknown'
  const kind = route.startsWith('/settings') ? 'settings' : route.startsWith('/app') ? 'app' : 'layout'
  return { route, sourceFile: relative(file), component, kind }
}
function compatPaths() {
  const source = text(compatRegistry)
  const values = new Set()
  for (const match of source.matchAll(/(?:^|\n)\s*(?:['"][^'"]+['"]|[A-Za-z0-9_-]+)\s*:\s*['"]([^'"]+)['"]/g)) values.add(match[1])
  if (source.includes("COMPAT_MCP_DETAIL_PATTERN = '/settings/mcp/settings/$serverId'")) values.add('/settings/mcp/settings/$serverId')
  values.add('/settings/mcp/servers')
  return values
}
const remainingDescriptorSource = text(path.join(root, 'src/vendor/cherry/compat/src/settings-route-descriptors.ts'))
const diagnosticRoutes = new Set([...remainingDescriptorSource.slice(0, remainingDescriptorSource.indexOf('export type RemainingSettingsId')).matchAll(/:\s*'([^']+)'/g)].map(match => match[1]))
const sourceSettingsRoutes = new Set(['/settings/model', '/settings/search', '/settings/browser', '/settings/screenshot', '/settings/file-processing', '/settings/ocr', '/settings/local-models'])
function statusFor(record, compat) {
  if (sourceSettingsRoutes.has(record.route) || record.route === '/settings') return ['源组件已挂载', 'Authentic source settings layout/page mounted with explicit capability limits; action acceptance tracked separately']
  if (diagnosticRoutes.has(record.route.replace(/\/$/, '')) || diagnosticRoutes.has(record.route)) return ['受阻诊断', 'Default compat renders a full-slot capability diagnostic; source component is not mounted']
  if (record.route === '/app/mini-app/' || record.route === '/app/mini-app/$appId' || record.route === '/settings/general') return ['受阻诊断', 'Current compat deliberately exposes an honest blocker diagnostic']
  if (compat.has(record.route)) return ['源组件已挂载', 'Reachability is registered; action/backend parity still requires phase acceptance']
  return ['不可用', 'Source route exists but current compat route is not registered']
}
function chineseName(record) {
  const known = {
    '/app': '应用布局', '/app/chat': '对话', '/app/agents': '助手页面', '/app/browser': '浏览器',
    '/app/code': '代码助手', '/app/file-preview': '文件预览', '/app/files': '文件', '/app/knowledge': '知识库',
    '/app/launchpad': '启动台', '/app/mini-app/': '小程序列表', '/app/mini-app/$appId': '小程序详情',
    '/app/notes': '笔记', '/app/paintings/': '绘画', '/app/paintings/$': '绘画通配页',
    '/app/release-notes': '更新日志', '/app/translate': '翻译', '/settings': '设置布局', '/settings/': '设置重定向',
    '/settings/provider': '供应商设置', '/settings/mcp': 'MCP设置布局', '/settings/mcp/': 'MCP重定向',
    '/settings/mcp/servers': 'MCP服务器', '/settings/mcp/settings/$serverId': 'MCP服务器详情',
    '/settings/appearance': '外观设置', '/settings/archive': '归档设置', '/settings/data': '数据设置',
    '/settings/dependencies': '依赖设置', '/settings/general': '通用设置', '/settings/notifications': '通知设置',
    '/settings/prompts': '提示词设置', '/settings/usage': '用量设置', '/settings/shortcut': '快捷键设置',
    '/settings/about': '关于设置', '/settings/api-gateway': 'API网关设置', '/settings/browser': '浏览器设置',
    '/settings/channels': '消息渠道设置', '/settings/device-connections': '设备连接设置', '/settings/file-processing': '文档处理设置',
    '/settings/local-models': '本地模型设置', '/settings/model': '默认模型设置', '/settings/ocr': 'OCR设置',
    '/settings/quick-assistant': '快捷助手设置', '/settings/screenshot': '截图设置', '/settings/search': '设置搜索',
    '/settings/selection-assistant': '划词助手设置', '/settings/websearch': '联网搜索设置',
    '/settings/skills': '技能布局', '/settings/skills/': '技能列表', '/settings/skills/$skillId': '技能详情',
    '/settings/scheduled-tasks': '定时任务布局', '/settings/scheduled-tasks/': '定时任务列表', '/settings/scheduled-tasks/$taskId': '定时任务详情',
    '/settings/mcp/builtin': 'MCP内置服务器', '/settings/mcp/marketplaces': 'MCP市场', '/settings/mcp/mcp-install': 'MCP环境安装',
    '/settings/mcp/npx-search': 'MCP包搜索', '/settings/mcp/$': 'MCP提供商', '/settings/system': '系统设置重定向', '/settings/code-execution': '代码执行设置重定向'
  }
  return known[record.route] ?? record.route.replace(/^\//, '').replaceAll('/', '-')
}
function categoryFor(record) {
  if (record.kind === 'settings') return '04'
  if (record.kind === 'app') return '03'
  return '01'
}

const sourceRouteRecords = walk(sourceRoutes).filter(file => file.endsWith('.tsx')).map(routeRecord).filter(Boolean).sort((a, b) => a.route.localeCompare(b.route))
const compat = compatPaths()
const strictName = fs.readdirSync(path.join(root, 'artifacts')).filter(name => /^cherry-compat-strict-typecheck-\d{4}-\d{2}-\d{2}\.log$/.test(name)).sort().at(-1)
const strictLog = path.join(root, 'artifacts', strictName || 'cherry-compat-strict-typecheck.log')
const strictText = fs.existsSync(strictLog) ? text(strictLog) : ''
const strictDiagnostics = (strictText.match(/^src\//gm) || []).length
let sequence = 1
const items = sourceRouteRecords.map(record => {
  const [status, note] = statusFor(record, compat)
  const category = categoryFor(record)
  const number = String(sequence++).padStart(4, '0')
  return {
    sequence: Number(number), category, categoryName: categories.find(([id]) => id === category)?.[1],
    name: chineseName(record), sourceFile: record.sourceFile, component: record.component,
    route: record.route, status, note, screenshot: null, capture: 'pending'
  }
})
const windowRoots = [
  ['main', 'MainApp.tsx', '主窗口', '源主窗口仅部分接入，默认 compat 入口不是完整 MainApp'],
  ['subWindow', 'SubWindowApp.tsx', '分离会话窗口', '需要独立 conversation window lifecycle 与 topic feed'],
  ['quickAssistant', 'QuickAssistantApp.tsx', '快速助手窗口', '需要 globalShortcut 与 always-on-top lifecycle'],
  ['screenshot', 'ScreenshotApp.tsx', '截图窗口', '需要 display/DPI/permission/capture pipeline'],
  ['selection/toolbar', 'SelectionToolbarApp.tsx', '划词工具栏', '需要 native selection hook'],
  ['selection/action', 'SelectionActionApp.tsx', '划词操作窗口', '依赖 selection toolbar 的真实 payload'],
  ['migrationV2', 'MigrationApp.tsx', 'Cherry旧版迁移窗口', 'Grimoire 没有 Cherry v1 profile，当前不适用'],
  ['userDataRelocation', 'RelocationApp.tsx', '用户数据迁移窗口', '需要安全 boot-time relocation protocol']
]
const windowStatus = {
  main: ['不可用', '主窗口 source-shell 可独立验收；默认 compat 入口仍是 partial'],
  migrationV2: ['不可用', 'Grimoire 没有 Cherry v1 数据'],
  userDataRelocation: ['受阻诊断', '项目明确拒绝未受控 userData relocation'],
  'selection/toolbar': ['受阻诊断', 'native selection hook 未接入'],
  'selection/action': ['受阻诊断', '依赖 selection toolbar'],
  subWindow: ['受阻诊断', 'detached conversation lifecycle 未接入'],
  quickAssistant: ['受阻诊断', 'global shortcut/always-on-top 未接入'],
  screenshot: ['受阻诊断', 'screen capture lifecycle 未接入']
}
const windows = windowRoots.map(([window, fileName, name, note]) => {
  const file = path.join(sourceWindows, window, fileName)
  const [status, statusNote] = windowStatus[window] ?? ['不可用', note]
  return {
    sequence: Number(String(sequence++).padStart(4, '0')), category: '07', categoryName: '独立窗口与弹出面板',
    name, sourceFile: relative(file), window, status, note: statusNote, screenshot: null, capture: 'pending'
  }
})
const nonRenderer = [
  { name: 'MCP浏览器枚举项', status: '非渲染器', note: 'WindowType has no renderer entry in the source closure' },
  { name: '打印枚举项', status: '非渲染器', note: 'Print is an operation, not a renderer window' },
  { name: 'Cherry v1迁移窗口', status: '不可用', note: 'Grimoire has no Cherry v1 profile to migrate' }
].map(item => ({ sequence: Number(String(sequence++).padStart(4, '0')), category: '09', categoryName: '非渲染器条目', ...item, screenshot: null, capture: 'pending' }))

// Interaction and source-shell rows are not createFileRoute registrations, but they are
// controlled UI surfaces required by U6/U7. Keep them in the same flat catalog so rerunning
// this inventory cannot silently discard their capture records.
const interactionEntries = [
  ['06', '聊天命令与弹窗', '会话右键菜单', 'src/vendor/cherry/source/src/renderer/components/chat/actions/ResourceListActionContextMenu.tsx', '/app/agents', '源组件已挂载'],
  ['06', '聊天命令与弹窗', '快捷面板', 'src/vendor/cherry/source/src/renderer/components/QuickPanel/QuickPanelView.tsx', '/app/agents', '源组件已挂载'],
  ['06', '聊天命令与弹窗', '消息删除确认弹窗', 'src/vendor/cherry/source/src/renderer/components/chat/messages/frame/MessageMenuBarToolbarRenderers.tsx', '/app/agents', '源组件已挂载'],
  ['05', '数据设置子面板', '本地备份设置', 'src/vendor/cherry/source/src/renderer/pages/settings/DataSettings/LocalBackupSettings.tsx', '/settings/data?panel=local_backup', '源组件已挂载'],
  ['05', '数据设置子面板', '导入外部数据', 'src/vendor/cherry/source/src/renderer/pages/settings/DataSettings/ImportMenuSettings.tsx', '/settings/data?panel=import_settings', '源组件已挂载'],
  ['05', '数据设置子面板', 'Markdown导出', 'src/vendor/cherry/source/src/renderer/pages/settings/DataSettings/MarkdownExportSettings.tsx', '/settings/data?panel=markdown_export', '源组件已挂载'],
  ['02', '源壳与标签页', '真实源壳启动台标签页', 'src/vendor/cherry/source/src/renderer/components/layout/TabRouter.tsx', '/app/launchpad', '源组件已挂载'],
  ['02', '源壳与标签页', '真实源壳设置标签页', 'src/vendor/cherry/source/src/renderer/components/layout/TabRouter.tsx', '/settings/provider', '源组件已挂载'],
  ['08', '受阻与不可用界面', '源壳运行时能力诊断', 'src/vendor/cherry/source/src/renderer/pages/agents/AgentPage.tsx', '/app/agents', '受阻诊断']
].map(([category, categoryName, name, sourceFile, route, status], index) => ({ sequence: Number(String(sequence++).padStart(4, '0')), category, categoryName, name, sourceFile, route, status, kind: index === 0 ? 'context-menu' : index === 1 ? 'quick-panel' : index === 2 ? 'dialog' : undefined, note: status === '受阻诊断' ? 'Source AgentPage renders, runtime-owned capabilities remain unavailable' : 'Interaction capture requires a real source-shell action', screenshot: null, capture: 'pending' }))

const freshItems = [...items, ...windows, ...nonRenderer, ...interactionEntries]
const priorManifest = process.argv.includes('--write') && fs.existsSync(path.join(catalog, '截图清单.json'))
  ? (() => { try { return JSON.parse(fs.readFileSync(path.join(catalog, '截图清单.json'), 'utf8')) } catch { return null } })()
  : null
const priorByIdentity = new Map((priorManifest?.items || []).map(item => [surfaceIdentity(item), item]))
const preservedItems = freshItems.map(item => {
  const prior = priorByIdentity.get(surfaceIdentity(item))
  if (prior?.status !== item.status) return item
  return preserveCapture(item, prior, catalog)
})
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project: 'Cherry Studio 2.1.4 UI-only migration',
  sourceReadOnly: true,
  runtimeScope: 'OpenCode/Pi runtime integration is owned by another session and excluded',
  strictTypecheck: { status: strictText.includes('EXIT_CODE=0') ? 'passed' : 'failed', command: 'npm run typecheck:cherry-compat', diagnostics: strictDiagnostics, evidence: strictText ? path.relative(root, strictLog).split(path.sep).join('/') : null },
  categories: Object.fromEntries(categories.map(([id, name]) => [id, name])),
  items: preservedItems,
  manualAcceptance: 'pending'
}

if (process.argv.includes('--write')) {
  fs.mkdirSync(catalog, { recursive: true })
  fs.writeFileSync(path.join(catalog, '截图清单.json'), JSON.stringify(manifest, null, 2) + '\n')
  const lines = ['# Cherry Studio 2.1.4 UI 截图清单', '', `生成时间：${manifest.generatedAt}`, '', '| 序号 | 类别 | 名称 | 路由/窗口 | 状态 | 截图 |', '|---:|---|---|---|---|---|']
  for (const item of manifest.items) lines.push(`| ${String(item.sequence).padStart(4, '0')} | ${item.categoryName} | ${item.name} | ${item.route ?? item.window ?? ''} | ${item.status} | ${item.screenshot ?? '待采集'} |`)
  fs.writeFileSync(path.join(catalog, '截图清单.md'), lines.join('\n') + '\n')
  console.log(`wrote ${manifest.items.length} UI inventory rows to ${relative(catalog)}`)
} else {
  console.log(JSON.stringify({ routeRows: items.length, windowRows: windows.length, nonRendererRows: nonRenderer.length, compatPaths: compat.size, write: 'rerun with --write to create the review catalog manifest' }, null, 2))
}
