#!/usr/bin/env node
// One command for the automated gates. Every run writes a JSON snapshot so a "green"
// claim can be checked against a timestamped record instead of a memory of one.
//
//   node scripts/gates.mjs                 # G1..G8 (heavy: tests + build)
//   node scripts/gates.mjs --fast          # skip G3/G4/G6 (tests + build)
//   node scripts/gates.mjs --only=G1,G2,G5 # run a subset
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { buildFingerprint } from './journey-evidence.mjs'

const root = process.cwd()
const argv = process.argv.slice(2)
const fast = argv.includes('--fast')
const only = (argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean)
const compatDir = path.join(root, 'src', 'vendor', 'cherry', 'compat')
const expectedIds = Array.from({ length: 14 }, (_, index) => 'G' + (index + 1))
const sha256 = value => createHash('sha256').update(String(value)).digest('hex')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const logDir = path.join(root, 'artifacts', 'gates-logs-' + stamp)
fs.mkdirSync(logDir, { recursive: true })
const rel = file => path.relative(root, file).replaceAll(path.sep, '/')
const compiledOutputs = () => {
  const paths = []
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else paths.push(file)
    }
  }
  walk(path.join(root, 'dist'))
  const shell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
  if (fs.existsSync(shell)) paths.push(shell)
  return paths
}

const definitions = [
  { id: 'G1', title: '渲染层类型', cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'tsconfig.json'] },
  { id: 'G2', title: '主进程类型', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.node.json', '--noEmit'] },
  // Root tests run through a sharded wrapper: this host's vitest worker RPC intermittently
  // times out ("onTaskUpdate") even when every test passes, and one long sequential run is a
  // long window for that. The wrapper retries a shard only when that exact signature appears.
  { id: 'G3', title: '根测试', cmd: 'node', args: ['scripts/test-root-sharded.mjs'], heavy: true },
  { id: 'G4', title: 'Cherry 适配层测试', cmd: 'npx', args: ['vitest', 'run', '--reporter=dot'], cwd: compatDir, heavy: true },
  { id: 'G5', title: 'Cherry 类型（自有=0 / 源码棘轮）', cmd: 'node', args: ['scripts/check-compat-types.mjs'] },
  { id: 'G6', title: '全量构建', cmd: 'npm', args: ['run', 'build'], heavy: true },
  { id: 'G7', title: '迁移矩阵格式', cmd: 'npm', args: ['run', 'check:migration-matrix'] },
  { id: 'G8', title: 'CSS 覆盖率', cmd: 'npm', args: ['run', 'check:cherry-css'] },
  { id: 'G9', title: '面板布局约定', cmd: 'node', args: ['scripts/check-panel-layout.mjs'] },
  { id: 'G10', title: '路由覆盖', cmd: 'node', args: ['scripts/check-route-coverage.mjs'] },
  // G11 boots the real renderer, so it needs the built main bundle; it runs after G6 for that reason.
  { id: 'G14', title: '台账证据路径可解析', cmd: 'node', args: ['scripts/check-evidence-paths.mjs'] },
  { id: 'G13', title: 'IPC 双端接线', cmd: 'node', args: ['scripts/check-ipc-coverage.mjs'] },
  { id: 'G12', title: '空 catch 棘轮', cmd: 'node', args: ['scripts/check-silent-catches.mjs'] },
  { id: 'G11', title: '样式契约（真实渲染器实测）', cmd: 'node', args: ['scripts/ui-parity.mjs', '--style-contract'], env: { ELECTRON_RUN_AS_NODE: '' } },
]

const selected = definitions.filter(d => (only.length ? only.includes(d.id) : true) && !(fast && d.heavy))
const results = []
const startedAll = Date.now()
const buildBefore = buildFingerprint(compiledOutputs(), { root })

function execute(gate) {
  const started = Date.now()
  const startedAt = new Date().toISOString()
  const run = spawnSync(gate.cmd + ' ' + gate.args.map(a => (a.includes(' ') ? '"' + a + '"' : a)).join(' '), {
    cwd: gate.cwd || root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...gate.env },
  })
  const stdout = String(run.stdout || '')
  const stderr = String(run.stderr || '')
  const output = (stdout + stderr).trim()
  // Keep the lines that NAME a failure, not just the last eight: a sharded suite ends with a shard summary,
  // and eight lines of summary hid which test failed twice in a row (the run had to be repeated by hand).
  const lines = output.split(/\r?\n/).filter(Boolean)
  const failureLines = lines.filter(line => /FAIL|✗|✕|AssertionError|Error:|Expected|Received|→/.test(line)).slice(-24)
  const stdoutArtifact = path.join(logDir, gate.id + '.stdout.log')
  const stderrArtifact = path.join(logDir, gate.id + '.stderr.log')
  const combinedArtifact = path.join(logDir, gate.id + '.combined.log')
  fs.writeFileSync(stdoutArtifact, stdout)
  fs.writeFileSync(stderrArtifact, stderr)
  fs.writeFileSync(combinedArtifact, stdout + stderr)
  return {
    exitCode: run.status,
    output,
    tail: [...new Set([...failureLines, ...lines.slice(-8)])].slice(-32),
    durationMs: Date.now() - started,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutArtifact: rel(stdoutArtifact),
    stderrArtifact: rel(stderrArtifact),
    logArtifact: rel(stdoutArtifact),
    combinedArtifact: rel(combinedArtifact),
  }
}

