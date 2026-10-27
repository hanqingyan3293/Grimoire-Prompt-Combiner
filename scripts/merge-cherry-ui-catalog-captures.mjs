import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifiedCapture } from './cherry-ui-capture-evidence.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogRoot = path.join(root, 'artifacts/cherry-ui-catalog')
const manifestPath = path.join(catalogRoot, '截图清单.json')
const markdownPath = path.join(catalogRoot, '截图清单.md')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
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
for (const item of interactionItems) {
  if (!manifest.items.some(existing => existing.sequence === item.sequence)) manifest.items.push({ ...item, screenshot: null, capture: 'pending' })
}
manifest.items.sort((a, b) => a.sequence - b.sequence)
for (const item of manifest.items) {
  if (verifiedCapture(item, catalogRoot)) continue
  // Retain old filenames as historical evidence, never infer acceptance from their existence.
  if (item.screenshot) {
    item.historicalScreenshot = item.screenshot
    item.note = '需重新采集：缺少匹配的页面身份、真实状态断言或 PNG 哈希证据'
  }
  item.screenshot = null
  item.capture = 'pending'
  delete item.captureEvidence
}
manifest.generatedAt = new Date().toISOString()
const strictFile = fs.readdirSync(path.join(root, 'artifacts')).filter(name => /^cherry-compat-strict-typecheck-\d{4}-\d{2}-\d{2}\.log$/.test(name)).sort().at(-1)
if (strictFile) {
  const text = fs.readFileSync(path.join(root, 'artifacts', strictFile), 'utf8')
  const exitCode = Number(text.match(/EXIT_CODE=(\d+)/)?.[1] ?? -1)
  manifest.strictTypecheck = { status: exitCode === 0 ? 'passed' : 'failed', exitCode, command: 'npm run typecheck:cherry-compat', diagnostics: (text.match(/^src\//gm) || []).length, evidence: 'artifacts/' + strictFile }
}
manifest.manualAcceptance = 'pending'
manifest.captureSummary = { attempted: manifest.items.filter(item => item.route && item.screenshot).length + (manifest.items.some(item => item.sequence === 60 && item.screenshot) ? 1 : 0), captured: manifest.items.filter(item => item.screenshot).length, failed: 0, failures: [], interactionRowsPending: interactionItems.filter(item => !manifest.items.find(existing => existing.sequence === item.sequence)?.screenshot).length }
manifest.pendingNoPng = manifest.items.filter(item => !item.screenshot).map(item => ({ sequence: item.sequence, name: item.name, status: item.status, route: item.route ?? null, window: item.window ?? null, reason: item.note || (item.status === '非渲染器' ? '非渲染器条目，不生成 PNG' : '独立窗口/平台生命周期未接入，保留无 PNG 诊断') }))
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const lines = ['# Cherry Studio 2.1.4 UI 截图清单', '', `生成时间：${manifest.generatedAt}`, '', '| 序号 | 类别 | 名称 | 路由/窗口 | 状态 | 截图 | 无 PNG 原因 |', '|---:|---|---|---|---|---|---|']
for (const item of manifest.items) {
  const reason = item.screenshot ? '' : (item.note || (item.status === '非渲染器' ? '非渲染器条目，不生成 PNG' : '独立窗口/平台生命周期未接入，保留无 PNG 诊断'))
  lines.push(`| ${String(item.sequence).padStart(4, '0')} | ${item.categoryName} | ${item.name} | ${item.route ?? item.window ?? ''} | ${item.status} | ${item.screenshot ?? '无 PNG'} | ${reason} |`)
}
fs.writeFileSync(markdownPath, lines.join('\n') + '\n')
console.log(JSON.stringify({ items: manifest.items.length, pngs: manifest.items.filter(item => item.screenshot).length, pending: manifest.items.filter(item => !item.screenshot).length, manualAcceptance: manifest.manualAcceptance }, null, 2))
