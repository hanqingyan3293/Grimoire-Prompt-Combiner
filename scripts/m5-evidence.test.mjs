import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  GATE_IDS,
  AUTOMATED_IDS,
  validateGates,
  validateRootAttempt,
  validateJourneys,
  validatePack,
  validateSecrets,
  validateSourceSmoke,
  validateAutomated,
  validateCapture,
  validatePackaged,
  validateAb,
} from './m5-evidence.mjs'

const NL = String.fromCharCode(10)
const hash = value => createHash('sha256').update(value).digest('hex')
const build = { combinedSha256: 'a'.repeat(64), fileCount: 3672, totalBytes: 80016511 }
const otherBuild = { combinedSha256: 'b'.repeat(64), fileCount: 3672, totalBytes: 80016511 }
const sourceShellSha = 'c'.repeat(64)
const distDigest = 'd'.repeat(64)
const asarSha = 'e'.repeat(64)
const exeSha = 'f'.repeat(64)

function gate(id, stdout, root) {
  const logArtifact = 'logs/' + id + '.stdout.log'
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(root, logArtifact), stdout)
  return { id, ok: true, exitCode: 0, attempts: 1, durationMs: 1, stdoutSha256: hash(stdout), logArtifact }
}

function gates(root, ids = GATE_IDS, bound = build) {
  return {
    schemaVersion: 2,
    complete: true,
    failed: [],
    buildBefore: bound,
    buildAfter: bound,
    buildStable: true,
    results: ids.map(id => gate(id, 'output ' + id + NL, root)),
  }
}

