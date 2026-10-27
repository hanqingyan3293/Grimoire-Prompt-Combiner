/**
 * Grimoire-owned compat route registry.
 *
 * The full Cherry route tree (`routeTree.gen`) is not part of the vendored closure,
 * so the compat window cannot mount the real router. This registry mirrors the source
 * paths the compat surface actually implements — `/app/chat`, `/app/agents`,
 * `/settings/provider`, `/settings/mcp` — over a hash route so deep links, browser
 * back/forward and refresh-on-route all work inside the Electron window without a
 * second router dependency. Unmatched paths resolve to an explicit blocked route
 * rather than silently falling back to a default view.
 */

import { REMAINING_SETTINGS_PATHS, REMAINING_SETTINGS_DETAIL_PATTERNS } from './settings-route-descriptors'
import type { RemainingSettingsRoute } from './settings-route-descriptors'

export type CompatRoute =
  | RemainingSettingsRoute
  | { id: 'settings-invalid'; path: string; reason: string }
  | { id: 'paintings-splat'; path: string }
  | { id: 'mini-app-blocked'; path: string }
  | { id: 'chat'; path: '/app/chat' }
  | { id: 'agents'; path: '/app/agents' }
  | { id: 'release-notes'; path: '/app/release-notes' }
  | { id: 'launchpad'; path: '/app/launchpad' }
  | { id: 'browser'; path: '/app/browser' }
  | { id: 'knowledge'; path: '/app/knowledge' }
  | { id: 'notes'; path: '/app/notes' }
  | { id: 'code'; path: '/app/code' }
  | { id: 'translate'; path: '/app/translate' }
  | { id: 'paintings'; path: '/app/paintings' }
  | { id: 'files'; path: '/app/files' }
  | { id: 'file-preview'; path: '/app/file-preview' }
  | { id: 'settings-root'; path: '/settings' }
  | { id: 'settings-system'; path: '/settings/system' }
  | { id: 'settings-code-execution'; path: '/settings/code-execution' }
  | { id: 'settings-provider'; path: '/settings/provider' }
  | { id: 'settings-mcp'; path: '/settings/mcp' }
  | { id: 'settings-mcp-detail'; path: string; serverId: string }
  | { id: 'settings-mcp-builtin'; path: '/settings/mcp/builtin' }
  | { id: 'settings-mcp-marketplaces'; path: '/settings/mcp/marketplaces' }
  | { id: 'settings-mcp-install'; path: '/settings/mcp/mcp-install' }
  | { id: 'settings-mcp-npx-search'; path: '/settings/mcp/npx-search' }
  | { id: 'settings-mcp-provider'; path: string; providerKey: string }
  | { id: 'settings-appearance'; path: '/settings/appearance' }
  | { id: 'settings-general'; path: '/settings/general' }
  | { id: 'settings-data'; path: '/settings/data' }
  | { id: 'settings-dependencies'; path: '/settings/dependencies' }
  | { id: 'settings-notifications'; path: '/settings/notifications' }
  | { id: 'settings-about'; path: '/settings/about' }
  | { id: 'settings-prompts'; path: '/settings/prompts' }
  | { id: 'settings-usage'; path: '/settings/usage' }
  | { id: 'settings-shortcut'; path: '/settings/shortcut' }
  | { id: 'settings-archive'; path: '/settings/archive' }
  | { id: 'unknown'; path: string }

export const COMPAT_ROUTE_PATHS = {
  ...REMAINING_SETTINGS_PATHS,
  chat: '/app/chat',
  agents: '/app/agents',
  'settings-root': '/settings',
  'settings-system': '/settings/system',
  'settings-code-execution': '/settings/code-execution',
  'release-notes': '/app/release-notes',
  // Paths taken from the source's own route files (`routes/app/<name>.tsx`), not guessed:
  // every one of these is a real `createFileRoute` target in the vendored closure.
  launchpad: '/app/launchpad',
  browser: '/app/browser',
  knowledge: '/app/knowledge',
  notes: '/app/notes',
  code: '/app/code',
  translate: '/app/translate',
  paintings: '/app/paintings',
  files: '/app/files',
  'file-preview': '/app/file-preview',
  'settings-provider': '/settings/provider',
  'settings-mcp': '/settings/mcp',
  'settings-mcp-builtin': '/settings/mcp/builtin',
  'settings-mcp-marketplaces': '/settings/mcp/marketplaces',
  'settings-mcp-install': '/settings/mcp/mcp-install',
  'settings-mcp-npx-search': '/settings/mcp/npx-search',
  'settings-appearance': '/settings/appearance',
  'settings-general': '/settings/general',
  'settings-data': '/settings/data',
  'settings-dependencies': '/settings/dependencies',
  'settings-notifications': '/settings/notifications',
  'settings-about': '/settings/about',
  'settings-prompts': '/settings/prompts',
  'settings-usage': '/settings/usage',
  'settings-shortcut': '/settings/shortcut',
  'settings-archive': '/settings/archive'
} as const

