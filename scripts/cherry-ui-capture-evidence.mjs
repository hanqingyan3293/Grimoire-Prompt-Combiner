import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const INTERACTION_KINDS = new Set(['context-menu', 'quick-panel', 'dialog'])
export const SURFACE_KINDS = new Set(['route', 'data-panel', 'source-shell', 'agent-blocker'])

// Explicit redirects implemented by the compat shell. A prefix is never enough:
// the requested route and the delivered route must both be listed here.
export const REDIRECT_ALIASES = new Map([
  ['/settings', '/settings/provider'],
  ['/settings/mcp', '/settings/mcp/servers'],
  ['/settings/system', '/settings/general'],
  ['/settings/code-execution', '/settings/appearance'],
  ['/app', '/app/launchpad']
])

// A few source pages add their own default query state after the route loads.
// These are exact values, not a wildcard: no other parameter is admitted.
export const DEFAULT_OBSERVED_PARAMETERS = new Map([
  ['/app/browser', { url: 'about:blank' }]
])

// Some source surfaces are content states rather than distinct tab URLs. These
// are the only admitted resolutions: the observed URL and the content selector
// are both fixed here, so a different page can never borrow the exception.
export const CONTENT_RESOLUTIONS = new Map([
  ['/settings/data?panel=local_backup', { observedPath: '/settings/data', selector: '#setting-data-local-backup-directory' }],
  ['/settings/data?panel=import_settings', { observedPath: '/settings/data', selector: '#setting-data-import-chatgpt' }],
  ['/settings/data?panel=markdown_export', { observedPath: '/settings/data', selector: '#setting-data-markdown-export-path' }],
  ['/settings/mcp/$', { observedPath: '/settings/mcp/servers', selector: 'input[type="password"]' }]
])

export function surfaceIdentity(item) {
  return JSON.stringify([item.sourceFile, item.route ?? null, item.window ?? null, item.kind ?? null, item.name])
}

export function pngDigest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/**
 * Read width/height from the PNG IHDR chunk. A PNG signature alone is not
 * evidence of a usable frame; zero, non-finite or truncated dimensions are red.
 */
export function pngHeader(file) {
  let bytes
  try { bytes = fs.readFileSync(file) } catch { return null }
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function decode(value) {
  try { return decodeURIComponent(value) } catch { return null }
}

/**
 * Canonical form used for exact evidence binding. Query keys are sorted, the
 * path has no trailing slash (except root) and duplicate keys are rejected.
 * A route without a query and the same route with an empty query canonicalize
 * identically; any different parameter value is a different route.
 */
export function canonicalRoute(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('#') || value.includes('\\')) return null
  const queryAt = value.indexOf('?')
  const rawPath = queryAt === -1 ? value : value.slice(0, queryAt)
  const rawQuery = queryAt === -1 ? '' : value.slice(queryAt + 1)
  const normalPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
  if (!normalPath.startsWith('/')) return null
  const parameters = {}
  if (rawQuery) {
    for (const part of rawQuery.split('&')) {
      const equals = part.indexOf('=')
      const rawKey = equals === -1 ? part : part.slice(0, equals)
      const rawValue = equals === -1 ? '' : part.slice(equals + 1)
      const key = decode(rawKey)
      const val = decode(rawValue)
      if (!key || val === null || Object.prototype.hasOwnProperty.call(parameters, key)) return null
      parameters[key] = val
    }
  }
  const keys = Object.keys(parameters).sort()
  const query = keys.map(key => encodeURIComponent(key) + '=' + encodeURIComponent(parameters[key])).join('&')
  return { path: normalPath, parameters, canonical: query ? normalPath + '?' + query : normalPath }
}

/**
 * Match one concrete source route against one catalog route template. Only a
 * whole route matches; a trailing "$" consumes exactly one segment and a
 * segment such as "$appId" matches exactly that position. This is stricter
 * than the source matcher (which permits extra tail segments), never a prefix.
 */
export function matchesRouteTemplate(template, concrete) {
  if (typeof template !== 'string' || typeof concrete !== 'string') return false
  const templatePath = template.split('?')[0]
  const concretePath = concrete.split('?')[0]
  if (!templatePath.startsWith('/') || !concretePath.startsWith('/')) return false
  const templateSegments = templatePath.slice(1).split('/')
  const concreteSegments = concretePath.slice(1).split('/')
  for (let index = 0; index < templateSegments.length; index++) {
    const segment = templateSegments[index]
    if (segment === '$') return index === templateSegments.length - 1 && concreteSegments.length === templateSegments.length
    if (segment.startsWith('$')) {
      if (!concreteSegments[index]) return false
      continue
    }
    if (concreteSegments[index] !== segment) return false
  }
  return concreteSegments.length === templateSegments.length
}