function journey(index, bound = build) {
  return {
    index,
    ok: true,
    attempts: [{ attempt: 1, ok: true, exitCode: 0, buildSha256: bound.combinedSha256, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', stdoutArtifact: 'j' + index + '.log', stdoutSha256: hash('journey ' + index) }],
  }
}

function journeys(results = Array.from({ length: 25 }, (_, i) => journey(i + 1))) {
  return { schemaVersion: 2, status: 'passed', total: results.length, expected: 25, failedIndexes: [], build, sourceAggregate: null, results }
}

function pack() {
  return {
    passed: true,
    mode: 'verify-package',
    asarSha256: asarSha,
    sourceShellSha256: sourceShellSha,
    buildFingerprint: { ...build },
    checks: [{ name: 'exact asar dist/main/main/index.js', passed: true }],
    distManifest: { algorithm: 'sha256', digest: distDigest, fileCount: 5, totalBytes: 10, missingInAsar: [], missingInDist: [], different: [] },
  }
}

function secrets() {
  return {
    passed: true,
    findings: [],
    patternIds: ['openai-project', 'anthropic', 'jwt', 'client-secret', 'authorization'],
    buildSha256: build.combinedSha256,
    sourceShellSha256: sourceShellSha,
    scanManifest: { algorithm: 'sha256', digest: '1'.repeat(64), fileCount: 4425, totalBytes: 100, distDigest, distFileCount: 5, sourceShellSha256: sourceShellSha },
    scannedAggregateFiles: ['artifacts/m5/final-aggregate-latest.json'],
    lastScan: { finalAggregateIncluded: true, finalAggregateSha256: '7'.repeat(64) },
  }
}

test('gates: exact G1..G14 set, raw log hash, and stable current build are mandatory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-gates-'))
  try {
    assert.equal(validateGates(gates(root), { build, root }).ok, true)
    assert.equal(validateGates(gates(root, GATE_IDS.slice(0, 13)), { build, root }).ok, false, 'a 13-gate subset is not G1..G14')
    assert.equal(validateGates(gates(root, [...GATE_IDS, 'G15']), { build, root }).ok, false, 'an extra gate is not the expected set')
    const stale = gates(root, GATE_IDS, otherBuild)
    assert.equal(validateGates(stale, { build, root }).ok, false, 'gates from another build must be rejected')
    const noRaw = gates(root)
    noRaw.results[0].logArtifact = 'logs/missing.log'
    noRaw.results[0].stdoutSha256 = '2'.repeat(64)
    assert.equal(validateGates(noRaw, { build, root }).ok, false, 'text-only green without raw log hashes is rejected')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('root run: real exit meta, timestamps, stdout hash, and build fingerprint are mandatory', () => {
  const stdout = '[G3] shards: 1=pass 2=pass 3=pass' + NL
  const meta = { schemaVersion: 1, attempt: 1, command: 'node scripts/test-root-sharded.mjs', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:05:00.000Z', exitCode: 0, stdoutSha256: hash(stdout), buildFingerprint: build }
  assert.equal(validateRootAttempt(meta, { build, attempt: 1, stdout, stderrBytes: 0 }).ok, true)
  assert.equal(validateRootAttempt({ ...meta, stdoutSha256: null }, { build, attempt: 1, stdout, stderrBytes: 0 }).ok, false, 'stdout text alone cannot prove exit 0')
  assert.equal(validateRootAttempt({ ...meta, buildFingerprint: otherBuild }, { build, attempt: 1, stdout, stderrBytes: 0 }).ok, false, 'old build root meta is stale')
  assert.equal(validateRootAttempt({ ...meta, exitCode: 1 }, { build, attempt: 1, stdout, stderrBytes: 0 }).ok, false, 'real non-zero exit must stay red')
  assert.equal(validateRootAttempt({ ...meta, finishedAt: '2025-12-31T23:59:59.000Z' }, { build, attempt: 1, stdout, stderrBytes: 0 }).ok, false, 'timestamps must be present and ordered')
})

test('journeys: all 25 exact indexes, no inherited aggregate, no stale build', () => {
  assert.equal(validateJourneys(journeys(), { build }).ok, true)
  assert.equal(validateJourneys(journeys(Array.from({ length: 24 }, (_, i) => journey(i + 1))), { build }).ok, false, '24 inherited results are not 25 current results')
  const duplicate = journeys()
  duplicate.results[24] = journey(24)
  assert.equal(validateJourneys(duplicate, { build }).ok, false, 'duplicate indexes cannot fill the set')
  const inherited = journeys()
  inherited.sourceAggregate = { path: 'old.json', sha256: '3'.repeat(64) }
  assert.equal(validateJourneys(inherited, { build }).ok, false, 'old aggregate inheritance must be rejected')
  const stale = journeys()
  stale.results[0] = journey(1, otherBuild)
  assert.equal(validateJourneys(stale, { build }).ok, false, 'a journey attempt from another build is stale')
  const missingAttemptBuild = journeys()
  delete missingAttemptBuild.results[0].attempts[0].buildSha256
  assert.equal(validateJourneys(missingAttemptBuild, { build }).ok, false, 'attempts must record the build they ran against')
})

test('a budget-exhausted journey attempt stays in history but does not erase a later success', () => {
  const retried = journeys()
  retried.results[24] = {
    index: 25,
    ok: true,
    attempts: [
      { attempt: 1, ok: false, exitCode: null, buildSha256: build.combinedSha256, budgetExhausted: true, timedOut: true, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', stdoutArtifact: 'j25-1.log', stdoutSha256: hash('journey 25') },
      { attempt: 2, ok: true, exitCode: 0, buildSha256: build.combinedSha256, budgetExhausted: false, startedAt: '2026-01-01T00:01:00.000Z', finishedAt: '2026-01-01T00:01:01.000Z', stdoutArtifact: 'j25-2.log', stdoutSha256: hash('journey 25') },
    ],
  }
  assert.equal(validateJourneys(retried, { build }).ok, true)
  const reused = journeys()
  reused.results[24].attempts.push({ ...reused.results[24].attempts[0], attempt: 2, ok: true, exitCode: 0, budgetExhausted: false })
  assert.equal(validateJourneys(reused, { build }).ok, false, 'attempt logs must be distinct per attempt')
  const hard = journeys()
  hard.results[24].attempts[0].ok = false
  assert.equal(validateJourneys(hard, { build }).ok, false, 'a real non-zero test failure must remain red')
})

test('pack: all dist files plus current bytes are mandatory, not four sampled files', () => {
  assert.equal(validatePack(pack(), { build, distBuild: build, asarSha, sourceShellSha, distManifestDigest: distDigest }).ok, true)
  const sampled = pack()
  delete sampled.distManifest
  assert.equal(validatePack(sampled, { build, distBuild: build, asarSha, sourceShellSha, distManifestDigest: distDigest }).ok, false, 'four exact checks are not a complete dist manifest')
  const differ = pack()
  differ.distManifest.different = [{ path: 'dist/main/main/index.js' }]
  assert.equal(validatePack(differ, { build, distBuild: build, asarSha, sourceShellSha, distManifestDigest: distDigest }).ok, false, 'any different dist byte must fail')
  const stale = pack()
  stale.buildFingerprint = otherBuild
  assert.equal(validatePack(stale, { build, distBuild: build, asarSha, sourceShellSha, distManifestDigest: distDigest }).ok, false, 'pack from another build must be rejected')
})

test('secrets: report carries build, source-shell hash, scan manifest, and the final aggregate scan', () => {
  assert.equal(validateSecrets(secrets(), { build, sourceShellSha, distManifestDigest: distDigest, requireFinalAggregate: true }).ok, true)
  const noManifest = secrets()
  delete noManifest.scanManifest
  assert.equal(validateSecrets(noManifest, { build, sourceShellSha, distManifestDigest: distDigest, requireFinalAggregate: true }).ok, false, 'a finding-free claim without a scan manifest is not evidence')
  const stale = secrets()
  stale.buildSha256 = otherBuild.combinedSha256
  assert.equal(validateSecrets(stale, { build, sourceShellSha, distManifestDigest: distDigest, requireFinalAggregate: true }).ok, false, 'secrets scanned against another build are stale')
  const noFinal = secrets()
  noFinal.scannedAggregateFiles = []
  assert.equal(validateSecrets(noFinal, { build, sourceShellSha, distManifestDigest: distDigest, requireFinalAggregate: true }).ok, false, 'the last scan must include the final aggregate')
})

test('source-shell B smoke binds the actual current artifact hash', () => {
  const smoke = { passed: true, artifactSha256: sourceShellSha, sourceShellDistDigest: '4'.repeat(64), buildFingerprint: build, compilation: { buildRunByAudit: false }, checks: { mainAppBootstrapObserved: true, appShellMounted: true }, profileRemoved: true }
  assert.equal(validateSourceSmoke(smoke, { build, sourceShellSha, sourceShellDistDigest: smoke.sourceShellDistDigest }).ok, true)
  assert.equal(validateSourceSmoke({ ...smoke, artifactSha256: '5'.repeat(64) }, { build, sourceShellSha, sourceShellDistDigest: smoke.sourceShellDistDigest }).ok, false, 'smoke from another artifact is stale')
  assert.equal(validateSourceSmoke({ ...smoke, artifactSha256: null }, { build, sourceShellSha, sourceShellDistDigest: smoke.sourceShellDistDigest }).ok, false, 'no artifact hash means no currentness proof')
})

test('automated aggregate requires the exact item set, not a non-empty subset', () => {
  const all = AUTOMATED_IDS.map(id => ({ id, passed: true }))
  assert.equal(validateAutomated(all).ok, true)
  assert.equal(validateAutomated(all.slice(0, 3)).ok, false)
  assert.equal(validateAutomated([...all, { id: 'EXTRA', passed: true }]).ok, false)
  assert.equal(validateAutomated(all.map((item, i) => i === 4 ? { ...item, passed: false } : item)).ok, false)
})

test('capture index and packaged GUI are rejected when stale or incomplete', () => {
  const capture = { failures: [], sourceShellSha256: sourceShellSha, summary: { capturablePending: 0, surfaceCaptured: 65 } }
  const index = { validationErrors: [], capturablePending: 0, surfaceCaptured: 65, featureVerified: 0, manualAcceptance: 'pending', unfinishedMatrixCount: 53, build: { sourceShellSha256: sourceShellSha } }
  assert.equal(validateCapture(capture, index, { sourceShellSha, expectedUnfinished: 53 }).ok, true)
  assert.equal(validateCapture({ ...capture, sourceShellSha256: '6'.repeat(64) }, index, { sourceShellSha, expectedUnfinished: 53 }).ok, false)
  assert.equal(validateCapture(capture, { ...index, unfinishedMatrixCount: 52 }, { sourceShellSha, expectedUnfinished: 53 }).ok, false)
  const packaged = { passed: true, buildFingerprint: build, sourceShellSha256: sourceShellSha, archive: { sha256: asarSha }, executable: { sha256: exeSha }, routes: { defaultRoute: '/app/chat' }, cleanup: { pidExited: true, profileRemoved: true, originalProfileTouched: false } }
  assert.equal(validatePackaged(packaged, { build, sourceShellSha, asarSha, executableSha: exeSha }).ok, true)
  assert.equal(validatePackaged({ ...packaged, buildFingerprint: otherBuild }, { build, sourceShellSha, asarSha, executableSha: exeSha }).ok, false)
})

test('A/B comparison is rejected when its journey evidence belongs to another build', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-ab-'))
  try {
    fs.writeFileSync(path.join(root, 'evidence.json'), '{}')
    const dims = ['startup', 'routes', 'tabs', 'chat', 'agent', 'approval', 'recovery', 'settings', 'pack'].map(id => ({ id, A: { status: 'supported', evidence: { path: 'evidence.json', sha256: hash('{}') } }, B: { status: 'supported', evidence: { path: 'evidence.json', sha256: hash('{}') } } }))
    const ab = { passed: true, tableComplete: true, aCriticalSupported: true, bCriticalSupported: true, buildSha256: build.combinedSha256, sourceShellSha256: sourceShellSha, dimensions: dims }
    assert.equal(validateAb(ab, { build, sourceShellSha, root }).ok, true)
    assert.equal(validateAb({ ...ab, buildSha256: otherBuild.combinedSha256 }, { build, sourceShellSha, root }).ok, false)
    assert.equal(validateAb({ ...ab, dimensions: dims.slice(0, 8) }, { build, sourceShellSha, root }).ok, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
