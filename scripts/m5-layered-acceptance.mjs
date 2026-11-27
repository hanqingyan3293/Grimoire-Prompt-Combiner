#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { buildFingerprint } from './journey-evidence.mjs'
import { countUnfinishedMatrix } from './m5-evidence.mjs'

export const LAYERED_ACCEPTANCE_PATH = 'artifacts/m5/layered-delivery-acceptance.json'
export const LAYERED_ACCEPTANCE_STATUS = 'automated-passed-layered-accepted-manual-pending'
export const LAYERED_OPTION_LABEL = '接受当前分层交付'
export const LAYERED_OBSERVED_DATE = '2026-11-05'
export const LAYERED_QUESTION_ID = 'layered-delivery-acceptance'
export const FEATURE_MANIFEST_PATH = '.agent/MIGRATION_MATRIX.md'
export const CATALOG_PATH = 'artifacts/cherry-ui-catalog/截图清单.json'

const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const rel = (root, file) => path.relative(root, file).replaceAll(path.sep, '/')
const isPending = value => value === 'pending'

function walkFiles(dir) {
  const files = []
  const walk = current => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk(dir)
  return files.sort()
}

export function computeFeatureManifestBinding(root = process.cwd()) {
  const absolute = path.join(root, FEATURE_MANIFEST_PATH)
  if (!fs.existsSync(absolute)) return { path: FEATURE_MANIFEST_PATH, sha256: null, unfinishedCount: null, missing: true }
  return {
    path: FEATURE_MANIFEST_PATH,
    sha256: fileSha256(absolute),
    unfinishedCount: countUnfinishedMatrix(fs.readFileSync(absolute, 'utf8')),
    missing: false,
  }
}

export function computeCurrentBuildBinding(root = process.cwd()) {
  const distFiles = walkFiles(path.join(root, 'dist'))
  const sourceShellDir = path.join(root, 'src/vendor/cherry/compat/dist-source-shell')
  const sourceShell = path.join(sourceShellDir, 'source-shell.html')
  const sourceShellFiles = walkFiles(sourceShellDir)
  const build = buildFingerprint([...distFiles, ...(fs.existsSync(sourceShell) ? [sourceShell] : [])], { root })
  const distBuild = buildFingerprint(distFiles, { root })
  return {
    build,
    distBuild,
    sourceShellSha256: fs.existsSync(sourceShell) ? fileSha256(sourceShell) : null,
    sourceShellFileCount: sourceShellFiles.length,
  }
}

export function readLayeredDeliveryAcceptance({ root = process.cwd(), recordPath = LAYERED_ACCEPTANCE_PATH } = {}) {
  const absolute = path.resolve(root, recordPath)
  if (!fs.existsSync(absolute)) return { path: recordPath, absolute, sha256: null, record: null, error: 'absent' }
  const sha256 = fileSha256(absolute)
  try {
    return { path: recordPath, absolute, sha256, record: JSON.parse(fs.readFileSync(absolute, 'utf8')), error: null }
  } catch (error) {
    return { path: recordPath, absolute, sha256, record: null, error: 'invalid-json: ' + error.message }
  }
}

function invalid(reasonCode, message, base) {
  return { ...base, reasonCode, errors: message ? [message] : [] }
}

