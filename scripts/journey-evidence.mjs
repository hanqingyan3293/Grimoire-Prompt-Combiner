import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export function validateBatch(from, count, runId, total) {
  if (!Number.isInteger(from) || !Number.isInteger(count) || from < 1 || count < 1 || from + count - 1 > total) throw new Error('Invalid journey range')
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid run id')
}
export function aggregateStatus(results, expected, options = {}) {
  const indexes = new Set(results.map(result => result.index))
  if (options.buildSha && results.some(result => (Array.isArray(result.attempts) ? result.attempts : []).some(attempt => attempt.buildSha256 !== options.buildSha))) return 'failed'
  // A prior red attempt is sticky: a later green attempt must not hide it.
  const hardFailure = result => {
    if (Array.isArray(result.attempts) && result.attempts.length > 0) return result.attempts.some(attempt => !attempt.ok && attempt.budgetExhausted !== true)
    return result.ok !== true && result.budgetExhausted !== true
  }
  if (results.some(hardFailure)) return 'failed'
  // A budget-exhausted attempt is a real non-execution, not a failed assertion. It stays in
  // the attempt history but a later bounded run may complete it.
  if (results.some(result => !result.ok)) return 'blocked'
  if (indexes.size !== results.length || indexes.size !== expected || Array.from({ length: expected }, (_, i) => i + 1).some(index => !indexes.has(index))) return 'blocked'
  return 'passed'
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/**
 * Hash every compiled output with SHA-256. Size+mtime is not a build identity:
 * a same-size rebuild changes bytes. The combined digest is order-independent
 * because the file list is sorted and relativized to the root directory.
 */
export function buildFingerprint(paths, options = {}) {
  const root = options.root || process.cwd()
  const unique = [...new Set(paths.map(file => path.resolve(file)))].sort()
  const files = unique.map(file => {
    const bytes = fs.readFileSync(file)
    return { path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: sha256(bytes), bytes: bytes.length }
  })
  const combinedSha256 = sha256(Buffer.from(files.map(file => file.path + ':' + file.sha256).join('\n')))
  return { algorithm: 'sha256', combinedSha256, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files }
}

function normalizeAttempt(record) {
  return {
    attempt: Number(record.attempt || 0),
    ok: record.ok === true,
    status: record.status ?? null,
    exitCode: record.exitCode ?? record.status ?? null,
    buildSha256: record.buildSha256 ?? null,
    stdoutSha256: record.stdoutSha256 ?? null,
    budgetExhausted: record.budgetExhausted === true,
    timedOut: record.timedOut === true,
    signal: record.signal ?? null,
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? null,
    durationMs: record.durationMs ?? null,
    headline: record.headline ?? null,
    stdoutArtifact: record.stdoutArtifact ?? null,
    stderrArtifact: record.stderrArtifact ?? null
  }
}

/**
 * Deterministic merge for resumed batches. Existing attempts are retained even
 * when the index was previously red; duplicates become attempt history instead
 * of replacing the prior record. The result can never be reported green when
 * any attempt in its history failed.
 */
export function mergeJourneyRecord(results, record) {
  const existing = results.find(result => result.index === record.index)
  const prior = existing ? (Array.isArray(existing.attempts) ? existing.attempts : [normalizeAttempt(existing)]) : []
  const current = normalizeAttempt(record)
  current.attempt = Math.max(prior.length + 1, current.attempt)
  const attempts = [...prior, current]
  const merged = {
    ...existing,
    ...record,
    attempt: attempts.length,
    retried: attempts.length > 1,
    attempts,
    stickyFailed: attempts.some(attempt => !attempt.ok && attempt.budgetExhausted !== true)
  }
  const next = existing ? results.map(result => result.index === record.index ? merged : result) : [...results, merged]
  return next.sort((a, b) => a.index - b.index)
}
