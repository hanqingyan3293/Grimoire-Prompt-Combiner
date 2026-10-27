#!/usr/bin/env node
// Builds the machine-readable UI inventory (M1.1). It merges three sources so nothing is
// retyped: the screenshot catalog (route/component/status/screenshot), the scope decision
// recorded in .agent/records/2026-10-27-takeover/02, and a hand-written action map for the
// pages we keep. A page with no action entry is honest about it: actions stay empty.
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/cherry-ui-catalog/截图清单.json'), 'utf8'))
const items = catalog.items

const structural = new Set([1])
const special = new Map([[20, '页面裁撤，只借设置壳样式'], [21, '保留样式，放主应用设置'], [30, '设置中心的分组卡片模板'], [72, '改造为我们自己的命令面板'], [78, '源壳/设置壳参考']])
const userDrop = new Set([1, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 19, 24, 28, 32, 77])
const keep = new Set([2, 4, 17, 18, 25, 26, 27, 33, 39, 40, 41, 44, 45, 51, 53, 57, 58, 60, 71, 73, 75, 76, 79])
const pending = new Set([22, 42, 59, 74])
const na = new Set([68, 69])
const recDrop = new Set([9, 23, 29, 31, 34, 35, 36, 37, 38, 43, 46, 47, 48, 49, 50, 52, 54, 55, 56, 61, 62, 63, 64, 65, 66, 67, 70])

function disposition(n) {
  if (structural.has(n)) return 'structural'
  if (special.has(n)) return 'special'
  if (userDrop.has(n)) return 'cut-user'
  if (recDrop.has(n)) return 'cut-recommended'
  if (keep.has(n)) return 'keep'
  if (pending.has(n)) return 'pending'
  if (na.has(n)) return 'not-applicable'
  return 'unknown'
}

const detail = {
  2: { actions: ['列出助手', '新建助手', '进入会话'], data: 'Cherry DataApi /assistants,/topics → Grimoire 服务', gap: '全局 Topic 所有权与消息树未建' },
  4: { actions: ['发送消息', '流式渲染', '停止生成', '消息内工具卡片', '审批卡片'], data: 'ChatEngine/Host Bridge', gap: '源 runtime stream 的 open/attach/detach/abort 未桥（M2）' },
  17: { actions: ['左侧分类导航', '搜索入口'], data: 'compat route registry', gap: '仅壳，具体分类由子路由决定' },
  18: { actions: ['/settings → /settings/provider'], data: 'ROUTE_REDIRECTS', gap: '无' },
  21: { actions: ['主题色选择', '右键菜单样式', '会话列表位置', '字体'], data: 'cherry_pref + 我们的主题变量', gap: '需接入昼夜/色轮主题桥（M1.5）' },
  25: { actions: ['/settings/code-execution → /settings/appearance'], data: 'ROUTE_REDIRECTS', gap: '无' },
  26: { actions: ['应用信息', '缓存清理', '导入外部数据', 'Markdown 导出', '云备份（只读/拒绝）'], data: 'app.get_info / cache_cleanup / export.*', gap: '数据重置与迁移永久拒绝' },
  27: { actions: ['二进制工具探测'], data: 'binary-tools.service', gap: '安装/更新拒绝（无 mise）' },
  30: { actions: ['只读源页面', '域能力报告', '缺失服务清单'], data: '静态 + Host Bridge domains', gap: '托盘/自启/代理/防休眠无消费者' },
  33: { actions: ['/settings/mcp → 列表'], data: 'ROUTE_REDIRECTS', gap: '无' },
  39: { actions: ['服务器列表', '搜索', '启停', '连接测试', '新增'], data: 'DataApi /mcp-servers → mcp.service', gap: '批量操作与导入未做' },
  40: { actions: ['编辑表单', '工具/资源/提示词/日志页签', '保存', '删除'], data: 'mcp.service + shared cache', gap: '长连接日志只保留最近一次' },
  41: { actions: ['四个默认模型选择', 'focus 深链'], data: 'cherry_pref + model catalog', gap: 'quick/translate/painting 的执行消费者未验证' },
  44: { actions: ['提示词列表', '新增', '删除'], data: 'prompt_assets', gap: 'PATCH 未实现；visibility 恒 global' },
  45: { actions: ['供应商增删改', '拉模型', '连接测试', '密钥只在主进程'], data: 'providers + provider-connection.service', gap: '鉴权变体（OAuth）未做' },
  51: { actions: ['搜索设置', '回车跳转', '一次性 focusId'], data: '源 SearchResultsPage + 源排名', gap: 'q 字节上限验证未接' },
  53: { actions: ['快捷键列表', '冲突提示'], data: 'cherry_pref', gap: '全局钩子未接' },
  57: { actions: ['/settings/system → /settings/general'], data: 'ROUTE_REDIRECTS', gap: '无' },
  58: { actions: ['用量图表', '时间范围'], data: 'usage 表（部分）', gap: 'range/group/metric/cursor 未完全满足' },
  60: { actions: ['工作区壳', '面板拖拽/拆分/合并', '布局持久化'], data: 'workspace.store + SQLite', gap: '与 Cherry 内容区的边界待统一' },
  71: { actions: ['重命名', '置顶', '归档', '删除', '分支'], data: '源上下文菜单 → Host Bridge', gap: '仅允许名单内的动作生效' },
  72: { actions: ['搜索命令', '方向键选择', '回车执行'], data: '源 QuickPanel', gap: '改造为我们的命令面板并接工具注册表' },
  73: { actions: ['确认删除', '取消'], data: '源确认弹窗', gap: '无' },
  75: { actions: ['导入 ChatGPT/Claude 对话'], data: 'POST /assistants,/topics → Grimoire 服务', gap: '缺 per-topic 消息树' },
  76: { actions: ['选择目录', '导出 Markdown'], data: 'data.export.* + selectFolder', gap: '无' },
  78: { actions: ['真实 MainApp + Tabs 导航'], data: 'source-shell 独立构建', gap: '仅审计入口，不做默认' },
  79: { actions: ['运行时能力诊断'], data: 'Host Bridge domains', gap: '无' },
}

