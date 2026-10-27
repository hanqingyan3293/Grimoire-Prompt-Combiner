import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const INTERACTION_KINDS = new Set(['context-menu', 'quick-panel', 'dialog'])

export function surfaceIdentity(item) {
  return JSON.stringify([item.sourceFile, item.route ?? null, item.window ?? null, item.kind ?? null, item.name])
}

export function pngDigest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function verifiedCapture(item, directory) {
  const evidence = item.captureEvidence
  if (item.capture !== 'passed' || !item.screenshot || !evidence) return false
  if (path.basename(item.screenshot) !== item.screenshot) return false
  const file = path.join(directory, item.screenshot)
  if (!fs.existsSync(file) || evidence.surfaceIdentity !== surfaceIdentity(item)) return false
  if (evidence.pngSha256 !== pngDigest(file) || evidence.exitCode !== 0) return false
  if (!evidence.entry || !evidence.observedRoute || !evidence.assertion?.passed) return false
  if (INTERACTION_KINDS.has(item.kind)) {
    const box = evidence.assertion.bounds
    if (!evidence.action?.inputMethod?.startsWith('CDP Input.') || !box || box.width <= 0 || box.height <= 0) return false
    if (evidence.assertion.kind !== item.kind || evidence.assertion.visible !== true) return false
    if (item.kind === 'quick-panel' && (box.height < 80 || !evidence.action.keyboardNavigation || evidence.action.noMessageSent !== true)) return false
    if (item.kind === 'dialog' && evidence.action.cancelPreservedMessage !== true) return false
  }
  return true
}

export function preserveCapture(item, prior, directory) {
  if (!prior || surfaceIdentity(item) !== surfaceIdentity(prior) || !verifiedCapture(prior, directory)) return item
  return { ...item, screenshot: prior.screenshot, capture: prior.capture, captureEvidence: prior.captureEvidence }
}
