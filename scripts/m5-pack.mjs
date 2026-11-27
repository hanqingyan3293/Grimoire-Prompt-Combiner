#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { buildFingerprint } from './journey-evidence.mjs'
import { manifestDigest } from './m5-evidence.mjs'
const require = createRequire(import.meta.url)
const asarApi = require('@electron/asar')
const root = process.cwd()
const args = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sha256File = file => hash(fs.readFileSync(file))
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
const out = path.join(root, 'artifacts/m5')
fs.mkdirSync(out, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = { generatedAt: new Date().toISOString(), mode: args.includes('--pack') ? 'fresh-pack' : args.includes('--require-pack') ? 'verify-package' : 'license-preflight', passed: false, checks: [], commands: [] }
const check = (name, passed, details = {}) => report.checks.push({ name, passed: Boolean(passed), ...details })
const command = (name, executable, argv, options = {}) => {
  const start = Date.now()
  const run = spawnSync(executable, argv, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  const log = path.join(out, `${stamp}-${name}.log`)
  fs.writeFileSync(log, (run.stdout || '') + '\n' + (run.stderr || ''))
  report.commands.push({ name, command: [executable, ...argv].join(' '), exitCode: run.status, durationMs: Date.now() - start, attempt: 1, artifact: path.relative(root, log) })
  return run
}
try {
  check('root license configured', pkg.build.files.includes('LICENSE'))
  for (const from of ['src/vendor/cherry/source/LICENSE', 'src/vendor/opencode/source/LICENSE', 'src/vendor/pi/source/LICENSE', 'src/vendor/dockview/source/packages/dockview-core/LICENCE.md', 'src/vendor/dockview/source/packages/dockview-react/LICENCE.md']) {
    check(`license configured ${from}`, pkg.build.extraResources.some(entry => entry.from === from) && fs.existsSync(from))
  }
  if (args.includes('--pack')) {
    const run = command('pack', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'pack'], { shell: process.platform === 'win32' })
    check('fresh pack command', run.status === 0)
    if (run.status !== 0) throw new Error('Fresh pack failed; older package is not accepted')
  }
  if (args.includes('--pack') || args.includes('--require-pack')) {
    const resources = path.join(root, 'release/win-unpacked/resources')
    const archive = path.join(resources, 'app.asar')
    report.asarSha256 = hash(fs.readFileSync(archive))
    const sourceShell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
    report.sourceShellSha256 = fs.existsSync(sourceShell) ? sha256File(sourceShell) : null
    report.provenance = { artifact: path.relative(root, archive), mtime: fs.statSync(archive).mtime.toISOString(), proof: 'Every dist file inside app.asar is compared byte-for-byte with the current dist; original license texts and runtime binaries are checked separately. A verify-package run never rebuilds.' }
    const entries = asarApi.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, ''))

    const distFiles = walkFiles(path.join(root, 'dist'))
    const currentDistEntries = distFiles.map(file => {
      const relative = path.relative(root, file).replaceAll(path.sep, '/')
      return { path: relative, sha256: sha256File(file), bytes: fs.statSync(file).size }
    })
    const currentDistByPath = new Map(currentDistEntries.map(entry => [entry.path, entry]))
    // listPackage includes directory entries as well as files. A directory has a
    // nested `files` object in statFile; only file entries belong in the manifest.
    const asarDistEntries = entries.filter(entry => {
      if (!entry.startsWith('dist/')) return false
      if (currentDistByPath.has(entry)) return true
      try { return !asarApi.statFile(archive, path.normalize(entry)).files } catch { return true }
    })
    const asarDistByPath = new Set(asarDistEntries)
    const missingInAsar = []
    const different = []
    for (const entry of currentDistEntries) {
      if (!asarDistByPath.has(entry.path)) { missingInAsar.push(entry.path); continue }
      const actualHash = hash(asarApi.extractFile(archive, path.normalize(entry.path)))
      if (actualHash !== entry.sha256) different.push({ path: entry.path, expectedHash: entry.sha256, actualHash })
    }
    const missingInDist = asarDistEntries.filter(entry => !currentDistByPath.has(entry))
    const digest = manifestDigest(currentDistEntries)
    report.buildFingerprint = buildFingerprint(distFiles, { root })
    report.distManifest = {
      algorithm: 'sha256',
      digest,
      fileCount: currentDistEntries.length,
      totalBytes: currentDistEntries.reduce((sum, entry) => sum + entry.bytes, 0),
      asarDistEntryCount: asarDistEntries.length,
      manifest: currentDistEntries,
      missingInAsar,
      missingInDist,
      different,
      asarMtime: fs.statSync(archive).mtime.toISOString(),
      maxDistMtime: currentDistEntries.length ? new Date(Math.max(...distFiles.map(file => fs.statSync(file).mtimeMs))).toISOString() : null,
    }
    check('complete dist manifest', currentDistEntries.length > 0 && missingInAsar.length === 0 && missingInDist.length === 0 && different.length === 0 && asarDistEntries.length === currentDistEntries.length, {
      currentDistFiles: currentDistEntries.length,
      asarDistEntries: asarDistEntries.length,
      missingInAsar,
      missingInDist,
      different,
    })
    check('dist manifest digest', digest === manifestDigest(currentDistEntries), { digest })
    check('dist manifest binds current build', report.buildFingerprint.fileCount === currentDistEntries.length, { buildFingerprint: report.buildFingerprint.combinedSha256, fileCount: report.buildFingerprint.fileCount })
    for (const file of ['LICENSE', 'dist/main/main/index.js', 'dist/main/integrations/pi/piSdk.js', 'dist/cherry-compat/index.html']) {
      const normalizedFile = file.replaceAll('\\', '/')
      const exact = entries.includes(normalizedFile) || entries.includes('/' + normalizedFile)
      const expectedHash = hash(fs.readFileSync(path.join(root, file)))
      const actualHash = exact ? hash(asarApi.extractFile(archive, path.normalize(normalizedFile))) : null
      check(`exact asar ${file}`, exact && actualHash === expectedHash, { expectedHash, actualHash })
    }
    for (const entry of pkg.build.extraResources.filter(entry => /LICENSE|LICENCE/.test(entry.from))) {
      const sourceHash = hash(fs.readFileSync(path.join(root, entry.from)))
      const target = path.join(resources, entry.to)
      const packagedHash = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null
      check(`license hash ${entry.to}`, sourceHash === packagedHash, { sourceHash, packagedHash })
    }
    for (const kind of ['opencode', 'pi']) {
      const relative = `agent-runtimes/${kind}/${kind}.exe`
      const sourceHash = hash(fs.readFileSync(path.join(root, 'resources', relative)))
      const packagedHash = hash(fs.readFileSync(path.join(resources, relative)))
      check(`runtime checksum ${kind}`, sourceHash === packagedHash, { sourceHash, packagedHash })
    }
    const executable = path.join(root, 'release/win-unpacked/Grimoire.exe')
    const probe = command('packaged-pi-esm', executable, [path.join(root, 'scripts/m5-pack-probe.cjs'), archive], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    check('packaged Electron Pi ESM dynamic import', probe.status === 0 && /"loaded":true/.test(probe.stdout || ''))
  }
} catch (error) { report.error = error.message; check('execution', false, { error: error.message }) }
report.passed = report.checks.every(item => item.passed)
fs.writeFileSync(path.join(out, `pack-${stamp}.json`), JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync(path.join(out, 'pack-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.passed ? 0 : 1
