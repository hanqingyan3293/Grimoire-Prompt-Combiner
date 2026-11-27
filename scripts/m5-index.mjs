#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { verifiedCapture, fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { buildFingerprint } from './journey-evidence.mjs'
import { manifestDigest } from './m5-evidence.mjs'
import {
  LAYERED_ACCEPTANCE_STATUS,
  computeFeatureManifestBinding,
  evaluateLayeredDeliveryAcceptance,
  readLayeredDeliveryAcceptance,
} from './m5-layered-acceptance.mjs'
const root = process.cwd()
const startedAt = Date.now()
const directory = path.join(root, 'artifacts/cherry-ui-catalog')
const manifest = JSON.parse(fs.readFileSync(path.join(directory, '截图清单.json'), 'utf8'))
const sourceShell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
const buildSha256 = fs.existsSync(sourceShell) ? fileSha256(sourceShell) : null
const walkFiles = dir => {
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
const distFiles = walkFiles(path.join(root, 'dist'))
const sourceShellFiles = walkFiles(path.join(root, 'src/vendor/cherry/compat/dist-source-shell'))
const build = buildFingerprint([...distFiles, ...(buildSha256 ? [sourceShell] : [])], { root })
const distBuild = buildFingerprint(distFiles, { root })
const sourceShellDistDigest = manifestDigest(sourceShellFiles.map(file => ({ path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: fileSha256(file) })))
const isDiagnostic = item => /受阻|不可用|非渲染器|diagnostic|blocked/i.test(String(item.status) + ' ' + String(item.kind))
const isNonRenderer = item => item.status === '非渲染器' || (!item.route && item.window)
const concreteBlocker = item => item.blocker || item.captureEvidence?.blockedReason || item.note || (item.sequence === 79
  ? 'Source AgentPage renders in the isolated source shell, but runtime execution, approval and recovery are not proven by this surface capture.'
  : null)

const validationErrors = []
const items = manifest.items.map(item => {
  const surfaceCaptured = buildSha256 ? verifiedCapture(item, directory, { buildSha256 }) : false
  const blocker = isDiagnostic(item) || isNonRenderer(item) ? concreteBlocker(item) : null
  if ((isDiagnostic(item) || isNonRenderer(item)) && !blocker) validationErrors.push({ sequence: item.sequence, name: item.name, error: 'blocked/non-renderer row has no concrete reason' })
  const reason = surfaceCaptured
    ? blocker
    : item.captureEvidence?.noPngReason || blocker || (item.capture === 'passed' ? 'Capture evidence is stale or lacks action/route/build/IHDR/bounds binding; recapture required' : item.note || 'No verified live capture')
  return {
    sequence: item.sequence,
    name: item.name,
    route: item.route || item.window || null,
    status: surfaceCaptured ? 'captured' : 'pending',
    surfaceCaptured,
    verificationKind: isDiagnostic(item) || isNonRenderer(item) ? 'diagnostic-only' : 'surface-capture-only',
    featureVerified: false,
    featureAccepted: false,
    manualAcceptance: 'pending',
    screenshot: item.screenshot || null,
    blocker,
    reason,
    captureRun: item.captureEvidence?.run || null
  }
})
const matrixLines = fs.readFileSync(path.join(root, '.agent/MIGRATION_MATRIX.md'), 'utf8').split(/\r?\n/)
const unfinished = matrixLines.flatMap((line, index) => {
  if (!line.startsWith('|')) return []
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(value => value.trim())
  const status = cells.find(value => /^(PARTIALLY_MIGRATED|BLOCKED|MISSING|NOT_IMPLEMENTED|REIMPLEMENTED)$/.test(value))
  if (!status) return []
  return [{ feature: cells[0], status, line: index + 1, evidenceAndUnblock: cells.slice(-1)[0], userAcceptance: 'pending', blockedAcceptance: 'pending' }]
})
const nonRendererSequences = new Set(manifest.items.filter(row => row.status === '非渲染器').map(row => row.sequence))
const interactionKinds = new Set(['context-menu', 'quick-panel', 'dialog'])
const routeKind = item => typeof item.route === 'string' && item.route.startsWith('/')
const kindOf = sequence => manifest.items.find(row => row.sequence === sequence)?.kind
const capturablePending = items.filter(item => item.status !== 'captured' && routeKind(item) && !interactionKinds.has(kindOf(item.sequence)) && !nonRendererSequences.has(item.sequence))
const interactionPending = items.filter(item => item.status !== 'captured' && interactionKinds.has(kindOf(item.sequence)))
const windowPending = items.filter(item => item.status !== 'captured' && !routeKind(item) && !interactionKinds.has(kindOf(item.sequence)) && !nonRendererSequences.has(item.sequence))
const nonRendererPending = items.filter(item => !item.surfaceCaptured && nonRendererSequences.has(item.sequence))
const featureManifest = computeFeatureManifestBinding(root)
const layeredRead = readLayeredDeliveryAcceptance({ root })
const layered = evaluateLayeredDeliveryAcceptance({
  record: layeredRead.record,
  recordPath: layeredRead.path,
  recordSha256: layeredRead.sha256,
  build,
  featureManifest,
  surface: {
    total: items.length,
    surfaceCaptured: items.filter(item => item.surfaceCaptured).length,
    pending: items.filter(item => !item.surfaceCaptured).length,
    featureVerified: 0,
  },
  expectedUnfinished: unfinished.length,
})
const layeredAcceptance = {
  accepted: layered.accepted,
  record: layered.record,
  recordSha256: layered.recordSha256,
  buildBound: layered.buildBound,
  reasonCode: layered.reasonCode,
  errors: layered.errors,
  itemAcceptance: layered.itemAcceptance,
  fullPlanComplete: layered.fullPlanComplete,
}
const report = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  exitCode: (capturablePending.length || validationErrors.length) ? 1 : 0,
  build: { combinedSha256: build.combinedSha256, fileCount: build.fileCount, distSha256: distBuild.combinedSha256, distFileCount: distBuild.fileCount, sourceShellSha256: buildSha256, sourceShellDistDigest },
  featureManifest: { path: featureManifest.path, sha256: featureManifest.sha256, unfinishedCount: featureManifest.unfinishedCount },
  status: layered.accepted ? LAYERED_ACCEPTANCE_STATUS : 'manual-pending',
  manualAcceptance: 'pending',
  blockedAcceptance: 'pending',
  gapDispositionAcceptance: layered.accepted ? 'inventory-acknowledged' : 'pending',
  layeredDeliveryAcceptance: layeredAcceptance,
  total: items.length,
  surfaceCaptured: items.filter(item => item.surfaceCaptured).length,
  featureVerified: 0,
  featureAccepted: 0,
  pending: items.filter(item => !item.surfaceCaptured).length,
  capturablePending: capturablePending.length,
  interactionPending: interactionPending.length,
  windowPending: windowPending.length,
  nonRendererPending: nonRendererPending.length,
  validationErrors,
  items,
  unfinishedMatrixCount: unfinished.length,
  unfinishedMatrix: unfinished
}
const out = path.join(root, 'artifacts/m5')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'acceptance-index.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll(String.fromCharCode(10), ' ')
const md = [
  '# M5 人工验收索引',
  '',
  '构建：source-shell SHA-256 ' + (buildSha256 ?? 'missing'),
  '',
  '总数 ' + report.total + '；surfaceCaptured ' + report.surfaceCaptured + '；featureVerified ' + report.featureVerified + '；pending ' + report.pending + '；capturablePending ' + report.capturablePending + '；interactionPending ' + report.interactionPending + '；windowPending ' + report.windowPending + '；nonRendererPending ' + report.nonRendererPending + '。',
  '',
  '截图只证明表面已捕获；featureAccepted 一律 false，manualAcceptance=pending。',
  '分层交付接受：' + (layered.accepted ? 'accepted（仅限记录范围）' : 'not accepted') + '；record=' + (layered.record ?? 'missing') + '；recordSha256=' + (layered.recordSha256 ?? 'missing') + '；buildBound=' + layered.buildBound + '。',
  'manualAcceptance=pending；blockedAcceptance=pending；gapDispositionAcceptance=' + report.gapDispositionAcceptance + '；fullPlanComplete=false。',
  '',
  '|序号|名称|路由|自动证据|功能验收|pending/受阻原因|',
  '|---|---|---|---|---|---|',
  ...items.map(item => '|' + item.sequence + '|' + escape(item.name) + '|' + escape(item.route) + '|' + item.status + '|pending|' + escape(item.reason) + '|'),
  '',
  '## 全部未完成matrix条目与隐藏blocker',
  '',
  '|名称|状态|解除条件/缺项/现有证据原文|用户接受|',
  '|---|---|---|---|',
  ...unfinished.map(item => '|' + escape(item.feature) + '|' + item.status + '|' + escape(item.evidenceAndUnblock) + '|pending|')
]
fs.writeFileSync(path.join(out, 'acceptance-index.md'), md.join(String.fromCharCode(10)) + String.fromCharCode(10))
console.log(JSON.stringify({ status: report.status, total: report.total, surfaceCaptured: report.surfaceCaptured, featureVerified: report.featureVerified, pending: report.pending, capturablePending: report.capturablePending, interactionPending: report.interactionPending, windowPending: report.windowPending, nonRendererPending: report.nonRendererPending, validationErrors: validationErrors.length, unfinishedMatrix: unfinished.length, manualAcceptance: report.manualAcceptance, blockedAcceptance: report.blockedAcceptance, gapDispositionAcceptance: report.gapDispositionAcceptance, layeredDeliveryAcceptance: report.layeredDeliveryAcceptance, build: buildSha256, index: 'artifacts/m5/acceptance-index.md' }))
process.exitCode = report.exitCode