export function evaluateLayeredDeliveryAcceptance(options = {}) {
  const recordPath = options.recordPath || LAYERED_ACCEPTANCE_PATH
  const recordSha256 = options.recordSha256 || null
  const base = {
    accepted: false,
    status: 'pending',
    reasonCode: 'absent-decision',
    errors: [],
    record: recordPath,
    recordSha256,
    buildBound: false,
    scope: null,
    userChoice: null,
    questionId: null,
    optionLabel: null,
    scopeDescription: null,
    observedDate: null,
    exactConfirmationTime: null,
    acceptedScope: null,
    exclusions: null,
    manualAcceptance: 'pending',
    blockedAcceptance: 'pending',
    gapDispositionAcceptance: 'pending',
    itemAcceptance: { surfaceRows: 'pending', blockedRows: 'pending' },
    perItemAcceptanceApplied: false,
    fullPlanComplete: false,
    surfaceRowCount: Array.isArray(options.surfaceRows) ? options.surfaceRows.length : null,
    blockedRowCount: Array.isArray(options.blockedRows) ? options.blockedRows.length : null,
  }

  const record = options.record
  if (!record || typeof record !== 'object') return invalid('absent-decision', 'no layered-delivery acceptance record', base)
  if (record.kind !== 'layered-delivery-acceptance' || record.scope !== 'layered-delivery') {
    return invalid('invalid-record', 'record kind/scope is not layered-delivery-acceptance', base)
  }
  if (record.decision !== 'accepted') return invalid('not-accepted', 'record decision is not accepted', base)
  if (record.userChoice !== LAYERED_OPTION_LABEL || record.optionLabel !== LAYERED_OPTION_LABEL) {
    return invalid('choice-mismatch', 'user choice and option label must be the exact layered-delivery label', base)
  }
  if (typeof record.questionId !== 'string' || !record.questionId.trim()) return invalid('invalid-record', 'question id is missing', base)
  if (typeof record.scopeDescription !== 'string' || !record.scopeDescription.trim()) return invalid('invalid-record', 'scope description is missing', base)
  if (record.observedDate !== LAYERED_OBSERVED_DATE) return invalid('invalid-date', 'observed date must be ' + LAYERED_OBSERVED_DATE, base)
  if (record.exactConfirmationTime !== null) return invalid('time-overclaim', 'exact confirmation time must stay null', base)
  if (record.gapDispositionAcceptance !== 'inventory-acknowledged') {
    return invalid('gap-disposition-invalid', 'gap disposition must be inventory-acknowledged', base)
  }
  if (!isPending(record.itemAcceptance?.surfaceRows) || !isPending(record.itemAcceptance?.blockedRows)) {
    return invalid('item-acceptance', 'per-row surface and blocked acceptance must stay pending', base)
  }
  if (record.fullPlanComplete !== false) return invalid('full-plan-complete', 'a scoped acceptance must not claim the full plan is complete', base)

  const accepted = record.acceptedScope
  const scopedOk = accepted
    && accepted.automatedAcceptance?.status === 'automated-passed'
    && accepted.automatedAcceptance?.gates === 'G1-G14'
    && Number(accepted.automatedAcceptance?.automatedItems) === 10
    && Number(accepted.surfaceCaptures?.captured) === 65
    && Number(accepted.surfaceCaptures?.total) === 79
    && Number(accepted.surfaceCaptures?.pending) === 14
    && Number(accepted.surfaceCaptures?.featureVerified) === 0
    && accepted.blockerInventory?.disclosed === true
    && Number(accepted.blockerInventory?.unfinishedMatrixRows) === 53
  if (!scopedOk) return invalid('scope-invalid', 'accepted scope must name automated gates, 65/79 captures, and the 53-row disclosed inventory', base)

  const exclusions = record.exclusions
  const exclusionsOk = exclusions
    && Number(exclusions.pendingSurfaceRows?.count) === 14
    && isPending(exclusions.pendingSurfaceRows?.manualAcceptance)
    && Number(exclusions.unfinishedMatrixRows?.count) === 53
    && exclusions.unfinishedMatrixRows?.implemented === false
    && isPending(exclusions.unfinishedMatrixRows?.userAcceptance)
    && exclusions.blockedCapabilities?.implemented === false
    && isPending(exclusions.blockedCapabilities?.blockedAcceptance)
  if (!exclusionsOk) return invalid('exclusions-invalid', 'exclusions must keep pending rows and blocked capabilities unimplemented and pending', base)

  if (!isHash(recordSha256)) return invalid('record-sha-missing', 'record sha256 is missing or invalid', base)

  const currentBuild = options.build
  const boundBuild = record.binding?.build
  if (!currentBuild || !isHash(currentBuild.combinedSha256) || !boundBuild) return invalid('build-mismatch', 'current build binding is missing', base)
  if (boundBuild.combinedSha256 !== currentBuild.combinedSha256 || Number(boundBuild.fileCount) !== Number(currentBuild.fileCount)) {
    return invalid('build-mismatch', 'acceptance record is bound to another build', base)
  }

  const boundManifest = record.binding?.featureManifest
  if (!boundManifest) return invalid('manifest-missing', 'acceptance record has no feature manifest binding', base)
  const currentManifest = options.featureManifest
  if (!currentManifest || !isHash(currentManifest.sha256)) return invalid('manifest-missing', 'current feature manifest binding is missing', base)
  const expectedUnfinished = Number(options.expectedUnfinished ?? currentManifest.unfinishedCount)
  if (boundManifest.sha256 !== currentManifest.sha256
    || Number(boundManifest.unfinishedCount) !== expectedUnfinished
    || Number(currentManifest.unfinishedCount) !== expectedUnfinished) {
    return invalid('manifest-mismatch', 'acceptance record is bound to another feature manifest', base)
  }

  if (options.surface) {
    const surface = options.surface
    if (Number(surface.total) !== 79
      || Number(surface.surfaceCaptured) !== 65
      || Number(surface.pending) !== 14
      || Number(surface.featureVerified ?? 0) !== 0) {
      return invalid('surface-mismatch', 'current surface capture counts do not match the accepted scope', base)
    }
  }

  return {
    ...base,
    accepted: true,
    status: LAYERED_ACCEPTANCE_STATUS,
    reasonCode: null,
    errors: [],
    buildBound: true,
    scope: record.scope,
    userChoice: record.userChoice,
    questionId: record.questionId,
    optionLabel: record.optionLabel,
    scopeDescription: record.scopeDescription,
    observedDate: record.observedDate,
    exactConfirmationTime: null,
    acceptedScope: record.acceptedScope,
    exclusions: record.exclusions,
    gapDispositionAcceptance: record.gapDispositionAcceptance,
    itemAcceptance: { surfaceRows: 'pending', blockedRows: 'pending' },
    perItemAcceptanceApplied: false,
    fullPlanComplete: false,
  }
}

