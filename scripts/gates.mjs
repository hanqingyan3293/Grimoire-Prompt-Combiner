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

const root = process.cwd()
const argv = process.argv.slice(2)
const fast = argv.includes('--fast')
const only = (argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean)
const compatDir = path.join(root, 'src', 'vendor', 'cherry', 'compat')

const definitions = [
  { id: 'G1', title: '渲染层类型', cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'tsconfig.json'] },
  { id: 'G2', title: '主进程类型', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.node.json', '--noEmit'] },
  // `--no-file-parallelism`: this host's vitest worker RPC intermittently times out
  // ("onTaskUpdate") when many files run concurrently, even though every test passes.
  // Sequential costs ~2m40 instead of ~40s and removes that class of red run.
  { id: 'G3', title: '根测试', cmd: 'npx', args: ['vitest', 'run', '--reporter=dot', '--no-file-parallelism'], heavy: true },
  { id: 'G4', title: 'Cherry 适配层测试', cmd: 'npx', args: ['vitest', 'run', '--reporter=dot'], cwd: compatDir, heavy: true },
  { id: 'G5', title: 'Cherry 类型（自有=0 / 源码棘轮）', cmd: 'node', args: ['scripts/check-compat-types.mjs'] },
  { id: 'G6', title: '全量构建', cmd: 'npm', args: ['run', 'build'], heavy: true },
  { id: 'G7', title: '迁移矩阵格式', cmd: 'npm', args: ['run', 'check:migration-matrix'] },
  { id: 'G8', title: 'CSS 覆盖率', cmd: 'npm', args: ['run', 'check:cherry-css'] },
]

const selected = definitions.filter(d => (only.length ? only.includes(d.id) : true) && !(fast && d.heavy))
const results = []
const startedAll = Date.now()

function execute(gate) {
  const started = Date.now()
  const run = spawnSync(gate.cmd + ' ' + gate.args.map(a => (a.includes(' ') ? '"' + a + '"' : a)).join(' '), {
    cwd: gate.cwd || root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = (String(run.stdout || '') + String(run.stderr || '')).trim()
  return { exitCode: run.status, output, tail: output.split(/\r?\n/).filter(Boolean).slice(-8), durationMs: Date.now() - started }
}

// Vitest 3.2.7 on this Windows host intermittently reports a worker RPC timeout
// ("Timeout calling onTaskUpdate") while every test file passed. Re-running once is
// honest as long as the retry is recorded and a genuine test failure never retries.
function isWorkerRpcFlake(result) {
  if (result.exitCode === 0) return false
  // The signature is the worker RPC timeout. A run where a test file is ALSO marked failed
  // still retries: if the failure is real, the retry fails the same way and the gate stays
  // red with attempts=2 recorded, so nothing is hidden — but a crash-only run recovers.
  return /Timeout calling "onTaskUpdate"/.test(result.output)
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
  })
  console.log((ok ? 'PASS' : 'FAIL') + (attempts > 1 ? ' (attempt ' + attempts + ')' : '') + ' (' + (result.durationMs / 1000).toFixed(1) + 's)')
  if (!ok) for (const line of result.tail) console.log('   ' + line)
}

const summary = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAll,
  selected: selected.map(g => g.id),
  failed: results.filter(r => !r.ok).map(r => r.id),
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
process.exit(summary.failed.length ? 1 : 0)
