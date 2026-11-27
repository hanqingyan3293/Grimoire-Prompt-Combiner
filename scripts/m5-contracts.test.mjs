import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { verifiedCapture, surfaceIdentity, canonicalRoute, pngHeader } from './cherry-ui-capture-evidence.mjs'
assert.ok(fs.existsSync('scripts/m5-index.mjs'), 'M5 acceptance index script must exist')

test('B has opt-in reproducible build/smoke aliases and full verification includes mandatory pack', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.match(pkg.scripts['build:cherry-source-shell'] || '', /vite.source-shell.config.ts/)
  assert.match(pkg.scripts['smoke:cherry-source-shell'] || '', /audit-cherry-source-shell.mjs/)
  assert.match(pkg.scripts['verify:full'], /m5-acceptance/)
  assert.match(pkg.scripts['verify:pack'] || '', /m5-pack/)
  assert.ok(pkg.build.files.includes('LICENSE'))
  assert.ok(pkg.build.extraResources.some(r => r.from === 'src/vendor/pi/source/LICENSE'))
  assert.ok(pkg.build.extraResources.some(r => r.from === 'src/vendor/opencode/source/LICENSE'))
  assert.ok(pkg.scripts['runtime:opencode-v2-probe'])
})

test('ordinary route capture rejects absent/zero/invisible bounds and missing action', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-capture-contract-'))
  try {
    fs.writeFileSync(path.join(dir, 'route.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const item = { name: 'route', sourceFile: 'source.tsx', route: '/app/chat', capture: 'passed', screenshot: 'route.png' }
    const route = canonicalRoute(item.route)
    const build = 'c'.repeat(64)
    item.captureEvidence = { surfaceIdentity: surfaceIdentity(item), pngSha256: createHash('sha256').update(fs.readFileSync(path.join(dir, 'route.png'))).digest('hex'), exitCode: 0, entry: 'fixture', routeTemplate: item.route, requestedRoute: route.path, canonicalRoute: route.canonical, routeParameters: route.parameters, observedRoute: route.path, observedCanonicalRoute: route.canonical, png: pngHeader(path.join(dir, 'route.png')), viewport: { width: 1920, height: 1080 }, build: { artifactSha256: build }, assertion: { passed: true } }
    assert.equal(verifiedCapture(item, dir), false)
    item.captureEvidence.assertion = { passed: true, visible: true, kind: 'route', bounds: { width: 10, height: 10 } }
    assert.equal(verifiedCapture(item, dir), false)
    item.captureEvidence.action = { inputMethod: 'IPC navigation.open_route_in_main', ipc: { route: 'navigation.open_route_in_main', resultOk: true }, description: 'navigate' }
    item.captureEvidence.assertion.bounds = { x: 0, y: 0, width: 10, height: 10 }
    assert.equal(verifiedCapture(item, dir), true)
    item.captureEvidence.assertion.bounds.width = 0
    assert.equal(verifiedCapture(item, dir), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