/**
 * Route ids that render a full-page `/app/*` surface in the shell's main slot.
 *
 * A set rather than a chain of comparisons inside the shell: the shell consults it to decide
 * whether the route body is an app page or the chat main slot, and the surface builder uses the
 * same ids. Adding a route in one place and forgetting the other would silently render chat for
 * a page that was registered.
 */
export const COMPAT_APP_ROUTE_IDS: ReadonlySet<string> = new Set([
  'release-notes',
  // The source splat route renders PaintingPage, the same component as the index route.
  'paintings-splat',
  'launchpad',
  'browser',
  'knowledge',
  'notes',
  'code',
  'translate',
  'paintings',
  'files',
  'file-preview'
])

/** Source MCP detail path (`routes/settings/mcp/settings.$serverId.tsx`). */
export const COMPAT_MCP_DETAIL_PATTERN = '/settings/mcp/settings/$serverId'

/**
 * Every path the registry matches, in display order, for the blocked-route message.
 *
 * DERIVED from `COMPAT_ROUTE_PATHS` plus the parameterized detail route, not transcribed.
 * The message used to be a hand-maintained string literal and went stale three times as
 * routes were added (`data`/`dependencies` shipped unlisted, then `notifications`, then
 * `about`/`prompts` were missing) — a wrong list in the one place a user goes to find out
 * what IS supported. Deriving it means adding a route cannot leave the message wrong.
 */
export const COMPAT_SUPPORTED_PATHS: string[] = [
  ...Object.values(COMPAT_ROUTE_PATHS),
  COMPAT_MCP_DETAIL_PATTERN,
  ...Object.values(REMAINING_SETTINGS_DETAIL_PATTERNS)
]

/** Routes that exist but are diagnostics rather than working surfaces, with the reason. */
export const COMPAT_BLOCKED_NOTES: string[] = [
  '/settings/general 为 BLOCKED 诊断页',
  ...[...Object.values(REMAINING_SETTINGS_PATHS), ...Object.values(REMAINING_SETTINGS_DETAIL_PATTERNS)]
    .map(path => path + ' 为 BLOCKED 诊断页')
]

/** Full main-slot settings surfaces, including bounded diagnostics and invalid parameters. */
export function isCompatSettingsRoute(route: CompatRoute): boolean {
  return route.id.startsWith('settings-')
}

function decodePathParam(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    // IDs are a single opaque path segment, not paths, traversal or control text.
    return decoded.trim() && !/[\/\\\u0000-\u001f\u007f]/.test(decoded) && decoded !== '.' && decoded !== '..'
      ? decoded : undefined
  } catch {
    return undefined
  }
}

export const DEFAULT_COMPAT_ROUTE: CompatRoute = { id: 'chat', path: COMPAT_ROUTE_PATHS.chat }

const KNOWN_ROUTES = new Map<string, CompatRoute>(
  (Object.entries(COMPAT_ROUTE_PATHS) as Array<[CompatRoute['id'] & string, string]>).map(([id, path]) => [path, { id, path } as CompatRoute])
)

/** Source alias: the MCP list lives at `/settings/mcp/servers` under the layout route. */
const ROUTE_ALIASES = new Map<string, string>([['/settings/mcp/servers', '/settings/mcp']])

/**
 * Substitutes `$param` segments in a source route template with encoded values.
 *
 * The mounted source subtree navigates by TEMPLATE (`to: '/settings/mcp/settings/$serverId'`
 * + `params: { serverId }`), and a missing param must fail loudly — a silent empty
 * segment would render a detail page for no server.
 */
