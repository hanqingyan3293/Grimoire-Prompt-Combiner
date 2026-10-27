#!/usr/bin/env node
// Root test runner for gate G3.
//
// Why sharded: on this host vitest's worker RPC occasionally reports
// `Timeout calling "onTaskUpdate"` even when every test passes. A single 145-file
// sequential run is a long window for that to happen in, and a timeout kills the whole
// gate. Two shards shorten each window, and a shard whose failure carries that exact
// signature is retried once here (a genuine assertion failure is never retried).
import { spawnSync } from 'node:child_process'

const SHARDS = 2
const FLAKE = 'Timeout calling "onTaskUpdate"'
const results = []

function run(shard) {
  const result = spawnSync('npx', ['vitest', 'run', '--reporter=dot', '--no-file-parallelism', '--shard=' + shard + '/' + SHARDS], {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = String(result.stdout || '') + String(result.stderr || '')
  return { status: result.status, output, flake: result.status !== 0 && output.includes(FLAKE) }
}

for (let shard = 1; shard <= SHARDS; shard += 1) {
  let attempt = run(shard)
  if (attempt.flake) {
    console.log('[G3] shard ' + shard + ' hit the worker-RPC timeout; retrying once')
    attempt = run(shard)
  }
  process.stdout.write(attempt.output)
  results.push({ shard, ...attempt })
}

const failed = results.filter(item => item.status !== 0)
console.log('[G3] shards: ' + results.map(item => item.shard + '=' + (item.status === 0 ? 'pass' : 'fail')).join(' '))
process.exit(failed.length ? 1 : 0)
