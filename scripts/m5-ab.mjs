#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { buildFingerprint } from './journey-evidence.mjs'
const root = process.cwd()
const startedAt = Date.now()
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
const shellFile = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
const build = buildFingerprint([...distFiles, ...(fs.existsSync(shellFile) ? [shellFile] : [])], { root })
const rel = file => path.relative(root, file).replaceAll(path.sep, '/')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const evidence = file => !file ? { path: null, missing: true } : fs.existsSync(file) ? { path: rel(file), sha256: fileSha256(file), generatedAt: readJsonSafe(file)?.generatedAt ?? readJsonSafe(file)?.startedAt ?? readJsonSafe(file)?.runId ?? null } : { path: rel(file), missing: true }
function readJsonSafe(file) { try { return readJson(file) } catch { return null } }
function latestFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).map(name => path.join(dir, name)).filter(file => predicate(path.basename(file)))
  return files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1) || null
}
function parseStreamSmoke() {
  const file = latestFile(path.join(root, 'artifacts/m5'), name => /^stream-smoke-.*.stdout.log$/.test(name))
  if (!file) return { file: null, data: null }
  const text = fs.readFileSync(file, 'utf8')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let data = null
  try { data = JSON.parse(text.slice(start, end + 1)) } catch {}
  return { file, data }
}
function sourceShellSmoke() {
  const dir = path.join(root, 'artifacts/source-shell')
  const latest = latestFile(dir, () => true)
  const candidates = fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)).filter(file => fs.existsSync(path.join(file, 'smoke.json'))) : []
  const chosen = candidates.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1) || latest
  if (!chosen) return { file: null, data: null }
  const file = path.join(chosen, 'smoke.json')
  return { file, data: readJsonSafe(file) }
}

const aEntry = path.join(root, 'dist/cherry-compat/index.html')
const bEntry = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
const packaged = readJsonSafe(path.join(root, 'artifacts/m5/packaged-gui-latest.json'))
const packagedFile = path.join(root, 'artifacts/m5/packaged-gui-latest.json')
const stream = parseStreamSmoke()
const source = sourceShellSmoke()
const catalog = readJsonSafe(path.join(root, 'artifacts/m5/acceptance-index.json'))
const pack = readJsonSafe(path.join(root, 'artifacts/m5/pack-report.json'))
const journeyArg = process.argv.find(arg => arg.startsWith('--journeys='))?.slice('--journeys='.length)
const journeyFile = journeyArg ? path.resolve(root, journeyArg) : latestFile(path.join(root, 'artifacts/m5'), name => /^journeys-.*\.json$/.test(name) && name !== 'journeys-latest.json')
const journeyFinal = journeyFile ? readJsonSafe(journeyFile) : null
const byIndex = new Map((journeyFinal?.results || []).map(result => [result.index, result]))
const lastAttempt = result => (result?.attempts || []).at(-1) || result
const routeAttempt = lastAttempt(byIndex.get(6))
const routeLog = routeAttempt?.stdoutArtifact ? path.join(root, routeAttempt.stdoutArtifact) : null
const routeText = routeLog && fs.existsSync(routeLog) ? fs.readFileSync(routeLog, 'utf8') : ''
const routeLines = routeText.split(String.fromCharCode(10)).map(line => line.replace(String.fromCharCode(13), ''))
const routeCount = routeLines.filter(line => line.split(' ').includes('OK')).length
const routeSummary = routeLines.find(line => line.includes(' routes rendered')) || null
const settingsWiring = lastAttempt(byIndex.get(11))
const settingsToggle = lastAttempt(byIndex.get(18))
const journeyCurrent = journeyFinal?.build?.combinedSha256 === build.combinedSha256 && journeyFinal?.build?.fileCount === build.fileCount && journeyFinal?.sourceAggregate == null
const packagedCurrent = packaged?.buildFingerprint?.combinedSha256 === build.combinedSha256 && packaged?.sourceShellSha256 === (fs.existsSync(shellFile) ? fileSha256(shellFile) : null)
const packCurrent = pack?.buildFingerprint?.combinedSha256 === buildFingerprint(distFiles, { root }).combinedSha256 && pack?.sourceShellSha256 === (fs.existsSync(shellFile) ? fileSha256(shellFile) : null)
const sourceCurrent = source.data?.artifactSha256 === (fs.existsSync(shellFile) ? fileSha256(shellFile) : null) && source.data?.buildFingerprint?.combinedSha256 === build.combinedSha256

