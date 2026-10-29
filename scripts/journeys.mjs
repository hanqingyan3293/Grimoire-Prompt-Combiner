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
  { flag: '--style-contract', label: '样式契约（24 项）' },
  { flag: '--selection-popup', label: '划词助手浮窗（6 项）' },
  { flag: '--slim-sweep --width=960', label: '被挤死控件扫描（960/1280/1600 均可跑）' },
  { flag: '--visual-matrix', label: '视觉矩阵 18 面板 × 3 宽度' },
  ...(quick ? [] : [{ flag: '--narrow-audit --width=960', label: '窄面板审计（960）' }]),
]

const results = []
for (const journey of journeys) {
  process.stdout.write('· ' + journey.label + ' ... ')
  const run = spawnSync(process.execPath, ['scripts/ui-parity.mjs', ...journey.flag.split(' ')], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    timeout: 600000,
  })
  const ok = run.status === 0
  const output = (run.stdout || '') + (run.stderr || '')
  const headline = output.split('\n').find(line => /^(WORKBENCH|ASSETS|GALLERY|TOOLTIP|COMFY-PERSIST|STYLE-CONTRACT|SELECTION-POPUP|SLIM-SWEEP|MATRIX|NARROW)/.test(line)) || ''
  results.push({ flag: journey.flag, label: journey.label, ok, status: run.status, headline: headline.slice(0, 400) })
  console.log(ok ? 'PASS' : 'FAIL')
}

const failed = results.filter(result => !result.ok)
for (const result of results) console.log((result.ok ? '  ok   ' : '  FAIL ') + result.label + '   ' + result.headline)
console.log(failed.length ? 'JOURNEYS FAILED: ' + failed.map(result => result.flag).join(', ') : 'ALL JOURNEYS PASSED')
process.exit(failed.length ? 1 : 0)
