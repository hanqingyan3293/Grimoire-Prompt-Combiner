import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileSha256 } from './cherry-ui-capture-evidence.mjs'

export const GATE_IDS = Array.from({ length: 14 }, (_, i) => 'G' + (i + 1))
export const AUTOMATED_IDS = [
  'G1-G14',
  'ROOT-3X',
  'JOURNEYS-25',
  'PACK-ASAR',
  'PACKAGED-GUI',
  'CATALOG-CAPTURE',
  'SECRETS',
  'A-B-COMPARE',
  'SOURCE-SHELL-B',
  'BUILD-BINDING',
]
export const JOURNEY_COUNT = 25
export const REQUIRED_SECRET_PATTERNS = ['openai-project', 'anthropic', 'jwt', 'client-secret', 'authorization']
export const AB_DIMENSIONS = ['startup', 'routes', 'tabs', 'chat', 'agent', 'approval', 'recovery', 'settings', 'pack']

const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const sameBuild = (left, right) => Boolean(left && right && isHash(left.combinedSha256) && left.combinedSha256 === right.combinedSha256 && Number(left.fileCount) === Number(right.fileCount))
const rel = (root, file) => String(file).replaceAll(path.sep, '/').replace(/^\.\//, '')

export function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function manifestDigest(entries) {
  const sorted = [...entries].map(entry => ({ path: rel('', entry.path), sha256: entry.sha256 })).sort((a, b) => a.path.localeCompare(b.path))
  return sha256Text(sorted.map(entry => entry.path + ':' + entry.sha256).join(String.fromCharCode(10)))
}

function result(errors) { return { ok: errors.length === 0, errors } }

export function validateGates(gates, options = {}) {
  const errors = []
  const expectedIds = options.expectedIds || GATE_IDS
  const build = options.build
  const root = options.root || process.cwd()
  if (!gates || typeof gates !== 'object') return result(['missing gates report'])
  if (gates.complete !== true) errors.push('gates report is not marked complete')
  if (!Array.isArray(gates.failed) || gates.failed.length !== 0) errors.push('gates.failed must be an empty array')
  if (!Array.isArray(gates.results)) return result(['gates.results is not an array'])
  const ids = gates.results.map(item => item?.id)
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
  const missingIds = expectedIds.filter(id => !ids.includes(id))
  const extraIds = ids.filter(id => !expectedIds.includes(id))
  if (gates.results.length !== expectedIds.length) errors.push('expected exactly ' + expectedIds.length + ' gate results, got ' + gates.results.length)
  if (duplicateIds.length) errors.push('duplicate gate ids: ' + [...new Set(duplicateIds)].join(','))
  if (missingIds.length) errors.push('missing gate ids: ' + missingIds.join(','))
  if (extraIds.length) errors.push('unexpected gate ids: ' + extraIds.join(','))
  if (gates.buildStable !== true) errors.push('build was not stable across the gate run')
  if (!build || !isHash(build.combinedSha256)) errors.push('current build fingerprint is missing')
  if (!sameBuild(gates.buildBefore, build)) errors.push('gates buildBefore does not match the current build')
  if (!sameBuild(gates.buildAfter, build)) errors.push('gates buildAfter does not match the current build')
  for (const item of gates.results) {
    if (!item || typeof item !== 'object') { errors.push('gate result is not an object'); continue }
    if (item.ok !== true || item.exitCode !== 0) errors.push(item.id + ' did not exit 0')
    if (!Number.isInteger(item.attempts) || item.attempts < 1) errors.push(item.id + ' has no real attempt count')
    if (!isHash(item.stdoutSha256)) errors.push(item.id + ' has no raw stdout sha256')
    if (typeof item.logArtifact !== 'string' || !item.logArtifact.trim()) errors.push(item.id + ' has no raw log artifact')
    if (typeof item.logArtifact === 'string' && item.logArtifact.trim()) {
      const logFile = path.resolve(root, item.logArtifact)
      if (!fs.existsSync(logFile)) errors.push(item.id + ' raw log is missing: ' + item.logArtifact)
      else if (isHash(item.stdoutSha256) && fileSha256(logFile) !== item.stdoutSha256) errors.push(item.id + ' raw log hash does not match stdoutSha256')
    }
  }
  return result(errors)
}

export function validateRootAttempt(meta, options) {
  const errors = []
  const build = options.build
  const attempt = options.attempt
  const stdout = options.stdout
  const stderrBytes = options.stderrBytes
  if (!meta || typeof meta !== 'object') return result(['missing root meta.json'])
  if (Number(meta.attempt) !== Number(attempt)) errors.push('root meta attempt is not ' + attempt)
  if (meta.exitCode !== 0) errors.push('root run real exitCode is not 0')
  if (typeof meta.command !== 'string' || !/test-root-sharded\.mjs/.test(meta.command)) errors.push('root meta command does not name the sharded root runner')
  if (!isTime(meta.startedAt) || !isTime(meta.finishedAt)) errors.push('root meta timestamps are missing or invalid')
  else if (Date.parse(meta.finishedAt) < Date.parse(meta.startedAt)) errors.push('root meta finishedAt precedes startedAt')
  if (!isHash(meta.stdoutSha256)) errors.push('root meta stdoutSha256 is missing')
  else if (sha256Text(stdout || '') !== meta.stdoutSha256) errors.push('root meta stdoutSha256 does not match the captured stdout log')
  if (!sameBuild(meta.buildFingerprint, build)) errors.push('root meta build fingerprint does not match the current build')
  if (stderrBytes !== 0) errors.push('root run stderr is not empty')
  if (!/\[G3\] shards: 1=pass 2=pass 3=pass/.test(String(stdout || ''))) errors.push('root stdout does not prove all three shards passed')
  if (/=fail|\bFAIL\b|\d+ failed/.test(String(stdout || ''))) errors.push('root stdout contains a failure signal')
  return result(errors)
}

export function validateJourneys(aggregate, options = {}) {
  const errors = []
  const build = options.build
  const expected = Number(options.expected || JOURNEY_COUNT)
  const root = options.root
  if (!aggregate || typeof aggregate !== 'object') return result(['missing journeys aggregate'])
  if (aggregate.sourceAggregate) errors.push('journey aggregate inherited results from another aggregate; current-build rerun required')
  if (aggregate.status !== 'passed') errors.push('journey aggregate status is not passed')
  if (Number(aggregate.expected) !== expected) errors.push('journey expected count is not ' + expected)
  if (Number(aggregate.total) !== expected) errors.push('journey total count is not ' + expected)
  if (!Array.isArray(aggregate.results)) return result([...errors, 'journey results is not an array'])
  if (aggregate.results.length !== expected) errors.push('expected exactly ' + expected + ' journey results')
  if (!Array.isArray(aggregate.failedIndexes) || aggregate.failedIndexes.length !== 0) errors.push('journey failedIndexes is not empty')
  if (!sameBuild(aggregate.build, build)) errors.push('journey aggregate build does not match the current build')
  const indexes = aggregate.results.map(item => Number(item?.index))
  const duplicates = indexes.filter((index, position) => indexes.indexOf(index) !== position)
  if (duplicates.length) errors.push('duplicate journey indexes: ' + [...new Set(duplicates)].join(','))
  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter(index => !indexes.includes(index))
  if (missing.length) errors.push('missing journey indexes: ' + missing.join(','))
  for (const item of aggregate.results) {
    if (!item || item.ok !== true) errors.push('journey ' + item?.index + ' is not ok')
    if (!Array.isArray(item?.attempts) || item.attempts.length < 1) { errors.push('journey ' + item?.index + ' has no attempt history'); continue }
    const seenArtifacts = new Set()
    for (const attempt of item.attempts) {
      if (attempt.ok !== true) {
        if (attempt.budgetExhausted !== true) errors.push('journey ' + item.index + ' attempt ' + attempt.attempt + ' did not exit 0')
      } else if (attempt.exitCode !== 0) errors.push('journey ' + item.index + ' attempt ' + attempt.attempt + ' did not exit 0')
      if (attempt.buildSha256 !== build?.combinedSha256) errors.push('journey ' + item.index + ' attempt ' + attempt.attempt + ' has no current buildSha256')
      if (!isTime(attempt.startedAt) || !isTime(attempt.finishedAt)) errors.push('journey ' + item.index + ' attempt ' + attempt.attempt + ' has no real timestamps')
      if (typeof attempt.stdoutArtifact !== 'string' || !attempt.stdoutArtifact) errors.push('journey ' + item.index + ' attempt ' + attempt.attempt + ' has no stdout artifact')
      else if (seenArtifacts.has(attempt.stdoutArtifact)) errors.push('journey ' + item.index + ' attempts reuse the same stdout artifact')
      else seenArtifacts.add(attempt.stdoutArtifact)
      if (!isHash(attempt.stdoutSha256)) errors.push('journey ' + item.index + ' attempt ' + attempt.attempt + ' has no stdout sha256')
      if (root && typeof attempt.stdoutArtifact === 'string' && attempt.stdoutArtifact) {
        const logFile = path.resolve(root, attempt.stdoutArtifact)
        if (!fs.existsSync(logFile)) errors.push('journey ' + item.index + ' stdout artifact is missing')
        else if (isHash(attempt.stdoutSha256) && fileSha256(logFile) !== attempt.stdoutSha256) errors.push('journey ' + item.index + ' stdout hash does not match its artifact')
      }
    }
  }
  return result(errors)
}

export function validatePack(pack, options = {}) {
  const errors = []
  if (!pack || typeof pack !== 'object') return result(['missing pack report'])
  if (pack.passed !== true) errors.push('pack report is not passed')
  if (!['verify-package', 'fresh-pack'].includes(pack.mode)) errors.push('pack mode is neither verify-package nor fresh-pack')
  if (pack.asarSha256 !== options.asarSha) errors.push('pack asar hash does not match the current archive')
  if (pack.sourceShellSha256 !== options.sourceShellSha) errors.push('pack source-shell hash is stale')
  if (!sameBuild(pack.buildFingerprint, options.distBuild)) errors.push('pack build fingerprint does not match the current dist')
  if (!Array.isArray(pack.checks) || pack.checks.length === 0 || pack.checks.some(item => item.passed !== true)) errors.push('pack has failed or missing checks')
  const manifest = pack.distManifest
  if (!manifest || manifest.algorithm !== 'sha256') errors.push('pack has no complete sha256 dist manifest')
  else {
    if (manifest.digest !== options.distManifestDigest) errors.push('pack dist manifest digest does not match the current dist')
    if (!Number.isInteger(manifest.fileCount) || manifest.fileCount < 1) errors.push('pack dist manifest has no file count')
    for (const key of ['missingInAsar', 'missingInDist', 'different']) {
      if (!Array.isArray(manifest[key])) errors.push('pack dist manifest lacks ' + key)
      else if (manifest[key].length) errors.push('pack dist manifest ' + key + ' is not empty')
    }
  }
  return result(errors)
}

export function validateSecrets(secrets, options = {}) {
  const errors = []
  if (!secrets || typeof secrets !== 'object') return result(['missing secrets report'])
  if (secrets.passed !== true) errors.push('secrets report is not passed')
  if (!Array.isArray(secrets.findings) || secrets.findings.length !== 0) errors.push('secrets findings are not empty')
  if (!Array.isArray(secrets.patternIds) || REQUIRED_SECRET_PATTERNS.some(id => !secrets.patternIds.includes(id))) errors.push('secrets report lacks required pattern ids')
  if (secrets.buildSha256 !== options.build?.combinedSha256) errors.push('secrets buildSha256 is stale')
  if (secrets.sourceShellSha256 !== options.sourceShellSha) errors.push('secrets sourceShellSha256 is stale')
  const manifest = secrets.scanManifest
  if (!manifest || manifest.algorithm !== 'sha256') errors.push('secrets has no sha256 scan manifest')
  else {
    if (!isHash(manifest.digest)) errors.push('secrets scan manifest digest is missing')
    if (!Number.isInteger(manifest.fileCount) || manifest.fileCount < 1) errors.push('secrets scan manifest has no file count')
    if (manifest.distDigest !== options.distManifestDigest) errors.push('secrets scan manifest dist digest is stale')
    if (manifest.sourceShellSha256 !== options.sourceShellSha) errors.push('secrets scan manifest source-shell hash is stale')
  }
  if (options.requireFinalAggregate) {
    const scanned = Array.isArray(secrets.scannedAggregateFiles) ? secrets.scannedAggregateFiles : []
    if (!scanned.some(file => /final-aggregate-latest\.json$/.test(String(file).replaceAll(path.sep, '/')))) errors.push('the last secrets scan did not include final-aggregate-latest.json')
    if (!isHash(secrets.lastScan?.finalAggregateSha256)) errors.push('the last secrets scan did not record the final aggregate hash')
  }
  return result(errors)
}

export function validateSourceSmoke(smoke, options = {}) {
  const errors = []
  if (!smoke || typeof smoke !== 'object') return result(['missing source-shell smoke report'])
  if (smoke.passed !== true) errors.push('source-shell smoke is not passed')
  if (smoke.artifactSha256 !== options.sourceShellSha) errors.push('source-shell smoke artifact hash is stale')
  if (smoke.sourceShellDistDigest !== options.sourceShellDistDigest) errors.push('source-shell smoke dist digest is stale')
  if (!sameBuild(smoke.buildFingerprint, options.build)) errors.push('source-shell smoke build fingerprint is stale')
  if (smoke.compilation?.buildRunByAudit !== false) errors.push('source-shell smoke did not use a prebuilt artifact')
  if (smoke.checks?.mainAppBootstrapObserved !== true || smoke.checks?.appShellMounted !== true) errors.push('source-shell smoke lacks bootstrap/app-shell checks')
  if (smoke.profileRemoved !== true) errors.push('source-shell smoke profile cleanup is not proven')
  return result(errors)
}

export function validateAutomated(items, options = {}) {
  const errors = []
  const expected = options.expectedIds || AUTOMATED_IDS
  if (!Array.isArray(items)) return result(['automated items is not an array'])
  const ids = items.map(item => item?.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  const missing = expected.filter(id => !ids.includes(id))
  const extra = ids.filter(id => !expected.includes(id))
  if (items.length !== expected.length) errors.push('expected exactly ' + expected.length + ' automated items, got ' + items.length)
  if (duplicates.length) errors.push('duplicate automated ids: ' + [...new Set(duplicates)].join(','))
  if (missing.length) errors.push('missing automated ids: ' + missing.join(','))
  if (extra.length) errors.push('unexpected automated ids: ' + extra.join(','))
  for (const item of items) if (item?.passed !== true) errors.push(item?.id + ' is not passed')
  return result(errors)
}

export function validateCapture(capture, index, options = {}) {
  const errors = []
  const sourceShellSha = options.sourceShellSha
  if (!capture || typeof capture !== 'object') errors.push('missing capture report')
  else {
    if (!Array.isArray(capture.failures) || capture.failures.length !== 0) errors.push('capture failures are not empty')
    if (capture.sourceShellSha256 !== sourceShellSha) errors.push('capture source-shell hash is stale')
    if (capture.summary?.capturablePending !== 0) errors.push('capture still has capturablePending rows')
    if (!(capture.summary?.surfaceCaptured >= 65)) errors.push('capture surfaceCaptured is below 65')
  }
  if (!index || typeof index !== 'object') errors.push('missing acceptance index')
  else {
    if (!Array.isArray(index.validationErrors) || index.validationErrors.length !== 0) errors.push('acceptance index has validation errors')
    if (index.capturablePending !== 0) errors.push('acceptance index still has capturablePending rows')
    if (!(index.surfaceCaptured >= 65)) errors.push('acceptance index surfaceCaptured is below 65')
    if (index.featureVerified !== 0) errors.push('featureVerified must not be claimed')
    if (index.manualAcceptance !== 'pending') errors.push('manualAcceptance must remain pending')
    if (Number(index.unfinishedMatrixCount) !== Number(options.expectedUnfinished)) errors.push('acceptance index unfinished matrix count is stale')
    if (index.build?.sourceShellSha256 !== sourceShellSha) errors.push('acceptance index source-shell hash is stale')
  }
  return result(errors)
}

export function validatePackaged(packaged, options = {}) {
  const errors = []
  if (!packaged || typeof packaged !== 'object') return result(['missing packaged GUI report'])
  if (packaged.passed !== true) errors.push('packaged GUI report is not passed')
  if (!sameBuild(packaged.buildFingerprint, options.build)) errors.push('packaged GUI build fingerprint is stale')
  if (packaged.sourceShellSha256 !== options.sourceShellSha) errors.push('packaged GUI source-shell hash is stale')
  if (packaged.archive?.sha256 !== options.asarSha) errors.push('packaged GUI archive hash is stale')
  if (packaged.executable?.sha256 !== options.executableSha) errors.push('packaged GUI executable hash is stale')
  if (packaged.routes?.defaultRoute !== '/app/chat') errors.push('packaged GUI default route is not /app/chat')
  if (packaged.cleanup?.pidExited !== true || packaged.cleanup?.profileRemoved !== true || packaged.cleanup?.originalProfileTouched !== false) errors.push('packaged GUI cleanup is not proven')
  return result(errors)
}

export function validateAb(ab, options = {}) {
  const errors = []
  const root = options.root || process.cwd()
  if (!ab || typeof ab !== 'object') return result(['missing A/B report'])
  if (ab.passed !== true) errors.push('A/B report is not passed')
  if (ab.tableComplete !== true) errors.push('A/B table is incomplete')
  if (ab.aCriticalSupported !== true || ab.bCriticalSupported !== true) errors.push('A/B critical dimensions are not supported')
  if (ab.buildSha256 !== options.build?.combinedSha256) errors.push('A/B buildSha256 is stale')
  if (ab.sourceShellSha256 !== options.sourceShellSha) errors.push('A/B source-shell hash is stale')
  if (!Array.isArray(ab.dimensions)) return result([...errors, 'A/B dimensions is not an array'])
  const ids = ab.dimensions.map(item => item?.id)
  for (const id of AB_DIMENSIONS) if (!ids.includes(id)) errors.push('A/B missing dimension ' + id)
  for (const id of ids) if (!AB_DIMENSIONS.includes(id)) errors.push('A/B unexpected dimension ' + id)
  for (const dimension of ab.dimensions) {
    for (const side of ['A', 'B']) {
      const evidence = dimension?.[side]?.evidence
      if (!evidence || evidence.missing === true) { errors.push('A/B ' + dimension?.id + ' ' + side + ' evidence is missing'); continue }
      const file = path.resolve(root, evidence.path)
      if (!fs.existsSync(file)) errors.push('A/B ' + dimension.id + ' ' + side + ' evidence file is missing')
      else if (isHash(evidence.sha256) && fileSha256(file) !== evidence.sha256) errors.push('A/B ' + dimension.id + ' ' + side + ' evidence hash is stale')
    }
  }
  return result(errors)
}

export function countUnfinishedMatrix(matrixText) {
  return String(matrixText).split(/\r?\n/).filter(line => {
    if (!line.startsWith('|')) return false
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(value => value.trim())
    return cells.some(value => /^(PARTIALLY_MIGRATED|BLOCKED|MISSING|NOT_IMPLEMENTED|REIMPLEMENTED)$/.test(value))
  }).length
}
