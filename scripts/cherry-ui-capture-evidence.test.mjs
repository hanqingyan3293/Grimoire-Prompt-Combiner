import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { surfaceIdentity, pngDigest, pngHeader, canonicalRoute, matchesRouteTemplate, verifiedCapture, preserveCapture } from './cherry-ui-capture-evidence.mjs'

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const BUILD = 'a'.repeat(64)
const IPCNav = { inputMethod: 'IPC navigation.open_route_in_main', ipc: { route: 'navigation.open_route_in_main', requestedPath: '/app/chat', resultOk: true } }

function fixture(directory, overrides = {}) {
  fs.writeFileSync(path.join(directory, 'frame.png'), PNG_1X1)
  const item = { name: '菜单', sourceFile: 'source/menu.tsx', route: '/app/chat', screenshot: 'frame.png', capture: 'passed', ...overrides.item }
  const route = canonicalRoute(item.route)
  const requestedPath = route.path
  item.captureEvidence = {
    surfaceIdentity: surfaceIdentity(item), pngSha256: pngDigest(path.join(directory, 'frame.png')), entry: 'compat',
    routeTemplate: item.route, requestedRoute: requestedPath, canonicalRoute: route.canonical, routeParameters: route.parameters, observedRoute: route.path, observedCanonicalRoute: route.canonical,
    exitCode: 0, action: { ...IPCNav }, assertion: { passed: true, kind: 'route', visible: true, bounds: { x: 0, y: 0, width: 200, height: 100 } },
    viewport: { width: 1920, height: 1080 }, png: { width: 1, height: 1 }, build: { artifactSha256: BUILD },
    featureAccepted: false, ...overrides.evidence
  }
  return item
}