export function buildLayeredDeliveryAcceptanceRecord({ build, featureManifest, surface, observedDate = LAYERED_OBSERVED_DATE }) {
  if (!build || !isHash(build.combinedSha256)) throw new Error('current build fingerprint is required')
  if (!featureManifest || !isHash(featureManifest.sha256)) throw new Error('current feature manifest binding is required')
  if (!surface || Number(surface.total) !== 79 || Number(surface.surfaceCaptured) !== 65
    || Number(surface.pending) !== 14 || Number(surface.featureVerified ?? 0) !== 0) {
    throw new Error('surface capture counts must be 65 captured / 14 pending / 0 feature-verified')
  }
  return {
    schemaVersion: 1,
    kind: 'layered-delivery-acceptance',
    scope: 'layered-delivery',
    decision: 'accepted',
    userChoice: LAYERED_OPTION_LABEL,
    questionId: LAYERED_QUESTION_ID,
    questionIdSource: 'stable logical id assigned in this record; the originating UI question id was not present in the available session context',
    optionLabel: LAYERED_OPTION_LABEL,
    scopeDescription: 'Accept the current layered delivery: automated acceptance results bound to this build, 65 verified surface captures, and the disclosed blocker inventory. Pending surface rows, unfinished migration-matrix rows, and BLOCKED/NOT_IMPLEMENTED capabilities remain unimplemented and individually pending.',
    observedDate,
    exactConfirmationTime: null,
    acceptedScope: {
      automatedAcceptance: { gates: 'G1-G14', automatedItems: 10, status: 'automated-passed' },
      surfaceCaptures: { captured: 65, total: 79, pending: 14, featureVerified: 0 },
      blockerInventory: { disclosed: true, unfinishedMatrixRows: Number(featureManifest.unfinishedCount) },
    },
    exclusions: {
      pendingSurfaceRows: { count: 14, manualAcceptance: 'pending' },
      unfinishedMatrixRows: { count: Number(featureManifest.unfinishedCount), implemented: false, userAcceptance: 'pending' },
      blockedCapabilities: { implemented: false, blockedAcceptance: 'pending' },
    },
    gapDispositionAcceptance: 'inventory-acknowledged',
    itemAcceptance: { surfaceRows: 'pending', blockedRows: 'pending' },
    fullPlanComplete: false,
    binding: {
      build: {
        combinedSha256: build.combinedSha256,
        fileCount: Number(build.fileCount),
        distSha256: build.distSha256 ?? null,
        sourceShellSha256: build.sourceShellSha256 ?? null,
      },
      featureManifest: {
        path: featureManifest.path,
        sha256: featureManifest.sha256,
        unfinishedCount: Number(featureManifest.unfinishedCount),
      },
    },
  }
}

export function writeLayeredDeliveryAcceptance({ root = process.cwd(), recordPath = LAYERED_ACCEPTANCE_PATH, build, featureManifest, surface }) {
  const record = buildLayeredDeliveryAcceptanceRecord({ build, featureManifest, surface })
  const absolute = path.resolve(root, recordPath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, JSON.stringify(record, null, 2) + String.fromCharCode(10))
  return { path: recordPath, absolute, sha256: fileSha256(absolute), record }
}

function catalogSurface(root) {
  const file = path.join(root, CATALOG_PATH)
  if (!fs.existsSync(file)) throw new Error('catalog manifest is missing: ' + CATALOG_PATH)
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  const summary = manifest.captureSummary || {}
  return {
    total: Array.isArray(manifest.items) ? manifest.items.length : null,
    surfaceCaptured: Number(summary.surfaceCaptured),
    pending: Number(summary.pending),
    featureVerified: Number(summary.featureVerified ?? 0),
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const root = process.cwd()
  const current = computeCurrentBuildBinding(root)
  const build = { ...current.build, distSha256: current.distBuild.combinedSha256, sourceShellSha256: current.sourceShellSha256 }
  const featureManifest = computeFeatureManifestBinding(root)
  const surface = catalogSurface(root)
  if (process.argv.includes('--write')) {
    const written = writeLayeredDeliveryAcceptance({ root, build, featureManifest, surface })
    console.log(JSON.stringify({ record: written.path, recordSha256: written.sha256, build: build.combinedSha256, featureManifestSha256: featureManifest.sha256, surface }, null, 2))
  } else {
    const read = readLayeredDeliveryAcceptance({ root })
    const result = evaluateLayeredDeliveryAcceptance({ record: read.record, recordPath: read.path, recordSha256: read.sha256, build, featureManifest, surface, expectedUnfinished: featureManifest.unfinishedCount })
    console.log(JSON.stringify({ accepted: result.accepted, status: result.status, reasonCode: result.reasonCode, errors: result.errors, record: result.record, recordSha256: result.recordSha256, buildBound: result.buildBound }, null, 2))
    process.exitCode = result.accepted ? 0 : 1
  }
}
