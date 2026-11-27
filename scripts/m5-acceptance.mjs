#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = process.cwd()
const outDir = path.join(root, 'artifacts/m5')
fs.mkdirSync(outDir, { recursive: true })
const args = process.argv.slice(2)
const full = args.includes('--full')
const roots = Number(args.find(v => v.startsWith('--root-runs='))?.split('=')[1] || (full ? 3 : 1))
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
const runsDir = path.join(outDir, runId)
fs.mkdirSync(runsDir, { recursive: true })
const journeyRunId = 'm5-' + runId
const steps = [
  { id: 'G1-G14', command: ['node', 'scripts/gates.mjs'], timeoutMs: 900000 },
  { id: 'ROOT-3X', commandFor: index => ['node', 'scripts/test-root-sharded.mjs', '--meta=' + path.join(runsDir, 'root-3x-' + index + '.meta.json'), '--attempt=' + index, '--stdout-log=' + path.join(runsDir, 'root-3x-' + index + '.stdout.log'), '--stderr-log=' + path.join(runsDir, 'root-3x-' + index + '.stderr.log')], repeat: roots, timeoutMs: 600000 },
  ...[1, 2, 3, 4, 5].map(batch => ({ id: 'JOURNEYS-' + batch, command: ['node', 'scripts/journeys.mjs', '--from=' + ((batch - 1) * 5 + 1), '--count=5', '--run-id=' + journeyRunId, '--batch-budget-ms=600000'], timeoutMs: 620000 })),
  { id: 'JOURNEYS-RETRY', command: ['node', 'scripts/journeys-retry.mjs', '--run-id=' + journeyRunId], timeoutMs: 3600000 },
  { id: 'PACK-LICENSE-PREFLIGHT', command: ['node', 'scripts/m5-pack.mjs'], timeoutMs: 120000 },
  ...(full ? [{ id: 'PACK', command: ['node', 'scripts/m5-pack.mjs', '--pack', '--require-pack'] }] : []),
  ...(full ? [{ id: 'PACKAGED-GUI', command: ['node', 'scripts/m5-packaged-gui.mjs'], timeoutMs: 120000 }] : []),
  { id: 'SECRETS', command: ['node', 'scripts/check-secrets.mjs'], timeoutMs: 120000 },
  { id: 'BUILD-B', command: ['npm', 'run', 'build:cherry-source-shell'], timeoutMs: 600000 },
  { id: 'SMOKE-B', command: ['npm', 'run', 'smoke:cherry-source-shell'], timeoutMs: 120000 },
  { id: 'A-B-COMPARE', command: ['node', 'scripts/m5-ab.mjs'], timeoutMs: 120000 },
  { id: 'CAPTURE-EVIDENCE-AUDIT', command: ['node', 'scripts/m5-index.mjs', '--audit-only'], timeoutMs: 120000 },
  { id: 'FINAL-AGGREGATE', command: ['node', 'scripts/m5-final-aggregate.mjs'], timeoutMs: 120000 },
]
const results = []
for (const step of steps) {
  for (let index = 1; index <= (step.repeat || 1); index++) {
    const startedAt = new Date().toISOString()
    const start = Date.now()
    const command = step.commandFor ? step.commandFor(index) : step.command
    const run = spawnSync(command[0], command.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', timeout: step.timeoutMs || 600000 })
    const durationMs = Date.now() - start
    const stdout = run.stdout || ''
    const stderr = run.stderr || ''
    const stdoutPath = path.join(runsDir, `${step.id.toLowerCase()}-${index}.stdout.log`)
    const stderrPath = path.join(runsDir, `${step.id.toLowerCase()}-${index}.stderr.log`)
    fs.writeFileSync(stdoutPath, stdout)
    fs.writeFileSync(stderrPath, stderr)
    const status = run.status === 0 ? 'passed' : run.status === null ? 'blocked' : 'failed'
    results.push({ id: step.id, attempt: index, startedAt, endedAt: new Date().toISOString(), durationMs, command: command.join(' '), exitCode: run.status, signal: run.signal || null, status, stdoutArtifact: path.relative(root, stdoutPath).replaceAll(path.sep, '/'), stderrArtifact: path.relative(root, stderrPath).replaceAll(path.sep, '/'), stdout, stderr })
    fs.writeFileSync(path.join(runsDir, 'acceptance.json'), JSON.stringify({ runId, status: 'in-progress', results, completedCommands: results.length }, null, 2) + String.fromCharCode(10))
    if (run.status !== 0) break
  }
  if (results.slice(-(step.repeat || 1)).some(result => result.status !== 'passed')) break
}
const report = { schemaVersion: 1, runId, generatedAt: new Date().toISOString(), full, requiredRootSuccessRuns: roots, status: results.every(result => result.status === 'passed') && results.length === steps.reduce((count, step) => count + (step.repeat || 1), 0) ? 'passed' : results.some(result => result.status === 'failed') ? 'failed' : 'blocked', steps: results.map(({ stdout, stderr, ...result }) => result), results }
const reportPath = path.join(runsDir, 'acceptance.json')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + String.fromCharCode(10))
console.log(JSON.stringify({ status: report.status, report: path.relative(root, reportPath), results: results.map(({ id, attempt, status, exitCode, durationMs }) => ({ id, attempt, status, exitCode, durationMs })) }, null, 2))
process.exitCode = report.status === 'passed' ? 0 : 1