const rows = items.map(item => {
  const d = disposition(item.sequence)
  const extra = detail[item.sequence] || {}
  return {
    sequence: item.sequence,
    category: item.categoryName,
    name: item.name,
    route: item.route || null,
    component: item.component || null,
    sourceFile: item.sourceFile || null,
    screenshotStatus: item.status,
    disposition: d,
    note: special.get(item.sequence) || (structural.has(item.sequence) ? '应用外壳，不可裁' : ''),
    actions: extra.actions || [],
    dataSource: extra.data || null,
    gap: extra.gap || null,
    evidence: item.screenshot || null,
  }
})

const counts = rows.reduce((acc, r) => { acc[r.disposition] = (acc[r.disposition] || 0) + 1; return acc }, {})
const out = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: 'artifacts/cherry-ui-catalog/截图清单.json', counts, items: rows }
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
fs.writeFileSync(path.join(root, 'artifacts/cherry-ui-inventory.json'), JSON.stringify(out, null, 2) + '\n')

const labels = { keep: '保留', special: '特殊', 'cut-user': '裁撤（用户点名）', 'cut-recommended': '裁撤（建议）', pending: '待定', 'not-applicable': '不适用', structural: '结构项', unknown: '未分类' }
const md = []
md.push('# Cherry UI 台账（M1.1）', '')
md.push('> 生成方式：运行 scripts/build-cherry-ui-inventory.mjs。数据源：截图清单 + 范围决策 + 动作映射。', '')
md.push('## 汇总', '', '| 处置 | 条数 |', '|---|---|')
for (const [k, v] of Object.entries(counts)) md.push('| ' + (labels[k] || k) + ' | ' + v + ' |')
md.push('', '## 保留与特殊页的真实动作', '', '| # | 页面 | 能做什么 | 数据来源 | 首要缺口 |', '|---|---|---|---|---|')
for (const r of rows.filter(r => r.disposition === 'keep' || r.disposition === 'special')) {
  md.push('| ' + r.sequence + ' | ' + r.name + ' | ' + (r.actions.join('、') || '—') + ' | ' + (r.dataSource || '—') + ' | ' + (r.gap || '—') + ' |')
}
md.push('', '## 待定页（页面能开、后台无功能）', '')
for (const r of rows.filter(r => r.disposition === 'pending')) md.push('- ' + r.sequence + ' ' + r.name + (r.gap ? '：' + r.gap : ''))
md.push('', '## 裁撤清单', '')
md.push(rows.filter(r => r.disposition.startsWith('cut')).map(r => String(r.sequence)).join('、'))
md.push('')
fs.writeFileSync(path.join(root, '.agent/UI-INVENTORY.md'), md.join('\n'))
console.log('inventory written:', rows.length, JSON.stringify(counts))
