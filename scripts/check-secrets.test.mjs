import test from 'node:test'
import assert from 'node:assert/strict'
import { scanText, PATTERNS, FIXTURE_ALLOWLIST } from './check-secrets.mjs'

const ids = text => new Set(scanText(text, 'fixture.txt').findings.map(finding => finding.kind))

test('detects project, Anthropic, JWT, client_secret and Authorization fixtures', () => {
  assert.ok(ids('OPENAI_API_KEY=sk-proj-' + 'a'.repeat(40)).has('openai-project'))
  assert.ok(ids('ANTHROPIC_API_KEY=sk-ant-api03-' + 'b'.repeat(32)).has('anthropic'))
  assert.ok(ids('token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c').has('jwt'))
  assert.ok(ids('client_secret="abcdefghijklmnopqrstuvwxyz"').has('client-secret'))
  assert.ok(ids('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456').has('authorization'))
})

test('does not flag short or empty values', () => {
  for (const text of ['sk-', 'sk-proj-short', 'Authorization: Bearer short', 'client_secret: ""', 'eyJhbGci', 'password: ""']) {
    assert.equal(ids(text).size, 0, text)
  }
})

test('allowlist is exact path + kind + value, never a broad context exemption', () => {
  const allowed = FIXTURE_ALLOWLIST[0]
  assert.ok(allowed)
  const exact = scanText('API_KEY: ' + JSON.stringify(allowed.value), allowed.file)
  assert.equal(exact.findings.length, 0)
  const otherFile = scanText('API_KEY: ' + JSON.stringify(allowed.value), 'dist/other.js')
  assert.ok(otherFile.findings.length > 0, 'same value in another file is still a finding')
  const otherValue = scanText('API_KEY: "different-value-123456789"', allowed.file)
  assert.ok(otherValue.findings.length > 0, 'same file with a different value is still a finding')
})

test('documentation content is still detectable by the scanner itself', () => {
  const result = scanText('docs/example.md\nAuthorization: Bearer ' + 'c'.repeat(32), 'docs/example.md')
  assert.ok(result.findings.some(finding => finding.kind === 'authorization'))
})

test('patterns carry stable ids and no duplicate ids', () => {
  const patternIds = PATTERNS.map(pattern => pattern.id)
  assert.equal(new Set(patternIds).size, patternIds.length)
  for (const id of ['openai-project', 'anthropic', 'jwt', 'client-secret', 'authorization', 'bearer', 'openai-like']) {
    assert.ok(patternIds.includes(id), id)
  }
})