export function resolveCompatPath(to: string, params?: Record<string, unknown>): string {
  const template = String(to || '')
  if (!template.includes('$')) return template
  return template.replace(/\$([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params ? params[name] : undefined
    if (value === undefined || value === null || value === '') {
      throw new Error('compat route: missing path param "$' + name + '" for ' + template)
    }
    if (typeof value !== 'string' || decodePathParam(encodeURIComponent(value)) === undefined) {
      throw new Error('compat route: invalid path param "$' + name + '" for ' + template)
    }
    return encodeURIComponent(value)
  })
}

/** Normalizes an incoming hash/location string to the route path form. */
export function parseCompatRoute(hash: string | null | undefined): CompatRoute {
  const raw = String(hash || '').trim()
  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw
  const pathOnly = withoutHash.split('?')[0].split('#')[0]
  if (!pathOnly) return DEFAULT_COMPAT_ROUTE
  const normalized = pathOnly.startsWith('/') ? pathOnly : '/' + pathOnly
  const trimmed = normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  const direct = KNOWN_ROUTES.get(trimmed) ?? KNOWN_ROUTES.get(ROUTE_ALIASES.get(trimmed) || '')
  if (direct) return direct
  // Fixed/list routes take precedence; detail routes accept exactly one valid ID.
  for (const [family, id, param] of [
    ['skills', 'settings-skill-detail', 'skillId'],
    ['scheduled-tasks', 'settings-scheduled-task-detail', 'taskId']
  ] as const) {
    const prefix = '/settings/' + family + '/'
    if (!trimmed.startsWith(prefix)) continue
    const encoded = trimmed.slice(prefix.length)
    const value = decodePathParam(encoded)
    if (!encoded || encoded.includes('/') || value === undefined) {
      return { id: 'settings-invalid', path: trimmed, reason: '无效的 ' + param + '：需要一个非空、有效 URI 编码的单一路径段；不允许路径分隔符、控制字符或 . / ..。' }
    }
    return { id, path: trimmed, [param]: value } as RemainingSettingsRoute
  }
  // `/settings/mcp/settings/<serverId>` — the one parameterized source route the
  // mounted subtree navigates to (server-id-scoped MCP detail page).
  const detail = trimmed.match(/^\/settings\/mcp\/settings\/([^/]+)$/)
  if (detail) {
    const serverId = decodePathParam(detail[1])
    return serverId === undefined
      ? { id: 'settings-invalid', path: trimmed, reason: '无效的 serverId：需要有效 URI 编码的单一路径段。' }
      : { id: 'settings-mcp-detail', path: trimmed, serverId }
  }
  const provider = trimmed.match(/^\/settings\/mcp\/([^/]+)$/)
  if (provider && !['servers', 'builtin', 'marketplaces', 'mcp-install', 'npx-search'].includes(provider[1])) {
    const providerKey = decodePathParam(provider[1])
    return providerKey === undefined
      ? { id: 'settings-invalid', path: trimmed, reason: '无效的 providerKey：需要有效 URI 编码的单一路径段。' }
      : { id: 'settings-mcp-provider', path: trimmed, providerKey }
  }
  // Source catch-all (`routes/app/paintings/$.tsx`): ANY path under /app/paintings/* renders
  // the same PaintingPage as the index route. The source file is explicit that the splat
  // segment is NOT a deep link — the page resolves its provider from preference, so
  // `/app/paintings/zhipu` deliberately opens whatever provider is configured, not zhipu.
  //
  // Needed because the launchpad's 绘画 tile resolves to `/app/paintings/<defaultProvider>`
  // (via `getSidebarMenuPath` → `resolveUrl`); without this branch that click landed on
  // 「路由未实现」, which is how the gap was found — by clicking the tile, not by reading code.
  if (/^\/app\/paintings\/.+/.test(trimmed)) return { id: 'paintings-splat', path: trimmed }
  // The mini-app domain is BLOCKED, not merely unregistered — see COMPAT_BLOCKED_ROUTE_NOTES.
  // Matched so its tile lands on a diagnostic that names WHY, instead of the generic
  // "route not implemented" list that says nothing about the tab-shell dependency.
  if (trimmed === '/app/mini-app' || trimmed.startsWith('/app/mini-app/')) {
    return { id: 'mini-app-blocked', path: trimmed }
  }
  return { id: 'unknown', path: trimmed }
}

/** Serializes a route to its `location.hash` form (always `#/...`). */
export function compatRouteHash(route: CompatRoute): string {
  return '#' + route.path
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

/**
 * Subscribes to route changes (browser back/forward included) and returns the
 * current route plus a navigate helper that pushes a new history entry.
 */
export function subscribeCompatRoute(onChange: (route: CompatRoute) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = () => onChange(parseCompatRoute(currentHash()))
  window.addEventListener('hashchange', handler)
  return () => window.removeEventListener('hashchange', handler)
}

export function navigateCompatRoute(route: CompatRoute): void {
  if (typeof window === 'undefined') return
  const next = compatRouteHash(route)
  if (window.location.hash === next) return
  window.location.hash = next
}

/**
 * Replaces an empty hash with the default route on first mount so the window always
 * has a concrete route (and refresh preserves it) without planting a history entry.
 */
export function ensureDefaultCompatRoute(): CompatRoute {
  if (typeof window === 'undefined') return DEFAULT_COMPAT_ROUTE
  if (!currentHash()) {
    window.history.replaceState(null, '', compatRouteHash(DEFAULT_COMPAT_ROUTE))
  }
  return parseCompatRoute(currentHash())
}
