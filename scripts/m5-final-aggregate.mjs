#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { buildFingerprint } from './journey-evidence.mjs'
import { scanText } from './check-secrets.mjs'
import {
  AUTOMATED_IDS,
  countUnfinishedMatrix,
  manifestDigest,
  validateAb,
  validateAutomated,
  validateCapture,
  validateGates,
  validateJourneys,
  validatePack,
  validatePackaged,
  validateRootAttempt,
  validateSecrets,
  validateSourceSmoke,
} from './m5-evidence.mjs'
import {
  LAYERED_ACCEPTANCE_STATUS,
  computeFeatureManifestBinding,
  evaluateLayeredDeliveryAcceptance,
  readLayeredDeliveryAcceptance,
} from './m5-layered-acceptance.mjs'

const root = process.cwd()
const startedAt = Date.now()
const outDir = path.join(root, 'artifacts/m5')
const finalAggregateFile = path.join(outDir, 'final-aggregate-latest.json')
const finalAggregateShaBefore = fs.existsSync(finalAggregateFile) ? fileSha256(finalAggregateFile) : null
const rel = file => path.relative(root, file).replaceAll(path.sep, '/')
const exists = file => Boolean(file) && fs.existsSync(file)
const readText = file => (exists(file) ? fs.readFileSync(file, 'utf8') : null)
const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) || null
const latest = (dir, filter) => exists(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)).filter(file => filter(path.basename(file), file)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1) || null : null
const latestDir = (dir, filter) => latest(dir, (name, file) => fs.statSync(file).isDirectory() && filter(name, file))
const evidence = (file, extra = {}) => {
  if (!file) return { path: null, missing: true, ...extra }
  const absolute = path.resolve(root, file)
  if (!exists(absolute)) return { path: rel(absolute), missing: true, ...extra }
  return { path: rel(absolute), sha256: fileSha256(absolute), bytes: fs.statSync(absolute).size, ...extra }
}
const sourceEvidence = (...files) => {
  const entries = files.filter(Boolean).map(file => evidence(file))
  const present = entries.filter(entry => entry.sha256)
  return { files: entries, sourceEvidenceSha256: manifestDigest(present.map(entry => ({ path: entry.path, sha256: entry.sha256 }))) }
}

function readRequired(file, label) {
  if (!file) return { data: null, error: label + ' path was not provided and no evidence file was found', path: null }
  const absolute = path.resolve(root, file)
  if (!exists(absolute)) return { data: null, error: label + ' is missing: ' + rel(absolute), path: rel(absolute) }
  try { return { data: JSON.parse(fs.readFileSync(absolute, 'utf8')), error: null, path: rel(absolute) } }
  catch (error) { return { data: null, error: label + ' is invalid JSON: ' + error.message, path: rel(absolute) } }
}
const failed = error => ({ ok: false, errors: [error] })
const combine = (checks, label) => {
  const errors = checks.flatMap(check => check.errors || [])
  return { ok: errors.length === 0 && checks.every(check => check.ok === true), errors: errors.length ? errors : (checks.length ? [] : [label + ' has no checks']) }
}

