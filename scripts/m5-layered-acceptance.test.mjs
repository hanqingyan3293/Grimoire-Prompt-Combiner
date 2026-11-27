import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAYERED_ACCEPTANCE_PATH,
  LAYERED_ACCEPTANCE_STATUS,
  evaluateLayeredDeliveryAcceptance,
} from './m5-layered-acceptance.mjs'

const build = {
  combinedSha256: 'a'.repeat(64),
  fileCount: 3672,
  distSha256: 'b'.repeat(64),
  sourceShellSha256: 'c'.repeat(64),
  sourceShellDistDigest: 'd'.repeat(64),
}
const featureManifest = { path: '.agent/MIGRATION_MATRIX.md', sha256: 'e'.repeat(64), unfinishedCount: 53 }
const surface = { total: 79, surfaceCaptured: 65, pending: 14, featureVerified: 0 }
const recordSha256 = 'f'.repeat(64)

function baseRecord() {
  return {
    schemaVersion: 1,
    kind: 'layered-delivery-acceptance',
    scope: 'layered-delivery',
    decision: 'accepted',
    userChoice: '接受当前分层交付',
    questionId: 'layered-delivery-acceptance',
    questionIdSource: 'stable logical id; the originating UI question id was not present in the available session context',
    optionLabel: '接受当前分层交付',
    scopeDescription: 'Accept automated gates, 65 surface captures, and the disclosed blocker inventory; pending rows and blocked capabilities remain unimplemented.',
    observedDate: '2026-11-05',
    exactConfirmationTime: null,
    acceptedScope: {
      automatedAcceptance: { gates: 'G1-G14', automatedItems: 10, status: 'automated-passed' },
      surfaceCaptures: { captured: 65, total: 79, pending: 14, featureVerified: 0 },
      blockerInventory: { disclosed: true, unfinishedMatrixRows: 53 },
    },
    exclusions: {
      pendingSurfaceRows: { count: 14, manualAcceptance: 'pending' },
      unfinishedMatrixRows: { count: 53, implemented: false, userAcceptance: 'pending' },
      blockedCapabilities: { implemented: false, blockedAcceptance: 'pending' },
    },
    gapDispositionAcceptance: 'inventory-acknowledged',
    itemAcceptance: { surfaceRows: 'pending', blockedRows: 'pending' },
    fullPlanComplete: false,
    binding: {
      build: { ...build },
      featureManifest: { ...featureManifest },
    },
  }
}

function evaluate(record, overrides = {}) {
  return evaluateLayeredDeliveryAcceptance({
    record,
    recordPath: LAYERED_ACCEPTANCE_PATH,
    recordSha256,
    build,
    featureManifest,
    surface,
    expectedUnfinished: 53,
    ...overrides,
  })
}

test('a build- and manifest-bound layered scope is accepted without completing the plan', () => {
  const result = evaluate(baseRecord())
  assert.equal(result.accepted, true)
  assert.equal(result.status, LAYERED_ACCEPTANCE_STATUS)
  assert.equal(result.status, 'automated-passed-layered-accepted-manual-pending')
  assert.equal(result.manualAcceptance, 'pending')
  assert.equal(result.blockedAcceptance, 'pending')
  assert.equal(result.gapDispositionAcceptance, 'inventory-acknowledged')
  assert.equal(result.buildBound, true)
  assert.equal(result.record, LAYERED_ACCEPTANCE_PATH)
  assert.equal(result.recordSha256, recordSha256)
  assert.equal(result.fullPlanComplete, false)
  assert.deepEqual(result.itemAcceptance, { surfaceRows: 'pending', blockedRows: 'pending' })
})

test('scoped acceptance never turns per-row captures or blockers into accepted items', () => {
  const surfaceRows = Array.from({ length: 79 }, (_, index) => ({
    sequence: index + 1,
    manualAcceptance: 'pending',
    featureAccepted: false,
  }))
  const blockedRows = Array.from({ length: 53 }, (_, index) => ({
    feature: 'matrix-row-' + (index + 1),
    status: 'BLOCKED',
    blockedAcceptance: 'pending',
  }))
  const result = evaluate(baseRecord(), { surfaceRows, blockedRows })
  assert.equal(result.accepted, true)
  assert.equal(result.perItemAcceptanceApplied, false)
  assert.deepEqual(result.itemAcceptance, { surfaceRows: 'pending', blockedRows: 'pending' })
  assert.equal(result.fullPlanComplete, false)
  assert.ok(surfaceRows.every(row => row.manualAcceptance === 'pending' && row.featureAccepted === false))
  assert.ok(blockedRows.every(row => row.blockedAcceptance === 'pending'))
})

test('a record that marks per-row items accepted is rejected', () => {
  const record = baseRecord()
  record.itemAcceptance.surfaceRows = 'accepted'
  const result = evaluate(record)
  assert.equal(result.accepted, false)
  assert.equal(result.reasonCode, 'item-acceptance')
  assert.equal(result.manualAcceptance, 'pending')
  assert.equal(result.fullPlanComplete, false)
})

test('a record that claims the full plan is complete is rejected', () => {
  const record = baseRecord()
  record.fullPlanComplete = true
  const result = evaluate(record)
  assert.equal(result.accepted, false)
  assert.equal(result.reasonCode, 'full-plan-complete')
  assert.equal(result.fullPlanComplete, false)
})

test('an absent decision stays pending', () => {
  const result = evaluate(null)
  assert.equal(result.accepted, false)
  assert.equal(result.status, 'pending')
  assert.equal(result.reasonCode, 'absent-decision')
  assert.equal(result.manualAcceptance, 'pending')
  assert.equal(result.blockedAcceptance, 'pending')
  assert.equal(result.fullPlanComplete, false)
})

test('a record bound to another build is rejected', () => {
  const record = baseRecord()
  record.binding.build.combinedSha256 = '9'.repeat(64)
  const result = evaluate(record)
  assert.equal(result.accepted, false)
  assert.equal(result.reasonCode, 'build-mismatch')
  assert.equal(result.buildBound, false)
})

test('an absent feature manifest is rejected', () => {
  const record = baseRecord()
  delete record.binding.featureManifest
  const result = evaluate(record)
  assert.equal(result.accepted, false)
  assert.equal(result.reasonCode, 'manifest-missing')
})

test('a feature manifest hash or unfinished-count mismatch is rejected', () => {
  const changedHash = baseRecord()
  changedHash.binding.featureManifest.sha256 = '9'.repeat(64)
  assert.equal(evaluate(changedHash).reasonCode, 'manifest-mismatch')

  const changedCount = baseRecord()
  changedCount.binding.featureManifest.unfinishedCount = 52
  assert.equal(evaluate(changedCount).reasonCode, 'manifest-mismatch')
})

test('the exact choice label and observation date are required and no time is fabricated', () => {
  const changedLabel = baseRecord()
  changedLabel.optionLabel = '接受全部迁移完成'
  assert.equal(evaluate(changedLabel).reasonCode, 'choice-mismatch')

  const changedDate = baseRecord()
  changedDate.observedDate = '2026-11-04'
  assert.equal(evaluate(changedDate).reasonCode, 'invalid-date')

  const timeOverclaim = baseRecord()
  timeOverclaim.exactConfirmationTime = '2026-11-05T12:00:00.000Z'
  assert.equal(evaluate(timeOverclaim).reasonCode, 'time-overclaim')
})

test('surface count drift is rejected', () => {
  const result = evaluate(baseRecord(), { surface: { ...surface, surfaceCaptured: 64 } })
  assert.equal(result.accepted, false)
  assert.equal(result.reasonCode, 'surface-mismatch')
})