const status = (value, evidenceRef, detail) => ({ status: value, evidence: evidenceRef, detail })
const dimensions = []
dimensions.push({
  id: 'startup',
  A: status(packagedCurrent && packaged?.passed === true && packaged?.routes?.defaultRoute === '/app/chat' ? 'supported' : 'untested', evidence(packagedFile), packagedCurrent ? 'packaged GUI opened main + compat; default compat route ' + (packaged?.routes?.defaultRoute || 'missing') + '; forcedNavigation=' + (packaged?.forcedNavigation?.length || 0) : 'packaged GUI is not bound to the current build'),
  B: status(sourceCurrent && source.data?.passed === true && source.data?.checks?.mainAppBootstrapObserved && source.data?.checks?.appShellChromeMounted ? 'supported' : 'untested', evidence(source.file), 'source-shell bootstrap/app shell checks')
})
dimensions.push({
  id: 'routes',
  A: status(journeyCurrent && routeCount === 51 && routeSummary ? 'supported' : 'untested', evidence(routeLog), routeCount + ' source routes rendered OK; ' + (routeSummary || 'summary missing')),
  B: status(sourceCurrent && source.data?.checks?.distinctRouteContent && source.data?.checks?.distinctRoutesRestore ? 'supported' : 'untested', evidence(source.file), 'distinct route content + restore; catalog surfaceCaptured=' + (catalog?.surfaceCaptured ?? 'missing') + ', featureVerified=' + (catalog?.featureVerified ?? 'missing'))
})
dimensions.push({
  id: 'tabs',
  A: status(packagedCurrent && packaged?.screenshots?.some(item => item.name === 'main-window') ? 'surface-only' : 'untested', evidence(packagedFile), 'main window workspace tabs visible in screenshot; tab switching is not asserted by this A evidence'),
  B: status(sourceCurrent && source.data?.checks?.sourceTabButtonWorks && source.data?.checks?.originalTabRestored && source.data?.checks?.newTabRestored && source.data?.checks?.closeNonHomeRetainsHome ? 'supported' : 'untested', evidence(source.file), 'real tab click/restore/close/persisted-tabs checks')
})
dimensions.push({
  id: 'chat',
  A: status(stream.data?.buildSha256 === build.combinedSha256 && stream.data?.ok === true && stream.data?.chat?.terminal?.status === 'success' && stream.data?.chat?.persisted?.text?.text === '你好，世界' ? 'supported' : 'untested', evidence(stream.file), 'fresh stream smoke: chunk sequence + persisted assistant text'),
  B: status('untested', evidence(source.file), 'source-shell smoke does not send a chat turn or stream a response')
})
dimensions.push({
  id: 'agent',
  A: status(stream.data?.buildSha256 === build.combinedSha256 && stream.data?.ok === true && stream.data?.agent?.terminal?.status === 'success' ? 'supported' : 'untested', evidence(stream.file), 'fresh stream smoke: agent session text + terminal success'),
  B: status(sourceCurrent && source.data?.checks?.agentConversationCapabilitiesAvailable && source.data?.checks?.actualSourcePersistedHistoryRendered ? 'surface-only' : 'untested', evidence(source.file), 'agent page/session CRUD/rename/new-task verified; runtime send/approval not exercised')
})
dimensions.push({
  id: 'approval',
  A: status(stream.data?.buildSha256 === build.combinedSha256 && stream.data?.ok === true && Array.isArray(stream.data?.approval?.approvalIds) && stream.data.approval.approvalIds.length > 0 && stream.data?.approval?.terminal?.status === 'success' && stream.data?.denial !== undefined ? 'supported' : 'untested', evidence(stream.file), 'approval allow terminal success plus denial error path'),
  B: status('untested', evidence(source.file), 'source-shell smoke does not drive a permission request')
})
dimensions.push({
  id: 'recovery',
  A: status('blocked', { path: 'src/main/ai/runtime/capabilities.ts', sha256: fileSha256(path.join(root, 'src/main/ai/runtime/capabilities.ts')) }, 'recovery is not-implemented; no runtime/adapter emits a recovery event'),
  B: status('untested', evidence(source.file), 'source-shell smoke does not exercise recovery')
})
dimensions.push({
  id: 'settings',
  A: status(journeyCurrent && settingsWiring?.ok === true && settingsToggle?.ok === true ? 'supported' : 'untested', settingsWiring?.ok === true ? { path: settingsWiring.stdoutArtifact.replaceAll(path.sep, '/'), sha256: fileSha256(path.join(root, settingsWiring.stdoutArtifact)) } : evidence(source.file), 'settings wiring journey + real toggle/落库 journey'),
  B: status(sourceCurrent && catalog?.surfaceCaptured > 0 && source.data?.checks?.authoritativeProviderModelFixture ? 'surface-only' : 'untested', evidence(source.file), 'settings routes render and provider/model fixture is authoritative; setting changes are not exercised')
})
dimensions.push({
  id: 'pack',
  A: status(packCurrent && packagedCurrent && pack?.passed === true && packaged?.passed === true ? 'supported' : 'untested', evidence(path.join(root, 'artifacts/m5/pack-report.json')), 'fresh asar ' + (pack?.asarSha256 || 'missing') + '; packaged GUI passed'),
  B: status('blocked', evidence(bEntry), 'B is an isolated dev-only source-shell; it is not an electron-builder target and is not packaged')
})

