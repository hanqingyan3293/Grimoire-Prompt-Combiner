#!/usr/bin/env node
// Journey suite: one command for the end-to-end evidence (ui-parity.mjs journeys + audit journeys).
//
// These are NOT part of the default gate set: each one boots the real Electron renderer, so the whole suite
// takes several minutes and is meant for after a batch of UI changes or before handing work over. Run with
// `--quick` to skip the two widest matrix runs.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { aggregateStatus, validateBatch, buildFingerprint, mergeJourneyRecord } from './journey-evidence.mjs'

const quick = process.argv.includes('--quick')
const journeys = [
  { flag: '--workbench', label: '提示词工作台（8 项）' },
  { flag: '--assets', label: '素材库（4 项）' },
  { flag: '--gallery', label: '图库筛选（3 项）' },
  { flag: '--tooltip', label: '提示气泡（4 项）' },
  { flag: '--comfy-persist', label: 'ComfyUI 持久化闭环（5 项）' },
  // Runs EARLY: it boots its own renderer, and at the end of the suite the machine is saturated enough that it
  // failed twice in a row on 2026-11-01 while passing standalone.
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--routes-only', label: '51 条源路由全渲染' },
  // The five M3 page audits used to be opt-in (`--m3`) because they all failed inside a full run while passing
  // standalone. That diagnosis was wrong: the journeys runner exported ELECTRON_RUN_AS_NODE='' to every child,
  // and an audit that spawns its own electron then starts as Node with no window (NO_TARGET). With the variable
  // deleted for script-bearing journeys they belong in the default suite.
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--api-gateway', label: 'M3 API 网关页' },
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--websearch', label: 'M3 联网搜索页' },
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--screenshot', label: 'M3 截图页' },
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--browser', label: 'M3 浏览器页' },
  { script: 'scripts/audit-cherry-routes.mjs', flag: '--settings-wiring-journey', label: 'M3 常规页接线' },
  { flag: '--style-contract', label: '样式契约（24 项）' },
  { flag: '--selection-popup', label: '划词助手浮窗（6 项）' },
  { flag: '--error-paths', label: '失败路径（ComfyUI 连接失败要可见）' },
  // Header chrome was never clicked by any journey. This opens the add-panel menu and closes it with Escape:
  // real clicks, zero persistent mutation.
  { flag: '--panel-menu', label: '面板头菜单（开/关，零副作用）' },
  { flag: '--panel-maximize', label: '面板最大化/还原（可逆）' },
  { flag: '--layout-menu', label: '布局管理菜单（开/关，零副作用）' },
  { flag: '--settings-toggle', label: '设置项真的落库并生效（五项，自动还原）' },
  // Clicks the first SAFE body button in every panel: the matrix only proves they render.
  { flag: '--panel-smoke', label: '18 面板交互冒烟（点体内首个安全按钮）' },
  // One boot, 51 source routes checked for rendered/contentVisible/routeMatched: cheap insurance that a page
  // did not silently regress to the "unimplemented" boundary.
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

const artifactDir = path.join(process.cwd(), 'artifacts/m5')
fs.mkdirSync(artifactDir, { recursive: true })
const stamp = process.argv.find(arg => arg.startsWith('--run-id='))?.slice(9) || new Date().toISOString().replace(/[:.]/g, '-')
const from = Number(process.argv.find(arg => arg.startsWith('--from='))?.slice(7) || 1)
const count = Number(process.argv.find(arg => arg.startsWith('--count='))?.slice(8) || journeys.length)
validateBatch(from, count, stamp, journeys.length)
const aggregateOnly = process.argv.includes('--aggregate-only')
const fromAggregate = process.argv.find(arg => arg.startsWith('--from-aggregate='))?.slice('--from-aggregate='.length)
const batchBudgetMs = Number(process.argv.find(arg => arg.startsWith('--batch-budget-ms='))?.slice('--batch-budget-ms='.length) || 0)

function compiledOutputs() {
  const paths = []
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else paths.push(file)
    }
  }
  walk(path.join(process.cwd(), 'dist'))
  for (const extra of ['src/vendor/cherry/compat/dist-source-shell/source-shell.html']) {
    const file = path.join(process.cwd(), extra)
    if (fs.existsSync(file)) paths.push(file)
  }
  return paths
}
// SHA-256 over every compiled output (not size+mtime). This is the identity
// that binds the aggregate to the exact build that produced the journey logs.
const build = buildFingerprint(compiledOutputs(), { root: process.cwd() })
const aggregatePath = path.join(artifactDir, `journeys-${stamp}.json`)
let sourceAggregate = null
let results = []
let batchTimedOut = false
const batchStarted = Date.now()
if (fromAggregate) {
  const absolute = path.resolve(process.cwd(), fromAggregate)
  const bytes = fs.readFileSync(absolute)
  const imported = JSON.parse(bytes.toString('utf8'))
  if (imported.expected !== journeys.length) throw new Error('Imported aggregate has a different journey count')
  if (imported.build?.combinedSha256 !== build.combinedSha256 || imported.build?.fileCount !== build.fileCount) throw new Error('Imported aggregate belongs to a different build; stale journey inheritance is rejected')
  if ((imported.results || []).some(record => (record.attempts || []).some(attempt => attempt.buildSha256 !== build.combinedSha256))) throw new Error('Imported aggregate contains attempts that are not bound to the current build')
  sourceAggregate = { path: path.relative(process.cwd(), absolute).replaceAll(path.sep, '/'), sha256: createHash('sha256').update(bytes).digest('hex'), status: imported.status ?? null, runId: imported.runId ?? null }
  results = (imported.results || []).reduce((acc, record) => mergeJourneyRecord(acc, record), [])
} else {
  const prior = fs.existsSync(aggregatePath) ? JSON.parse(fs.readFileSync(aggregatePath, 'utf8')) : { results: [] }
  if (prior.build?.combinedSha256 && prior.build.combinedSha256 !== build.combinedSha256) throw new Error('Build artifacts changed within journey run')
  results = (prior.results || []).reduce((acc, record) => mergeJourneyRecord(acc, record), [])
}
function flush() {
  const failed = results.filter(result => (!result.ok && !result.budgetExhausted) || result.stickyFailed || (result.attempts || []).some(attempt => !attempt.ok && attempt.budgetExhausted !== true))
  const aggregate = { schemaVersion: 2, generatedAt: new Date().toISOString(), runId: stamp, expected: journeys.length, status: aggregateStatus(results, journeys.length, { buildSha: build.combinedSha256 }), total: results.length, failedIndexes: failed.map(result => result.index), failed: failed.map(result => result.flag), build, sourceAggregate, batch: aggregateOnly ? null : { from, count, batchBudgetMs: batchBudgetMs || null, timedOut: batchTimedOut }, results }
  fs.writeFileSync(aggregatePath, JSON.stringify(aggregate, null, 2) + String.fromCharCode(10))
  fs.writeFileSync(path.join(artifactDir, 'journeys-latest.json'), JSON.stringify(aggregate, null, 2) + String.fromCharCode(10))
  return aggregate
}
if (!aggregateOnly) flush()
const runOnce = (journey, timeoutMs = 600000) => {
  const script = journey.script || 'scripts/ui-parity.mjs'
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const run = spawnSync(process.execPath, [script, ...journey.flag.split(' ')], {
    encoding: 'utf8',
    // ELECTRON_RUN_AS_NODE='' (empty string) is enough for ui-parity, but the audit script spawns its OWN
    // electron and an empty value makes that child run as Node — no window, so `NO_TARGET`. Delete the
    // variable for journeys that bring their own script instead of clearing it.
    env: journey.script ? (() => { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; return env })() : { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    timeout: timeoutMs,
  })
  const output = (run.stdout || '') + (run.stderr || '')
  const headline = output.split('\n').find(line => /^(WORKBENCH|ASSETS|GALLERY|TOOLTIP|COMFY-PERSIST|STYLE-CONTRACT|ERROR-PATHS|SELECTION-POPUP|SLIM-SWEEP|MATRIX|NARROW|API|Web|Screenshot|Settings|Browser)/i.test(line)) || ''
  const budgetExhausted = timeoutMs < 600000 && (run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGTERM' || run.status === null)
  return { ok: run.status === 0, status: run.status, exitCode: run.status, signal: run.signal || null, budgetExhausted, timedOut: budgetExhausted, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, headline: headline.slice(0, 400), stdout: run.stdout || '', stderr: run.stderr || '' }
}

for (const journey of aggregateOnly ? [] : journeys.slice(from - 1, from - 1 + count)) {
  const remaining = batchBudgetMs ? batchBudgetMs - (Date.now() - batchStarted) : 600000
  if (remaining <= 0) { batchTimedOut = true; break }
  process.stdout.write('· ' + journey.label + ' ... ')
  const attempt = runOnce(journey, Math.min(600000, remaining))
  // Genuine failures are never retried into green. Each run retains the only attempt.
  const index = journeys.indexOf(journey) + 1
  const attemptNumber = (results.find(result => result.index === index)?.attempts?.length || 0) + 1
  const stdoutArtifact = path.join(artifactDir, `journey-${stamp}-${index}-attempt-${attemptNumber}.stdout.log`)
  const stderrArtifact = path.join(artifactDir, `journey-${stamp}-${index}-attempt-${attemptNumber}.stderr.log`)
  fs.writeFileSync(stdoutArtifact, attempt.stdout)
  fs.writeFileSync(stderrArtifact, attempt.stderr)
  const { stdout, stderr, ...evidence } = attempt
  const record = { index, attempt: attemptNumber, flag: journey.flag, label: journey.label, ...evidence, buildSha256: build.combinedSha256, stdoutSha256: createHash('sha256').update(stdout).digest('hex'), stdoutArtifact: path.relative(process.cwd(), stdoutArtifact), stderrArtifact: path.relative(process.cwd(), stderrArtifact) }
  results = mergeJourneyRecord(results, record)
  flush()
  console.log(attempt.ok ? 'PASS' : 'FAIL')
}

const final = flush()
console.log(JSON.stringify({ runId: stamp, recorded: results.length, expected: journeys.length, status: final.status, failed: final.failed, build: final.build.combinedSha256, sourceAggregate: final.sourceAggregate, batchTimedOut }))
// A completed bounded batch with an incomplete aggregate is progress, not a product failure.
// The final aggregate gate decides 25/25. Exit 1 only when a real journey attempt failed.
process.exitCode = final.failed.length > 0 || final.status === 'failed' ? 1 : batchTimedOut ? 2 : 0
process.exit(process.exitCode)
