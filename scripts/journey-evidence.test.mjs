import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { aggregateStatus, validateBatch, buildFingerprint, mergeJourneyRecord } from './journey-evidence.mjs'
test('duplicate and incomplete indexes never report passed', () => {
  assert.equal(aggregateStatus([{ index: 1, ok: true }, { index: 1, ok: true }], 2), 'blocked')
  assert.equal(aggregateStatus([{ index: 1, ok: true }], 2), 'blocked')
  assert.equal(aggregateStatus([{ index: 1, ok: true }, { index: 2, ok: true }], 2), 'passed')
  assert.equal(aggregateStatus([{ index: 1, ok: false }, { index: 1, ok: true }], 1), 'failed')
})
test('batch rejects invalid ranges and traversal ids', () => {
  assert.throws(() => validateBatch(0, 5, 'run', 25))
  assert.throws(() => validateBatch(24, 5, 'run', 25))
  assert.throws(() => validateBatch(1, 5, '../run', 25))
  validateBatch(1, 5, 'm5_run', 25)
})

test('build fingerprint hashes every compiled output, not size or mtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-fingerprint-'))
  try {
    fs.writeFileSync(path.join(dir, 'main.js'), 'main-a')
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'assets', 'chunk.js'), 'chunk-a')
    const first = buildFingerprint([path.join(dir, 'main.js'), path.join(dir, 'assets', 'chunk.js')])
    assert.equal(first.fileCount, 2)
    assert.match(first.combinedSha256, /^[a-f0-9]{64}$/)
    const sameSize = buildFingerprint([path.join(dir, 'main.js'), path.join(dir, 'assets', 'chunk.js')])
    assert.equal(sameSize.combinedSha256, first.combinedSha256)
    fs.writeFileSync(path.join(dir, 'assets', 'chunk.js'), 'chunk-b')
    const changed = buildFingerprint([path.join(dir, 'main.js'), path.join(dir, 'assets', 'chunk.js')])
    assert.notEqual(changed.combinedSha256, first.combinedSha256)
    const chunkBefore = first.files.find(file => file.path.endsWith('assets/chunk.js'))
    const chunkAfter = changed.files.find(file => file.path.endsWith('assets/chunk.js'))
    assert.notEqual(chunkAfter.sha256, chunkBefore.sha256)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('resumed attempts preserve prior failures and duplicates instead of replacing them', () => {
  const first = { index: 4, ok: false, status: 1, attempt: 1, startedAt: 'a', finishedAt: 'b', durationMs: 10 }
  const afterFirst = mergeJourneyRecord([], first)
  assert.equal(afterFirst[0].ok, false)
  assert.equal(afterFirst[0].attempts.length, 1)
  assert.equal(afterFirst[0].stickyFailed, true)

  const second = { index: 4, ok: true, status: 0, attempt: 2, startedAt: 'c', finishedAt: 'd', durationMs: 20 }
  const afterSecond = mergeJourneyRecord(afterFirst, second)
  assert.equal(afterSecond.length, 1, 'one deterministic record per journey index')
  assert.equal(afterSecond[0].ok, true)
  assert.equal(afterSecond[0].stickyFailed, true, 'a prior red attempt can never be hidden by a later green')
  assert.equal(afterSecond[0].attempts.length, 2)
  assert.equal(afterSecond[0].attempt, 2)
  assert.equal(afterSecond[0].retried, true)
  assert.equal(aggregateStatus(afterSecond, 1), 'failed', 'sticky red keeps the aggregate red')
})

test('partial batch with only some journey indexes is blocked, never passed', () => {
  assert.equal(aggregateStatus([{ index: 1, ok: true }, { index: 3, ok: true }], 3), 'blocked')
  assert.equal(aggregateStatus([], 3), 'blocked')
})
