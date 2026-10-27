import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { surfaceIdentity, pngDigest, verifiedCapture, preserveCapture } from './cherry-ui-capture-evidence.mjs'

test('only identity-bound, asserted, hash-matching captures survive reconciliation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-evidence-test-'))
  try {
    fs.writeFileSync(path.join(directory, 'frame.png'), 'test frame bytes')
    const item = { name: '菜单', sourceFile: 'source/menu.tsx', route: '/app/chat', kind: 'context-menu', screenshot: 'frame.png', capture: 'passed' }
    assert.equal(verifiedCapture(item, directory), false)
    item.captureEvidence = { surfaceIdentity: surfaceIdentity(item), pngSha256: pngDigest(path.join(directory, 'frame.png')), entry: 'compat', observedRoute: '/app/chat', exitCode: 0, action: { inputMethod: 'CDP Input.dispatchMouseEvent' }, assertion: { passed: true, kind: 'context-menu', visible: true, bounds: { width: 200, height: 100 } } }
    assert.equal(verifiedCapture(item, directory), true)
    const fresh = { ...item, screenshot: null, capture: 'pending', captureEvidence: undefined }
    assert.equal(preserveCapture(fresh, item, directory).capture, 'passed')
    assert.equal(preserveCapture({ ...fresh, sourceFile: 'different.tsx' }, item, directory).capture, 'pending')
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, action: undefined } }, directory), false)
    assert.equal(verifiedCapture({ ...item, captureEvidence: { ...item.captureEvidence, assertion: { ...item.captureEvidence.assertion, bounds: { width: 0, height: 100 } } } }, directory), false)
    const panel = { ...item, kind: 'quick-panel' }
    panel.captureEvidence = { ...item.captureEvidence, surfaceIdentity: surfaceIdentity(panel), assertion: { ...item.captureEvidence.assertion, kind: 'quick-panel' } }
    assert.equal(verifiedCapture(panel, directory), false)
    panel.captureEvidence.action = { inputMethod: 'CDP Input.dispatchMouseEvent', keyboardNavigation: { before: [], after: ['one'] }, noMessageSent: true }
    assert.equal(verifiedCapture(panel, directory), true)
    panel.captureEvidence.assertion.bounds = { width: 200, height: 12 }
    assert.equal(verifiedCapture(panel, directory), false)
    fs.writeFileSync(path.join(directory, 'frame.png'), 'wrong page')
    assert.equal(verifiedCapture(item, directory), false)
    fs.unlinkSync(path.join(directory, 'frame.png'))
    assert.equal(verifiedCapture(item, directory), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
