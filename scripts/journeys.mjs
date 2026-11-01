#!/usr/bin/env node
// Journey suite: one command for the end-to-end evidence (ui-parity.mjs journeys + audit journeys).
//
// These are NOT part of the default gate set: each one boots the real Electron renderer, so the whole suite
// takes several minutes and is meant for after a batch of UI changes or before handing work over. Run with
// `--quick` to skip the two widest matrix runs.
import { spawnSync } from 'node:child_process'

const quick = process.argv.includes('--quick')
const journeys = [
  { flag: '--workbench', label: '提示词工作台（8 项）' },
  { flag: '--assets', label: '素材库（4 项）' },
  { flag: '--gallery', label: '图库筛选（3 项）' },
  { flag: '--tooltip', label: '提示气泡（4 项）' },
  { flag: '--comfy-persist', label: 'ComfyUI 持久化闭环（5 项）' },
  // The five M3 page audits are OPT-IN (`--m3`): each boots its own renderer, and running them after the
  // nine above saturates the machine — all five failed inside a full run while passing standalone minutes
  // earlier. A false red trains people to ignore red.
  ...(process.argv.includes('--m3') ? [
    { script: 'scripts/audit-cherry-routes.mjs', flag: '--api-gateway', label: 'M3 API 网关页' },
    { script: 'scripts/audit-cherry-routes.mjs', flag: '--websearch', label: 'M3 联网搜索页' },
    { script: 'scripts/audit-cherry-routes.mjs', flag: '--screenshot', label: 'M3 截图页' },
    { script: 'scripts/audit-cherry-routes.mjs', flag: '--browser', label: 'M3 浏览器页' },
    { script: 'scripts/audit-cherry-routes.mjs', flag: '--settings-wiring-journey', label: 'M3 常规页接线' },
  ] : []),
  { flag: '--style-contract', label: '样式契约（24 项）' },
  { flag: '--selection-popup', label: '划词助手浮窗（6 项）' },
  { flag: '--error-paths', label: '失败路径（ComfyUI 连接失败要可见）' },
  // Header chrome was never clicked by any journey. This opens the add-panel menu and closes it with Escape:
  // real clicks, zero persistent mutation.
  { flag: '--panel-menu', label: '面板头菜单（开/关，零副作用）' },
  // One boot, 51 source routes checked for rendered/contentVisible/routeMatched: cheap insurance that a page
  // did not silently regress to the "unimplemented" boundary.
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--routes-only', label: '51 条源路由全渲染' },
  // Proves the screenshot guard actually sees a change (it injects one and expects a red). A watchdog nobody
  // has watched fail is a watchdog nobody can trust.
  { flag: '--visual-matrix --diff --diff-selftest', label: '截图守护自检（必须检出注入的改动）' },
  { flag: '--slim-sweep --width=960', label: '被挤死控件扫描（960/1280/1600 均可跑）' },
  { flag: '--visual-matrix', label: '视觉矩阵 18 面板 × 3 宽度' },
  ...(quick ? [] : [
    { flag: '--narrow-audit --width=960', label: '窄面板审计（960）' },
    { flag: '--slim-sweep --width=1280', label: '被挤死控件扫描（1280）' },
    { flag: '--slim-sweep --width=1600', label: '被挤死控件扫描（1600）' },
  ]),
]

const results = []
const runOnce = journey => {
  const script = journey.script || 'scripts/ui-parity.mjs'
  const run = spawnSync(process.execPath, [script, ...journey.flag.split(' ')], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    timeout: 600000,
  })
  const output = (run.stdout || '') + (run.stderr || '')
  const headline = output.split('\n').find(line => /^(WORKBENCH|ASSETS|GALLERY|TOOLTIP|COMFY-PERSIST|STYLE-CONTRACT|ERROR-PATHS|SELECTION-POPUP|SLIM-SWEEP|MATRIX|NARROW|API|Web|Screenshot|Settings|Browser)/i.test(line)) || ''
  return { ok: run.status === 0, status: run.status, headline: headline.slice(0, 400) }
}

for (const journey of journeys) {
  process.stdout.write('· ' + journey.label + ' ... ')
  let attempt = runOnce(journey)
  // Eleven renderer boots in a row leave the machine busy enough that the last one can time out while
  // passing on its own. One retry, recorded — a silent retry would hide a real regression, a hard fail
  // would report load as a defect.
  let retried = false
  if (!attempt.ok) {
    retried = true
    attempt = runOnce(journey)
  }
  results.push({ flag: journey.flag, label: journey.label, ...attempt, retried })
  console.log(attempt.ok ? (retried ? 'PASS (retry)' : 'PASS') : 'FAIL')
}

const failed = results.filter(result => !result.ok)
for (const result of results) console.log((result.ok ? '  ok   ' : '  FAIL ') + result.label + (result.retried ? ' [retry]' : '') + '   ' + result.headline)
console.log(failed.length ? 'JOURNEYS FAILED: ' + failed.map(result => result.flag).join(', ') : 'ALL JOURNEYS PASSED')
process.exit(failed.length ? 1 : 0)
