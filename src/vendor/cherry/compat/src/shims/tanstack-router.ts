import { createContext, createElement, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { parseCompatRoute, resolveCompatPath } from '../route-registry'
import { isQueryTooLarge } from '../../../source/src/renderer/pages/settings/settingsSearch/searchEngine'

/**
 * `@tanstack/react-router` shim over the compat hash route registry.
 *
 * The mounted source settings subtree uses a bounded set of router surface:
 * `useNavigate` (both `{ to }` and `{ to: '/settings/mcp/settings/$serverId', params }`),
 * `useSearch`, `useLocation` (the MCP layout derives its active view from `pathname`),
 * `useParams` (the MCP detail page reads `serverId`), `getRouteApi(...)` and `Outlet`.
 * The full Cherry route tree is not in the vendored closure, so the compat project
 * aliases this module to the shim and those calls land on `route-registry.ts`.
 *
 * Every hash-derived hook subscribes to `hashchange` through
 * `useSyncExternalStore`, so a navigation re-renders the mounted subtree with the
 * NEW params/search — a `useMemo(..., [])` snapshot would keep serving the params
 * from first mount and render a detail page for the wrong route.
 *
 * Anything outside the supported call shapes throws, so the shim cannot silently
 * swallow a router capability the compat window does not have.
 */

type NavigateOptions = {
  to?: string
  search?: Record<string, unknown> | ((previous: Record<string, unknown>) => Record<string, unknown>)
  replace?: boolean
  params?: Record<string, unknown>
}

function subscribeHashChange(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

/** Raw hash without the leading `#` — a primitive, so `useSyncExternalStore` can compare it. */
function hashSnapshot(): string {
  if (typeof window === 'undefined') return ''
  return window.location.hash.replace(/^#/, '')
}

function pathAndQuery(raw: string): { pathname: string; query: URLSearchParams } {
  const queryIndex = raw.indexOf('?')
  const pathname = queryIndex === -1 ? raw : raw.slice(0, queryIndex)
  return { pathname: pathname || '/', query: new URLSearchParams(queryIndex === -1 ? '' : raw.slice(queryIndex + 1)) }
}

function searchRecord(query: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {}
  query.forEach((value, key) => { result[key] = value })
  return result
}

function serializeSearch(search: Record<string, unknown> | undefined): string {
  if (!search) return ''
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const text = query.toString()
  return text ? '?' + text : ''
}

export function useNavigate(): (options: NavigateOptions) => Promise<void> {
  return useCallback(async (options: NavigateOptions) => {
    if (!options || (options.to !== undefined && typeof options.to !== 'string')) {
      throw new Error('compat router shim: navigate() requires valid route options')
    }
    if (typeof window === 'undefined') return
    const current = pathAndQuery(hashSnapshot())
    const resolved = resolveCompatPath(options.to ?? current.pathname, options.params)
    // Apply source functional search updaters at navigation time, not against a render
    // snapshot: focusId and provider id consumers must not resurrect each other's keys.
    const search = typeof options.search === 'function' ? options.search(searchRecord(current.query)) : options.search
    const next = '#' + resolved + serializeSearch(search)
    if (window.location.hash === next) return
    if (options.replace) {
      window.history.replaceState(null, '', next)
      // replaceState does not fire `hashchange`; notify listeners so views re-render.
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    } else {
      window.location.hash = next
    }
  }, [])
}

export function useSearch<TParams = Record<string, unknown>>(_options?: { strict?: boolean; from?: string }): TParams {
  const raw = useSyncExternalStore(subscribeHashChange, hashSnapshot, () => '')
  return useMemo(() => {
    const { pathname, query } = pathAndQuery(raw)
    const search = searchRecord(query)
    // Same source search-route admission: oversized q degrades to empty query. Other
    // setting query keys (focusId, panel, provider id) are preserved for their consumers.
    if (pathname === '/settings/search' && typeof search.q === 'string' && isQueryTooLarge(search.q)) delete search.q
    return search as TParams
  }, [raw])
}

/**
 * `useLocation` in the source subtree is read for `pathname` (the MCP settings layout
 * decides its active sub-view from it). The shim exposes the hash path plus query.
 */
export function useLocation(): { pathname: string; search: Record<string, string>; hash: string } {
  const raw = useSyncExternalStore(subscribeHashChange, hashSnapshot, () => '')
  return useMemo(() => {
    const { pathname, query } = pathAndQuery(raw)
    return { pathname, search: searchRecord(query), hash: raw ? '#' + raw : '' }
  }, [raw])
}

/** Project only the validated names from the matched compat route. A task or skill ID
 * must not be mislabelled serverId, and invalid route IDs never reach a detail query. */
export function useParams<TParams = Record<string, string>>(_options?: { strict?: boolean }): TParams {
  const raw = useSyncExternalStore(subscribeHashChange, hashSnapshot, () => '')
  return useMemo(() => {
    const route = parseCompatRoute(raw)
    const params: Record<string, string> = {}
    if (route.id === 'settings-mcp-detail') params.serverId = route.serverId
    if (route.id === 'settings-mcp-provider') params._splat = route.providerKey
    if (route.id === 'settings-skill-detail') params.skillId = route.skillId
    if (route.id === 'settings-scheduled-task-detail') params.taskId = route.taskId
    if (route.id === 'paintings-splat') params._splat = route.path.slice('/app/paintings/'.length)
    return params as TParams
  }, [raw])
}

/**
 * `getRouteApi(path)` returns a per-route facade whose `useSearch`/`useParams` delegate
 * to the shim hooks. The callback form of `useNavigate` (route-scoped navigation) is not
 * exercised by the mounted subtree, so it throws rather than guessing semantics.
 */
export function getRouteApi(_routeId: string): {
  useSearch: typeof useSearch
  useParams: typeof useParams
  useNavigate: typeof useNavigate
} {
  return { useSearch, useParams, useNavigate }
}

/**
 * `Outlet` renders the routed child. The compat window has no nested router, so the
 * settings pages that read it render nothing below the submenu — the explicit blocked
 * submenu items already communicate which sub-routes exist.
 */
const outletContext = createContext<ReactNode>(null)

/** Owned nested-route seam: compat pages may provide the active child explicitly while
 * the hash registry remains the outer URL source. This is not a generated TanStack tree. */
export function CompatOutletProvider({ outlet, children }: { outlet: ReactNode; children: ReactNode }): ReactNode {
  return createElement(outletContext.Provider, { value: outlet }, children)
}

export function Outlet(): ReactNode {
  return useContext(outletContext)
}

/** Unsupported surface: fails loudly rather than pretending the router exists. */
const compatHistory = {
  canGoBack: () => typeof window !== 'undefined' && window.history.length > 1,
  back: () => { if (typeof window !== 'undefined') window.history.back() }
}
const compatRouter = { history: compatHistory }

/** Bounded source SettingsSearchBox history seam; no generated router is claimed. */
export function useRouter(): typeof compatRouter {
  return compatRouter
}

type CompatLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string
  search?: NavigateOptions['search']
  params?: NavigateOptions['params']
  replace?: boolean
}

/** Preserve native anchor semantics while source route links navigate through the hash
 * boundary. Modified clicks retain the real href; ordinary clicks use the same query and
 * history contract as useNavigate. External URLs belong to the main-process website API. */
export function Link({ to, search, params, replace, children, onClick, ...props }: CompatLinkProps): ReactNode {
  if (!to.startsWith('/') || to.startsWith('//') || /[\\\x00-\x1f]/.test(to)) {
    throw new Error('compat router shim: Link requires an internal route path')
  }
  const raw = useSyncExternalStore(subscribeHashChange, hashSnapshot, () => '')
  const navigate = useNavigate()
  const resolved = resolveCompatPath(to, params)
  const query = typeof search === 'function' ? search(searchRecord(pathAndQuery(raw).query)) : search
  const href = '#' + resolved + serializeSearch(query)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (props.target && props.target !== '_self')) return
    event.preventDefault()
    void navigate({ to, search, params, replace })
  }
  return createElement('a', { ...props, href, onClick: handleClick }, children)
}
