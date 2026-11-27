#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = process.cwd()
const arg = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3)
const runId = arg('run-id')
if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
  console.error('journeys-retry requires --run-id=<id>')
  process.exit(2)
}
const aggregatePath = path.join(root, 'artifacts/m5', 'journeys-' + runId + '.json')
if (!fs.existsSync(aggregatePath)) {
  console.error('missing journey aggregate: ' + path.relative(root, aggregatePath))
  process.exit(2)
}
const aggregate = JSON.parse(fs.readFileSync(aggregatePath, 'utf8'))
const pending = (aggregate.results || []).filter(result => result.ok !== true).map(result => result.index).sort((a, b) => a - b)
for (const index of pending) {
  console.log('[JOURNEYS-RETRY] rerunning index ' + index + ' after a budget-exhausted or missing attempt')
  const run = spawnSync(process.execPath, ['scripts/journeys.mjs', '--from=' + index, '--count=1', '--run-id=' + runId, '--batch-budget-ms=600000'], { cwd: root, encoding: 'utf8', timeout: 620000, env: process.env })
  process.stdout.write(run.stdout || '')
  process.stderr.write(run.stderr || '')
  if (run.status !== 0) process.exit(run.status || 1)
}
const final = spawnSync(process.execPath, ['scripts/journeys.mjs', '--aggregate-only', '--run-id=' + runId], { cwd: root, encoding: 'utf8', timeout: 120000, env: process.env })
process.stdout.write(final.stdout || '')
process.stderr.write(final.stderr || '')
process.exit(final.status || 0)