function sameParameters(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false
  if (!right || typeof right !== 'object' || Array.isArray(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function boundsInsideViewport(bounds, viewport) {
  if (!bounds || !viewport) return false
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(value => typeof value === 'number' && Number.isFinite(value))) return false
  if (!positive(bounds.width) || !positive(bounds.height)) return false
  if (!positive(viewport.width) || !positive(viewport.height)) return false
  const slack = 2
  return bounds.x >= -slack && bounds.y >= -slack &&
    bounds.x + bounds.width <= viewport.width + slack &&
    bounds.y + bounds.height <= viewport.height + slack
}

function routeMatches(item, evidence) {
  const catalog = canonicalRoute(item.route)
  const requested = canonicalRoute(evidence.requestedRoute)
  if (!catalog || !requested) return false
  if (evidence.routeTemplate !== item.route) return false
  if (evidence.canonicalRoute !== catalog.canonical) return false
  if (!sameParameters(evidence.routeParameters, catalog.parameters)) return false
  if (item.route.includes('$')) {
    if (!matchesRouteTemplate(item.route, requested.path)) return false
  } else if (requested.path !== catalog.path) return false

  const observed = evidence.observedCanonicalRoute ?? requested.canonical
  if (observed === requested.canonical) return evidence.observedRoute === requested.path
  if (evidence.routeResolution === 'declared-default-parameters') {
    const defaults = DEFAULT_OBSERVED_PARAMETERS.get(catalog.canonical)
    const parsed = canonicalRoute(evidence.observedCanonicalRoute)
    return Boolean(defaults && parsed && sameParameters(parsed.parameters, { ...catalog.parameters, ...defaults }) && evidence.observedRoute === parsed.path)
  }
  if (evidence.routeResolution === 'dom-click-content-selector') {
    const resolution = CONTENT_RESOLUTIONS.get(item.route)
    return Boolean(resolution && evidence.observedRoute === resolution.observedPath &&
      evidence.assertion?.contentSelector === resolution.selector &&
      evidence.action?.domClick?.clicked === true)
  }
  const redirected = evidence.redirect
  if (!redirected || redirected.from !== requested.canonical || redirected.to !== observed) return false
  const alias = REDIRECT_ALIASES.get(requested.canonical)
  return Boolean(alias && canonicalRoute(observed)?.canonical === alias && evidence.observedRoute === canonicalRoute(observed)?.path)
}

export function verifiedCapture(item, directory, options = {}) {
  const evidence = item.captureEvidence
  if (item.capture !== 'passed' || !item.screenshot || !evidence) return false
  if (path.basename(item.screenshot) !== item.screenshot) return false
  const file = path.join(directory, item.screenshot)
  if (!fs.existsSync(file) || evidence.surfaceIdentity !== surfaceIdentity(item)) return false
  if (evidence.exitCode !== 0) return false
  if (!evidence.entry || !routeMatches(item, evidence)) return false

  const header = pngHeader(file)
  if (!header) return false
  if (evidence.png?.width !== header.width || evidence.png?.height !== header.height) return false
  if (evidence.pngSha256 !== pngDigest(file)) return false

  const build = evidence.build?.artifactSha256
  if (typeof build !== 'string' || !/^[a-f0-9]{64}$/.test(build)) return false
  if (options.buildSha256 && build !== options.buildSha256) return false

  const assertion = evidence.assertion
  if (!assertion || assertion.passed !== true || assertion.visible !== true) return false
  if (assertion.kind !== (item.kind || 'route')) return false
  if (!boundsInsideViewport(assertion.bounds, evidence.viewport)) return false

  const action = evidence.action
  if (!action || typeof action.inputMethod !== 'string') return false
  if (INTERACTION_KINDS.has(item.kind)) {
    if (!action.inputMethod.startsWith('CDP Input.')) return false
    if (item.kind === 'quick-panel' && (assertion.bounds.height < 80 || !action.keyboardNavigation || action.noMessageSent !== true)) return false
    if (item.kind === 'dialog' && action.cancelPreservedMessage !== true) return false
    return true
  }
  // Ordinary surfaces must be reached by the real navigation IPC. A CDP
  // Page.navigate/Input.navigation label is not a product action and is red.
  if (action.inputMethod !== 'IPC navigation.open_route_in_main' && !action.inputMethod.startsWith('IPC navigation.open_route_in_main + ')) return false
  if (action.ipc?.route !== 'navigation.open_route_in_main' || action.ipc?.resultOk !== true) return false
  if (item.kind === 'data-panel') {
    if (action.domClick?.clicked !== true) return false
    if (!assertion.contentSelector) return false
  }
  return true
}

export function preserveCapture(item, prior, directory, options = {}) {
  if (!prior || surfaceIdentity(item) !== surfaceIdentity(prior) || !verifiedCapture(prior, directory, options)) return item
  return { ...item, screenshot: prior.screenshot, capture: prior.capture, captureEvidence: prior.captureEvidence }
}