test('only identity-bound, asserted, hash-matching, build-bound captures survive reconciliation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-evidence-test-'))
  try {
    const item = fixture(directory)
    assert.equal(verifiedCapture(item, directory, { buildSha256: BUILD }), true)
    assert.equal(verifiedCapture(item, directory, { buildSha256: 'b'.repeat(64) }), false, 'stale build must not verify')

    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, action: undefined } }, directory, { buildSha256: BUILD }), false)
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, assertion: { ...item.captureEvidence.assertion, bounds: { width: 0, height: 100 } } } }, directory, { buildSha256: BUILD }), false)
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, assertion: { ...item.captureEvidence.assertion, bounds: { x: 0, y: 0, width: 5000, height: 100 } } } }, directory, { buildSha256: BUILD }), false, 'bounds must fit the viewport')
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, viewport: { width: 0, height: 0 } } }, directory, { buildSha256: BUILD }), false)
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, png: { width: 2, height: 1 } } }, directory, { buildSha256: BUILD }), false, 'PNG IHDR must match the recorded dimensions')
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, build: { artifactSha256: 'not-a-hash' } } }, directory, { buildSha256: BUILD }), false)

    const fresh = { ...item, screenshot: null, capture: 'pending', captureEvidence: undefined }
    assert.equal(preserveCapture(fresh, item, directory, { buildSha256: BUILD }).capture, 'passed')
    assert.equal(preserveCapture({ ...fresh, sourceFile: 'different.tsx' }, item, directory, { buildSha256: BUILD }).capture, 'pending')
    fs.writeFileSync(path.join(directory, 'frame.png'), 'wrong page')
    assert.equal(verifiedCapture(item, directory, { buildSha256: BUILD }), false)
    fs.unlinkSync(path.join(directory, 'frame.png'))
    assert.equal(verifiedCapture(item, directory, { buildSha256: BUILD }), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('ordinary navigation evidence must be a real IPC navigation, never fabricated CDP navigation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-evidence-nav-'))
  try {
    const fabricated = fixture(directory, { evidence: { action: { inputMethod: 'CDP Input.navigation' } } })
    assert.equal(verifiedCapture(fabricated, directory, { buildSha256: BUILD }), false)
    const noIpc = fixture(directory, { evidence: { action: { inputMethod: 'IPC navigation.open_route_in_main' } } })
    assert.equal(verifiedCapture(noIpc, directory, { buildSha256: BUILD }), false)
    const failedIpc = fixture(directory, { evidence: { action: { ...IPCNav, ipc: { ...IPCNav.ipc, resultOk: false } } } })
    assert.equal(verifiedCapture(failedIpc, directory, { buildSha256: BUILD }), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('route parameters are canonical and exact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-evidence-route-'))
  try {
    const item = fixture(directory, { item: { route: '/settings/data?panel=local_backup' } })
    item.captureEvidence.requestedRoute = '/settings/data'
    item.captureEvidence.observedCanonicalRoute = '/settings/data'
    item.captureEvidence.routeResolution = 'dom-click-content-selector'
    item.captureEvidence.action.domClick = { clicked: true, targetLabel: '本地备份' }
    item.captureEvidence.assertion.contentSelector = '#setting-data-local-backup-directory'
    assert.deepEqual(item.captureEvidence.routeParameters, { panel: 'local_backup' })
    assert.equal(item.captureEvidence.canonicalRoute, '/settings/data?panel=local_backup')
    assert.equal(verifiedCapture(item, directory, { buildSha256: BUILD }), true)
    const wrongParams = { ...item, captureEvidence: { ...item.captureEvidence, routeParameters: { panel: 'import_settings' } } }
    assert.equal(verifiedCapture(wrongParams, directory, { buildSha256: BUILD }), false)
    const loosePrefix = { ...item, captureEvidence: { ...item.captureEvidence, canonicalRoute: '/settings/data' } }
    assert.equal(verifiedCapture(loosePrefix, directory, { buildSha256: BUILD }), false)
    assert.equal(canonicalRoute('/settings/data?b=2&a=1').canonical, '/settings/data?a=1&b=2')
    assert.equal(matchesRouteTemplate('/settings/mcp/$', '/settings/mcp/bailian'), true)
    assert.equal(matchesRouteTemplate('/settings/mcp/$', '/settings/mcp/bailian/extra'), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('interaction surfaces still require a real pointer/keyboard action and positive height', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-evidence-interaction-'))
  try {
    const panel = fixture(directory, { item: { kind: 'quick-panel' } })
    panel.captureEvidence.assertion = { ...panel.captureEvidence.assertion, kind: 'quick-panel', bounds: { x: 0, y: 0, width: 200, height: 100 } }
    assert.equal(verifiedCapture(panel, directory, { buildSha256: BUILD }), false)
    panel.captureEvidence.action = { inputMethod: 'CDP Input.dispatchKeyEvent', keyboardNavigation: { before: [], after: ['one'] }, noMessageSent: true }
    assert.equal(verifiedCapture(panel, directory, { buildSha256: BUILD }), true)
    panel.captureEvidence.assertion.bounds = { x: 0, y: 0, width: 200, height: 12 }
    assert.equal(verifiedCapture(panel, directory, { buildSha256: BUILD }), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('a PNG without a valid IHDR is rejected even when its digest matches', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-evidence-png-'))
  try {
    const bytes = Buffer.alloc(33)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0)
    Buffer.from('IHDR', 'ascii').copy(bytes, 12)
    fs.writeFileSync(path.join(directory, 'broken.png'), bytes)
    const item = { name: 'broken', sourceFile: 's.tsx', route: '/app/chat', screenshot: 'broken.png', capture: 'passed' }
    const route = canonicalRoute(item.route)
    item.captureEvidence = { surfaceIdentity: surfaceIdentity(item), pngSha256: pngDigest(path.join(directory, 'broken.png')), entry: 'x', routeTemplate: item.route, requestedRoute: route.path, canonicalRoute: route.canonical, routeParameters: {}, observedRoute: route.path, observedCanonicalRoute: route.canonical, exitCode: 0, action: { ...IPCNav }, assertion: { passed: true, visible: true, bounds: { x: 0, y: 0, width: 10, height: 10 } }, viewport: { width: 100, height: 100 }, png: { width: 10, height: 10 }, build: { artifactSha256: BUILD } }
    assert.equal(pngHeader(path.join(directory, 'broken.png')), null)
    assert.equal(verifiedCapture(item, directory, { buildSha256: BUILD }), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
