#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildFingerprint } from './journey-evidence.mjs'
import { fileSha256 } from './cherry-ui-capture-evidence.mjs'
import { manifestDigest } from './m5-evidence.mjs'
const require = createRequire(import.meta.url)
const root = process.cwd()

export const PATTERNS = [
  { id: 'openai-project', re: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { id: 'anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { id: 'client-secret', re: /(?:client[_-]?secret|clientSecret)\s*[:=]\s*(?:["'][A-Za-z0-9._~+/=-]{12,}["']|[A-Za-z0-9_-]{24,})/gi },
  { id: 'authorization', re: /Authorization\s*[:=]\s*["']?(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { id: 'bearer', re: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/g },
  { id: 'openai-like', re: /sk-[A-Za-z0-9]{24,}/g },
  { id: 'github-like', re: /gh[pousr]_[A-Za-z0-9_]{24,}/g },
  { id: 'aws-key', re: /AKIA[0-9A-Z]{16}/g },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: 'quoted-secret-assignment', re: /(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']/gi }
]

// Exact path + kind + value. No directory or context-wide exemptions.
export const FIXTURE_ALLOWLIST = [
  { file: 'dist/main/main/services/agent-runtime-safety.service.test.js', kind: 'quoted-secret-assignment', value: 'must-not-inherit' },
  { file: 'dist/main/integrations/pi/modelInjection.js', kind: 'quoted-secret-assignment', value: 'cherry-managed-runtime-key' }
]

const normalize = file => String(file).replaceAll('\\', '/').replace(/^app\.asar\//, '').replace(/^\.\//, '')

export function isFixtureAllowlisted(file, kind, match) {
  const normalized = normalize(file)
  return FIXTURE_ALLOWLIST.some(entry => entry.file === normalized && entry.kind === kind && String(match).includes(entry.value))
}

export function scanText(text, file) {
  const findings = []
  const exceptions = []
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.re)) {
      const value = String(match[0])
      const line = text.slice(0, match.index).split(String.fromCharCode(10)).length
      if (isFixtureAllowlisted(file, pattern.id, value)) {
        exceptions.push({ file: normalize(file), line, kind: pattern.id })
        continue
      }
      findings.push({ file: normalize(file), line, kind: pattern.id, sample: value.slice(0, 8) + '…' })
    }
  }
  return { findings, exceptions }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const startedAt = Date.now()
  const asar = require('@electron/asar')
  const extensions = new Set(['.json', '.jsonl', '.log', '.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.css', '.map'])
  const targets = ['artifacts', 'dist']
  const excludedDirectories = new Set(['node_modules', 'docs', 'resources', 'release', '.git', '.codegraph', 'temp_archive_20260728'])
  const files = []
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (!excludedDirectories.has(entry.name)) walk(file) }
      else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(file)
    }
  }
  targets.forEach(name => walk(path.join(root, name)))
  const distFiles = []
  const walkDist = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walkDist(file)
      else distFiles.push(file)
    }
  }
  walkDist(path.join(root, 'dist'))
  const shell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
  const shellDir = path.join(root, 'src/vendor/cherry/compat/dist-source-shell')
  const shellFiles = []
  const walkShell = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walkShell(file)
      else shellFiles.push(file)
    }
  }
  walkShell(shellDir)
  const build = buildFingerprint([...distFiles, ...(fs.existsSync(shell) ? [shell] : [])], { root })
  const sourceShellSha256 = fs.existsSync(shell) ? fileSha256(shell) : null
  const distManifestEntries = distFiles.map(file => ({ path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: fileSha256(file), bytes: fs.statSync(file).size }))
  const sourceShellEntries = shellFiles.map(file => ({ path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: fileSha256(file) }))
  const findings = []
  const fixtureExceptions = []
  const scannedAggregateFiles = []
  const scanManifestEntries = []
  let finalAggregateSha256 = null
  let finalAggregatePath = null
  for (const file of files) {
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    scanManifestEntries.push({ path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: fileSha256(file), bytes: fs.statSync(file).size })
    if (/final-aggregate.*\.json$/.test(file)) scannedAggregateFiles.push(path.relative(root, file).replaceAll(path.sep, '/'))
    if (/final-aggregate-latest\.json$/.test(file)) {
      finalAggregatePath = path.relative(root, file).replaceAll(path.sep, '/')
      finalAggregateSha256 = fileSha256(file)
    }
    const result = scanText(text, path.relative(root, file).replaceAll(path.sep, '/'))
    findings.push(...result.findings)
    fixtureExceptions.push(...result.exceptions)
  }
  const archive = path.join(root, 'release/win-unpacked/resources/app.asar')
  let packagedTextEntries = 0
  if (fs.existsSync(archive)) {
    for (const entry of asar.listPackage(archive)) {
      const normalized = entry.replaceAll('\\', '/').replace(/^\//, '')
      if (!normalized.startsWith('dist/') || !extensions.has(path.extname(normalized))) continue
      let text
      try { text = asar.extractFile(archive, path.normalize(normalized)).toString('utf8') } catch { continue }
      packagedTextEntries++
      const result = scanText(text, 'app.asar/' + normalized)
      findings.push(...result.findings)
      fixtureExceptions.push(...result.exceptions)
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    exitCode: findings.length === 0 ? 0 : 1,
    buildSha256: build.combinedSha256,
    build,
    sourceShellSha256,
    scannedFiles: files.length,
    scannedAggregateFiles,
    packagedTextEntries,
    findings,
    fixtureExceptions,
    scanManifest: {
      algorithm: 'sha256',
      digest: manifestDigest(scanManifestEntries),
      fileCount: scanManifestEntries.length,
      totalBytes: scanManifestEntries.reduce((sum, entry) => sum + entry.bytes, 0),
      files: scanManifestEntries,
      distDigest: manifestDigest(distManifestEntries),
      distFileCount: distManifestEntries.length,
      distTotalBytes: distManifestEntries.reduce((sum, entry) => sum + entry.bytes, 0),
      sourceShellSha256,
      sourceShellDistDigest: manifestDigest(sourceShellEntries),
      buildSha256: build.combinedSha256,
    },
    lastScan: { scannedAt: new Date().toISOString(), finalAggregateIncluded: scannedAggregateFiles.some(file => /final-aggregate-latest\.json$/.test(file)), finalAggregatePath, finalAggregateSha256 },
    passed: findings.length === 0,
    scope: {
      targets,
      excludedDirectories: [...excludedDirectories],
      packaged: 'release/win-unpacked/resources/app.asar: dist/** text entries only',
      manifest: 'All scanned text files and the current dist are hashed into scanManifest; buildSha256 and sourceShellSha256 bind the scan to one build.',
      binaryExcluded: 'PNG/EXE/ASAR binary bytes and resources runtime binaries are not text-scanned',
      docsExcluded: 'docs/** is outside the product evidence/dist scope; scanText itself does not exempt it'
    },
    fixturePolicy: 'Exact path + kind + value only: dist/main/main/services/agent-runtime-safety.service.test.js must-not-inherit; dist/main/integrations/pi/modelInjection.js cherry-managed-runtime-key.',
    patternIds: PATTERNS.map(pattern => pattern.id)
  }
  fs.mkdirSync(path.join(root, 'artifacts/m5'), { recursive: true })
  fs.writeFileSync(path.join(root, 'artifacts/m5/secrets.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10))
  console.log(JSON.stringify({ passed: report.passed, scannedFiles: report.scannedFiles, packagedTextEntries, findingCount: findings.length, fixtureExceptions: fixtureExceptions.length, buildSha256: report.buildSha256, sourceShellSha256: report.sourceShellSha256, scanManifestDigest: report.scanManifest.digest, finalAggregateIncluded: report.lastScan.finalAggregateIncluded, artifact: 'artifacts/m5/secrets.json' }, null, 2))
  process.exitCode = report.passed ? 0 : 1
}