function walkFiles(dir) {
  const files = []
  const walk = current => {
    if (!exists(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk(dir)
  return files.sort()
}
const distFiles = walkFiles(path.join(root, 'dist'))
const sourceShellDir = path.join(root, 'src/vendor/cherry/compat/dist-source-shell')
const sourceShellFiles = walkFiles(sourceShellDir)
const sourceShell = path.join(sourceShellDir, 'source-shell.html')
const compiledOutputs = [...distFiles, ...(exists(sourceShell) ? [sourceShell] : [])]
const build = buildFingerprint(compiledOutputs, { root })
const distBuild = buildFingerprint(distFiles, { root })
const distEntries = distFiles.map(file => ({ path: rel(file), sha256: fileSha256(file), bytes: fs.statSync(file).size }))
const distManifestDigest = manifestDigest(distEntries)
const sourceShellEntries = sourceShellFiles.map(file => ({ path: rel(file), sha256: fileSha256(file) }))
const sourceShellDistDigest = manifestDigest(sourceShellEntries)
const sourceShellSha = exists(sourceShell) ? fileSha256(sourceShell) : null
const asar = path.join(root, 'release/win-unpacked/resources/app.asar')
const executable = path.join(root, 'release/win-unpacked/Grimoire.exe')
const asarSha = exists(asar) ? fileSha256(asar) : null
const executableSha = exists(executable) ? fileSha256(executable) : null
const matrixText = readText(path.join(root, '.agent/MIGRATION_MATRIX.md')) || ''
const expectedUnfinished = countUnfinishedMatrix(matrixText)
const fatalErrors = []

const gatesFile = option('gates') ? path.resolve(root, option('gates')) : latest(path.join(root, 'artifacts'), name => /^gates-.*\.json$/.test(name))
const gatesRead = readRequired(gatesFile, 'gates report')
if (gatesRead.error) fatalErrors.push(gatesRead.error)
const gateCheck = gatesRead.data ? validateGates(gatesRead.data, { build, root }) : failed(gatesRead.error || 'gates report missing')

const rootDir = option('root-dir') ? path.resolve(root, option('root-dir')) : latestDir(path.join(root, 'artifacts/m5'), (name, file) => exists(path.join(file, 'root-3x-1.meta.json')))
const rootMetas = exists(rootDir) ? fs.readdirSync(rootDir).filter(name => /^root-3x-\d+\.meta\.json$/.test(name)).sort() : []
const rootAttempts = [1, 2, 3].map(attempt => {
  const metaFile = rootDir ? path.join(rootDir, 'root-3x-' + attempt + '.meta.json') : null
  const stdoutFile = rootDir ? path.join(rootDir, 'root-3x-' + attempt + '.stdout.log') : null
  const stderrFile = rootDir ? path.join(rootDir, 'root-3x-' + attempt + '.stderr.log') : null
  const metaRead = readRequired(metaFile, 'root attempt ' + attempt + ' meta.json')
  const stdout = readText(stdoutFile) || ''
  const stderrBytes = exists(stderrFile) ? fs.statSync(stderrFile).size : null
  const check = metaRead.data ? validateRootAttempt(metaRead.data, { build, attempt, stdout, stderrBytes }) : failed(metaRead.error || 'root meta missing')
  return { attempt, meta: evidence(metaFile), stdout: evidence(stdoutFile), stderr: evidence(stderrFile), exitCode: metaRead.data?.exitCode ?? null, buildFingerprint: metaRead.data?.buildFingerprint ?? null, check }
})
const rootCheck = combine([
  rootMetas.length === 3 && rootMetas.join(',') === 'root-3x-1.meta.json,root-3x-2.meta.json,root-3x-3.meta.json' ? { ok: true, errors: [] } : failed('root directory must contain exactly root-3x-1..3.meta.json'),
  ...rootAttempts.map(attempt => attempt.check),
], 'root evidence')
if (!rootDir) fatalErrors.push('root-3x evidence directory was not found')

const journeysFile = option('journeys') ? path.resolve(root, option('journeys')) : latest(path.join(root, 'artifacts/m5'), name => /^journeys-.*\.json$/.test(name) && name !== 'journeys-latest.json')
const journeysRead = readRequired(journeysFile, 'journeys aggregate')
if (journeysRead.error) fatalErrors.push(journeysRead.error)
const journeyCheck = journeysRead.data ? validateJourneys(journeysRead.data, { build, root }) : failed(journeysRead.error || 'journeys aggregate missing')

const packFile = path.join(root, 'artifacts/m5/pack-report.json')
const packRead = readRequired(packFile, 'pack report')
if (packRead.error) fatalErrors.push(packRead.error)
const packCheck = packRead.data ? validatePack(packRead.data, { build, distBuild, asarSha, sourceShellSha, distManifestDigest }) : failed(packRead.error || 'pack report missing')

const secretsFile = path.join(root, 'artifacts/m5/secrets.json')
const secretsRead = readRequired(secretsFile, 'secrets report')
if (secretsRead.error) fatalErrors.push(secretsRead.error)
const secretsCheck = secretsRead.data ? validateSecrets(secretsRead.data, { build, sourceShellSha, distManifestDigest, requireFinalAggregate: true }) : failed(secretsRead.error || 'secrets report missing')

const captureRun = option('capture-run') ? path.resolve(root, option('capture-run')) : latestDir(path.join(root, 'artifacts/cherry-ui-catalog-runs'), (name, file) => exists(path.join(file, 'capture-report.json')))
const captureFile = captureRun ? path.join(captureRun, 'capture-report.json') : null
const captureRead = readRequired(captureFile, 'capture report')
if (captureRead.error) fatalErrors.push(captureRead.error)
const indexFile = path.join(root, 'artifacts/m5/acceptance-index.json')
const indexRead = readRequired(indexFile, 'acceptance index')
if (indexRead.error) fatalErrors.push(indexRead.error)
const captureCheck = captureRead.data && indexRead.data ? validateCapture(captureRead.data, indexRead.data, { sourceShellSha, expectedUnfinished }) : failed(captureRead.error || indexRead.error || 'capture/index missing')

const featureManifest = computeFeatureManifestBinding(root)
const layeredRead = readLayeredDeliveryAcceptance({ root })
const layered = evaluateLayeredDeliveryAcceptance({
  record: layeredRead.record,
  recordPath: layeredRead.path,
  recordSha256: layeredRead.sha256,
  build,
  featureManifest,
  surface: indexRead.data ? {
    total: indexRead.data.total,
    surfaceCaptured: indexRead.data.surfaceCaptured,
    pending: indexRead.data.pending,
    featureVerified: indexRead.data.featureVerified,
  } : null,
  expectedUnfinished,
})
const layeredDeliveryAcceptance = {
  accepted: layered.accepted,
  record: layered.record,
  recordSha256: layered.recordSha256,
  buildBound: layered.buildBound,
  reasonCode: layered.reasonCode,
  errors: layered.errors,
  userChoice: layered.userChoice,
  questionId: layered.questionId,
  optionLabel: layered.optionLabel,
  scopeDescription: layered.scopeDescription,
  observedDate: layered.observedDate,
  exactConfirmationTime: layered.exactConfirmationTime,
  gapDispositionAcceptance: layered.gapDispositionAcceptance,
  itemAcceptance: layered.itemAcceptance,
  fullPlanComplete: layered.fullPlanComplete,
}
const aggregateStatus = passed => !passed ? 'automated-failed' : layered.accepted ? LAYERED_ACCEPTANCE_STATUS : 'automated-passed-manual-pending'

const packagedFile = path.join(root, 'artifacts/m5/packaged-gui-latest.json')
const packagedRead = readRequired(packagedFile, 'packaged GUI report')
if (packagedRead.error) fatalErrors.push(packagedRead.error)
const packagedCheck = packagedRead.data ? validatePackaged(packagedRead.data, { build, sourceShellSha, asarSha, executableSha }) : failed(packagedRead.error || 'packaged GUI report missing')

const abFile = path.join(root, 'artifacts/m5/ab-compare.json')
const abRead = readRequired(abFile, 'A/B report')
if (abRead.error) fatalErrors.push(abRead.error)
const abCheck = abRead.data ? validateAb(abRead.data, { build, sourceShellSha, root }) : failed(abRead.error || 'A/B report missing')

const smokeFile = option('source-smoke') ? path.resolve(root, option('source-smoke')) : latestDir(path.join(root, 'artifacts/source-shell'), (name, file) => exists(path.join(file, 'smoke.json')))
const smokePath = smokeFile ? (path.basename(smokeFile) === 'smoke.json' ? smokeFile : path.join(smokeFile, 'smoke.json')) : null
const smokeRead = readRequired(smokePath, 'source-shell smoke')
if (smokeRead.error) fatalErrors.push(smokeRead.error)
const smokeCheck = smokeRead.data ? validateSourceSmoke(smokeRead.data, { build, sourceShellSha, sourceShellDistDigest }) : failed(smokeRead.error || 'source-shell smoke missing')

const buildBound = [gateCheck, rootCheck, journeyCheck, packCheck, secretsCheck, captureCheck, packagedCheck, abCheck, smokeCheck].every(check => check.ok === true)

const automated = [
  { id: 'G1-G14', passed: gateCheck.ok, errors: gateCheck.errors, evidence: evidence(gatesFile, { complete: gatesRead.data?.complete ?? false, buildBefore: gatesRead.data?.buildBefore?.combinedSha256 ?? null, buildAfter: gatesRead.data?.buildAfter?.combinedSha256 ?? null, buildStable: gatesRead.data?.buildStable ?? false, rawLogDirectory: gatesRead.data?.logDirectory ?? null, results: (gatesRead.data?.results || []).map(item => ({ id: item.id, exitCode: item.exitCode, attempts: item.attempts, durationMs: item.durationMs, logArtifact: item.logArtifact, stdoutSha256: item.stdoutSha256 })) }) },
  { id: 'ROOT-3X', passed: rootCheck.ok, errors: rootCheck.errors, evidence: { directory: rootDir ? rel(rootDir) : null, attempts: rootAttempts.map(item => ({ attempt: item.attempt, exitCode: item.exitCode, buildFingerprint: item.buildFingerprint?.combinedSha256 ?? null, meta: item.meta, stdout: item.stdout, stderr: item.stderr, errors: item.check.errors })) } },
  { id: 'JOURNEYS-25', passed: journeyCheck.ok, errors: journeyCheck.errors, evidence: evidence(journeysFile, { status: journeysRead.data?.status ?? null, total: journeysRead.data?.total ?? null, expected: journeysRead.data?.expected ?? null, sourceAggregate: journeysRead.data?.sourceAggregate ?? null, build: journeysRead.data?.build ?? null, results: (journeysRead.data?.results || []).map(item => ({ index: item.index, ok: item.ok, attempts: (item.attempts || []).map(attempt => ({ attempt: attempt.attempt, exitCode: attempt.exitCode, buildSha256: attempt.buildSha256, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, stdoutArtifact: attempt.stdoutArtifact, stdoutSha256: attempt.stdoutSha256 })) })) }) },
  { id: 'PACK-ASAR', passed: packCheck.ok, errors: packCheck.errors, evidence: evidence(packFile, { mode: packRead.data?.mode ?? null, asarSha256: packRead.data?.asarSha256 ?? null, currentAsarSha256: asarSha, buildFingerprint: packRead.data?.buildFingerprint?.combinedSha256 ?? null, currentDistBuild: distBuild.combinedSha256, sourceShellSha256: packRead.data?.sourceShellSha256 ?? null, distManifest: packRead.data?.distManifest ? { digest: packRead.data.distManifest.digest, fileCount: packRead.data.distManifest.fileCount, asarDistEntryCount: packRead.data.distManifest.asarDistEntryCount, missingInAsar: packRead.data.distManifest.missingInAsar, missingInDist: packRead.data.distManifest.missingInDist, different: packRead.data.distManifest.different } : null }) },
  { id: 'PACKAGED-GUI', passed: packagedCheck.ok, errors: packagedCheck.errors, evidence: evidence(packagedFile, { passed: packagedRead.data?.passed ?? null, buildFingerprint: packagedRead.data?.buildFingerprint?.combinedSha256 ?? null, archive: packagedRead.data?.archive ?? null, executable: packagedRead.data?.executable ?? null, defaultRoute: packagedRead.data?.routes?.defaultRoute ?? null, cleanup: packagedRead.data?.cleanup ?? null }) },
  { id: 'CATALOG-CAPTURE', passed: captureCheck.ok, errors: captureCheck.errors, evidence: { ...sourceEvidence(captureFile, indexFile), capture: evidence(captureFile, { sourceShellSha256: captureRead.data?.sourceShellSha256 ?? null, summary: captureRead.data?.summary ?? null, failures: captureRead.data?.failures ?? null }), index: evidence(indexFile, { sourceShellSha256: indexRead.data?.build?.sourceShellSha256 ?? null, surfaceCaptured: indexRead.data?.surfaceCaptured ?? null, capturablePending: indexRead.data?.capturablePending ?? null, featureVerified: indexRead.data?.featureVerified ?? null, unfinishedMatrixCount: indexRead.data?.unfinishedMatrixCount ?? null, expectedUnfinished, validationErrors: indexRead.data?.validationErrors ?? null }) } },
  { id: 'SECRETS', passed: secretsCheck.ok, errors: secretsCheck.errors, evidence: evidence(secretsFile, { buildSha256: secretsRead.data?.buildSha256 ?? null, sourceShellSha256: secretsRead.data?.sourceShellSha256 ?? null, scanManifest: secretsRead.data?.scanManifest ?? null, lastScan: secretsRead.data?.lastScan ?? null, currentFinalAggregateShaBefore: finalAggregateShaBefore, scannedAggregateFiles: secretsRead.data?.scannedAggregateFiles ?? null, findings: secretsRead.data?.findings ?? null }) },
  { id: 'A-B-COMPARE', passed: abCheck.ok, errors: abCheck.errors, evidence: evidence(abFile, { buildSha256: abRead.data?.buildSha256 ?? null, sourceShellSha256: abRead.data?.sourceShellSha256 ?? null, tableComplete: abRead.data?.tableComplete ?? null, aCriticalSupported: abRead.data?.aCriticalSupported ?? null, bCriticalSupported: abRead.data?.bCriticalSupported ?? null, dimensions: (abRead.data?.dimensions || []).map(item => ({ id: item.id, A: item.A?.status, B: item.B?.status, AEvidence: item.A?.evidence?.path, BEvidence: item.B?.evidence?.path })) }) },
  { id: 'SOURCE-SHELL-B', passed: smokeCheck.ok, errors: smokeCheck.errors, evidence: evidence(smokePath, { artifactSha256: smokeRead.data?.artifactSha256 ?? null, currentArtifactSha256: sourceShellSha, sourceShellDistDigest: smokeRead.data?.sourceShellDistDigest ?? null, currentSourceShellDistDigest: sourceShellDistDigest, buildFingerprint: smokeRead.data?.buildFingerprint?.combinedSha256 ?? null, buildRunByAudit: smokeRead.data?.compilation?.buildRunByAudit ?? null, checks: smokeRead.data?.checks ?? null }) },
  { id: 'BUILD-BINDING', passed: buildBound, errors: buildBound ? [] : ['at least one automated evidence item is not bound to the current build'], evidence: { build: build.combinedSha256, fileCount: build.fileCount, totalBytes: build.totalBytes, distBuild: distBuild.combinedSha256, distFileCount: distBuild.fileCount, distManifestDigest, sourceShellSha256: sourceShellSha, sourceShellDistDigest, asarSha256: asarSha, executableSha256: executableSha } },
]

for (const item of automated) {
  if (item.evidence?.missing === true) item.passed = false
  if (item.evidence?.files?.some(entry => entry.missing === true)) item.passed = false
}
const selfScanText = JSON.stringify(automated)
const selfSecretScan = scanText(selfScanText, 'artifacts/m5/final-aggregate-latest.json')
const secretsItem = automated.find(item => item.id === 'SECRETS')
if (secretsItem) {
  secretsItem.passed = secretsItem.passed && selfSecretScan.findings.length === 0
  secretsItem.evidence.sourceEvidence = sourceEvidence(secretsFile)
  secretsItem.evidence.selfSecretFindings = selfSecretScan.findings
}
const automatedCheck = validateAutomated(automated)
const automatedPassed = automatedCheck.ok && automated.every(item => item.passed === true) && fatalErrors.length === 0

const report = {
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  status: aggregateStatus(automatedPassed),
  automatedPassed,
  exitCode: automatedPassed ? 0 : 1,
  manualAcceptance: 'pending',
  blockedAcceptance: 'pending',
  gapDispositionAcceptance: layered.accepted ? 'inventory-acknowledged' : 'pending',
  layeredDeliveryAcceptance,
  build,
  distBuild,
  distManifestDigest,
  sourceShellSha256: sourceShellSha,
  sourceShellDistDigest,
  featureManifest,
  expectedUnfinishedMatrix: expectedUnfinished,
  evidenceSelection: {
    gates: option('gates') ? 'explicit' : 'latest',
    rootDirectory: option('root-dir') ? 'explicit' : 'latest',
    journeys: option('journeys') ? 'explicit' : 'latest',
    captureRun: option('capture-run') ? 'explicit' : 'latest',
    sourceSmoke: option('source-smoke') ? 'explicit' : 'latest',
  },
  automated,
  automatedCheck: { ok: automatedCheck.ok, errors: automatedCheck.errors },
  fatalErrors,
  selfSecretFindings: selfSecretScan.findings,
  remainingBlockers: [
    { id: 'manual-acceptance', state: 'pending', detail: 'User has not accepted the screenshot/manual checklist.' },
    { id: 'blocked-acceptance', state: 'pending', detail: 'BLOCKED/NOT_IMPLEMENTED rows have not been accepted by the user.' },
    { id: 'unfinished-matrix', state: expectedUnfinished, detail: 'PARTIALLY_MIGRATED/BLOCKED/MISSING/NOT_IMPLEMENTED/REIMPLEMENTED rows remain; this count is a registered gap, not an instruction to implement every row in this round.' },
    { id: 'catalog-interaction', state: indexRead.data?.interactionPending ?? null, detail: 'rows 71-73 need a real context menu/quick panel/dialog action.' },
    { id: 'catalog-window', state: indexRead.data?.windowPending ?? null, detail: 'detached/quick assistant/screenshot/selection/migration windows are not captured.' },
    { id: 'catalog-non-renderer', state: indexRead.data?.nonRendererPending ?? null, detail: 'non-renderer enumerations have reasons but no PNG.' },
    { id: 'recovery', state: 'blocked', detail: 'runtime recovery remains not-implemented; no recovery event is fabricated.' },
    { id: 'B-chat-approval-recovery', state: 'untested', detail: 'source-shell smoke does not drive chat streaming, approval, or recovery.' },
    { id: 'B-pack', state: 'blocked', detail: 'B is dev-only and is not an electron-builder target.' },
  ].map(item => ({ ...item, blockedAcceptance: 'pending' })),
  provenance: {
    gates: evidence(gatesFile),
    rootDirectory: rootDir ? rel(rootDir) : null,
    rootMetas: rootAttempts.map(item => item.meta),
    journeys: evidence(journeysFile),
    pack: evidence(packFile),
    secrets: evidence(secretsFile),
    ab: evidence(abFile),
    index: evidence(indexFile),
    packagedGui: evidence(packagedFile),
    captureReport: evidence(captureFile),
    sourceShellSmoke: evidence(smokePath),
  },
}

const fullSelfScan = scanText(JSON.stringify(report), 'artifacts/m5/final-aggregate-latest.json')
report.selfSecretFindings = fullSelfScan.findings
if (secretsItem) {
  secretsItem.passed = secretsItem.passed && fullSelfScan.findings.length === 0
  secretsItem.evidence.selfSecretFindings = fullSelfScan.findings
}
report.automatedPassed = validateAutomated(report.automated).ok && report.automated.every(item => item.passed === true) && report.fatalErrors.length === 0
report.status = aggregateStatus(report.automatedPassed)
report.exitCode = report.automatedPassed ? 0 : 1

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'final-aggregate-' + stamp + '.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
fs.writeFileSync(path.join(outDir, 'final-aggregate-latest.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
const md = [
  '# M5 final aggregate',
  '',
  'Status: ' + report.status,
  'Automated passed: ' + report.automatedPassed,
  'manualAcceptance: pending',
  'blockedAcceptance: pending',
  'gapDispositionAcceptance: ' + report.gapDispositionAcceptance,
  'Layered delivery acceptance: ' + (report.layeredDeliveryAcceptance.accepted ? 'accepted' : 'not accepted') + ' (record=' + report.layeredDeliveryAcceptance.record + ', sha256=' + (report.layeredDeliveryAcceptance.recordSha256 ?? 'missing') + ', buildBound=' + report.layeredDeliveryAcceptance.buildBound + ')',
  'Per-item acceptance: surfaceRows=' + report.layeredDeliveryAcceptance.itemAcceptance.surfaceRows + ', blockedRows=' + report.layeredDeliveryAcceptance.itemAcceptance.blockedRows + '; fullPlanComplete=' + report.layeredDeliveryAcceptance.fullPlanComplete,
  'Build SHA-256: ' + build.combinedSha256 + ' (' + build.fileCount + ' files, ' + build.totalBytes + ' bytes)',
  'Dist build SHA-256: ' + distBuild.combinedSha256 + ' (' + distBuild.fileCount + ' files)',
  'Source-shell SHA-256: ' + (sourceShellSha || 'missing'),
  'Unfinished matrix rows: ' + expectedUnfinished,
  '',
  '|自动项|结果|证据|',
  '|---|---|---|',
  ...automated.map(item => '|' + item.id + '|' + (item.passed ? 'passed' : 'failed') + '|' + (item.evidence?.path || item.evidence?.directory || 'inline') + '|'),
  '',
  '## Errors',
  '',
  ...(report.fatalErrors.length || report.automatedCheck.errors.length ? [...report.fatalErrors, ...report.automatedCheck.errors] : ['none']).map(error => '- ' + String(error).replaceAll('|', '\\|')),
  '',
  '## Remaining blockers',
  '',
  '|ID|状态|blockedAcceptance|说明|',
  '|---|---|---|---|',
  ...report.remainingBlockers.map(item => '|' + item.id + '|' + item.state + '|' + item.blockedAcceptance + '|' + String(item.detail).replaceAll('|', '\\|') + '|'),
]
fs.writeFileSync(path.join(outDir, 'final-aggregate-latest.md'), md.join(String.fromCharCode(10)) + String.fromCharCode(10))
console.log(JSON.stringify({ status: report.status, automatedPassed: report.automatedPassed, manualAcceptance: report.manualAcceptance, blockedAcceptance: report.blockedAcceptance, gapDispositionAcceptance: report.gapDispositionAcceptance, layeredDeliveryAcceptance: report.layeredDeliveryAcceptance, build: build.combinedSha256, failed: report.automated.filter(item => !item.passed).map(item => item.id), errors: [...report.fatalErrors, ...report.automatedCheck.errors], artifact: 'artifacts/m5/final-aggregate-latest.json' }))
process.exitCode = report.automatedPassed ? 0 : 1