// Vitest 3.2.7 on this Windows host intermittently reports a worker RPC timeout
// ("Timeout calling onTaskUpdate") while every test file passed. Re-running once is
// honest as long as the retry is recorded and a genuine test failure never retries.
function isWorkerRpcFlake(result) {
  if (result.exitCode === 0) return false
  // The signature is the worker RPC timeout. A run where a test file is ALSO marked failed
  // still retries: if the failure is real, the retry fails the same way and the gate stays
  // red with attempts=2 recorded, so nothing is hidden — but a crash-only run recovers.
  return /Timeout calling "onTaskUpdate"/.test(result.output) && !/FAIL |AssertionError|\d+ failed/.test(result.output)
}

for (const gate of selected) {
  process.stdout.write('[' + gate.id + '] ' + gate.title + ' … ')
  let result = execute(gate)
  let attempts = 1
  if (isWorkerRpcFlake(result)) {
    process.stdout.write('worker-rpc flake, retrying … ')
    result = execute(gate)
    attempts = 2
  }
  const ok = result.exitCode === 0
  results.push({
    id: gate.id, title: gate.title,
    command: [gate.cmd, ...gate.args].join(' '),
    cwd: gate.cwd ? path.relative(root, gate.cwd) : '.',
    exitCode: result.exitCode, ok, attempts, durationMs: result.durationMs, tail: result.tail,
    startedAt: result.startedAt, finishedAt: result.finishedAt,
    stdoutSha256: result.stdoutSha256, stderrSha256: result.stderrSha256,
    stdoutArtifact: result.stdoutArtifact, stderrArtifact: result.stderrArtifact, logArtifact: result.logArtifact, combinedArtifact: result.combinedArtifact,
  })
  console.log((ok ? 'PASS' : 'FAIL') + (attempts > 1 ? ' (attempt ' + attempts + ')' : '') + ' (' + (result.durationMs / 1000).toFixed(1) + 's)')
  if (!ok) for (const line of result.tail) console.log('   ' + line)
}

const buildAfter = buildFingerprint(compiledOutputs(), { root })
const buildStable = buildBefore.combinedSha256 === buildAfter.combinedSha256 && buildBefore.fileCount === buildAfter.fileCount && buildBefore.totalBytes === buildAfter.totalBytes
const ids = results.map(item => item.id)
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
const missingIds = expectedIds.filter(id => !ids.includes(id))
const extraIds = ids.filter(id => !expectedIds.includes(id))
const fullRequested = !fast && only.length === 0
const complete = fullRequested && missingIds.length === 0 && extraIds.length === 0 && duplicateIds.length === 0
const failed = results.filter(item => !item.ok).map(item => item.id)
if (!buildStable) failed.push('BUILD-STABLE')
if (results.length === 0) failed.push('GATE-SET-EMPTY')
if (fullRequested && (missingIds.length || extraIds.length || duplicateIds.length)) failed.push('GATE-SET')
const summary = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAll,
  selected: selected.map(g => g.id),
  expectedIds,
  complete,
  missingIds,
  extraIds,
  duplicateIds,
  buildBefore,
  buildAfter,
  buildStable,
  logDirectory: rel(logDir),
  failed,
  results,
}
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
const out = path.join(root, 'artifacts', 'gates-' + summary.generatedAt.replace(/[:.]/g, '-') + '.json')
fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n')

console.log('')
for (const r of results) console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.id + '  ' + r.title + '  ' + ((r.durationMs / 1000).toFixed(1)) + 's')
console.log('')
console.log(summary.failed.length ? 'GATES FAILED: ' + summary.failed.join(', ') : 'ALL SELECTED GATES PASSED')
console.log('snapshot: ' + path.relative(root, out))
console.log('raw logs: ' + path.relative(root, logDir))
process.exit(summary.failed.length ? 1 : 0)