const aCritical = ['startup', 'routes', 'chat', 'agent', 'approval', 'settings', 'pack']
const bCritical = ['startup', 'routes', 'tabs']
const aSupported = aCritical.every(id => dimensions.find(d => d.id === id)?.A.status === 'supported')
const bSupported = bCritical.every(id => dimensions.find(d => d.id === id)?.B.status === 'supported')
const tableComplete = dimensions.every(d => ['supported', 'surface-only', 'blocked', 'untested'].includes(d.A.status) && ['supported', 'surface-only', 'blocked', 'untested'].includes(d.B.status) && d.A.evidence && d.B.evidence)
const aHash = fs.existsSync(aEntry) ? fileSha256(aEntry) : null
const bHash = fs.existsSync(bEntry) ? fileSha256(bEntry) : null
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  defaultEntry: 'A',
  defaultRoute: packaged?.routes?.defaultRoute || null,
  preserveDefaultA: true,
  A: { role: 'default compat entry', entry: rel(aEntry), exists: fs.existsSync(aEntry), sha256: aHash, bytes: fs.existsSync(aEntry) ? fs.statSync(aEntry).size : 0 },
  B: { role: 'isolated source-shell', entry: rel(bEntry), exists: fs.existsSync(bEntry), sha256: bHash, bytes: fs.existsSync(bEntry) ? fs.statSync(bEntry).size : 0 },
  sameArtifact: Boolean(aHash && aHash === bHash),
  buildSha256: build.combinedSha256,
  build,
  sourceShellSha256: fs.existsSync(shellFile) ? fileSha256(shellFile) : null,
  journeys: journeyFile ? { path: rel(journeyFile), sha256: fileSha256(journeyFile), build: journeyFinal?.build ?? null, sourceAggregate: journeyFinal?.sourceAggregate ?? null } : { missing: true },
  statusMeaning: { supported: 'functional evidence exists for this dimension', 'surface-only': 'surface renders, functional acceptance not asserted', blocked: 'explicit blocker', untested: 'no evidence in this round' },
  dimensions,
  tableComplete,
  aCriticalSupported: aSupported,
  bCriticalSupported: bSupported,
  manualAcceptance: 'pending',
  note: 'HTML hash is provenance only; it is not a functional pass. Recovery remains blocked; B chat/approval/recovery are untested.'
}
report.passed = Boolean(report.A.exists && report.B.exists && !report.sameArtifact && report.tableComplete && report.preserveDefaultA && report.aCriticalSupported && report.bCriticalSupported && journeyCurrent && packagedCurrent && packCurrent && sourceCurrent)
report.exitCode = report.passed ? 0 : 1
fs.mkdirSync(path.join(root, 'artifacts/m5'), { recursive: true })
fs.writeFileSync(path.join(root, 'artifacts/m5/ab-compare.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
const md = [
  '# A/B 入口实质对照（不是 HTML hash 对照）',
  '',
  '默认入口：A（compat hash shell），默认路由 ' + (report.defaultRoute || 'missing') + '。B 仅隔离 source-shell。manualAcceptance=pending。',
  '',
  '|维度|A 默认 compat|A 证据|B source-shell|B 证据|B 说明|',
  '|---|---|---|---|---|---|',
  ...dimensions.map(d => '|' + d.id + '|' + d.A.status + '|' + d.A.evidence.path + '|' + d.B.status + '|' + d.B.evidence.path + '|' + String(d.B.detail).replaceAll('|', '\\|') + '|'),
  '',
  '状态含义：supported=有该维度的功能证据；surface-only=只证明表面渲染；blocked=明确阻塞；untested=本轮未测。',
  '',
  'A 入口 SHA-256：' + (aHash || 'missing') + '；B 入口 SHA-256：' + (bHash || 'missing') + '。hash 只作来源绑定，不当作功能通过。',
  '',
  '已知未通过/未测：recovery（A=blocked，B=untested）；B chat/approval/recovery=untested；B pack=blocked（dev-only）。manualAcceptance 仍 pending。'
]
fs.writeFileSync(path.join(root, 'artifacts/m5/ab-compare.md'), md.join(String.fromCharCode(10)) + String.fromCharCode(10))
console.log(JSON.stringify({ passed: report.passed, tableComplete, aCriticalSupported: aSupported, bCriticalSupported: bSupported, defaultRoute: report.defaultRoute, dimensions: dimensions.map(d => ({ id: d.id, A: d.A.status, B: d.B.status })), artifact: 'artifacts/m5/ab-compare.json' }))
process.exitCode = report.passed ? 0 : 1
