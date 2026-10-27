import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPAT_MCP_DETAIL_PATTERN,
  COMPAT_ROUTE_PATHS,
  COMPAT_SUPPORTED_PATHS,
  DEFAULT_COMPAT_ROUTE,
  compatRouteHash,
  ensureDefaultCompatRoute,
  navigateCompatRoute,
  parseCompatRoute,
  resolveCompatPath,
  subscribeCompatRoute
} from './route-registry'

describe('compat route registry', () => {
  it('parses the implemented source paths', () => {
    expect(parseCompatRoute('#/app/chat')).toEqual({ id: 'chat', path: '/app/chat' })
    expect(parseCompatRoute('#/app/agents')).toEqual({ id: 'agents', path: '/app/agents' })
    expect(parseCompatRoute('#/app/release-notes')).toEqual({ id: 'release-notes', path: '/app/release-notes' })
    expect(parseCompatRoute('#/settings')).toEqual({ id: 'settings-root', path: '/settings' })
    expect(parseCompatRoute('#/settings/system')).toEqual({ id: 'settings-system', path: '/settings/system' })
    expect(parseCompatRoute('#/settings/code-execution')).toEqual({ id: 'settings-code-execution', path: '/settings/code-execution' })
    expect(parseCompatRoute('#/settings/provider')).toEqual({ id: 'settings-provider', path: '/settings/provider' })
    expect(parseCompatRoute('#/settings/mcp')).toEqual({ id: 'settings-mcp', path: '/settings/mcp' })
    expect(parseCompatRoute('#/settings/appearance')).toEqual({ id: 'settings-appearance', path: '/settings/appearance' })
    expect(parseCompatRoute('#/settings/general')).toEqual({ id: 'settings-general', path: '/settings/general' })
    // The data-settings family. These were shipped but unasserted, so a registry edit that
    // dropped one would not have failed anything.
    expect(parseCompatRoute('#/settings/data')).toEqual({ id: 'settings-data', path: '/settings/data' })
    expect(parseCompatRoute('#/settings/dependencies')).toEqual({ id: 'settings-dependencies', path: '/settings/dependencies' })
    expect(parseCompatRoute('#/settings/notifications')).toEqual({ id: 'settings-notifications', path: '/settings/notifications' })
    expect(parseCompatRoute('#/settings/about')).toEqual({ id: 'settings-about', path: '/settings/about' })
    expect(parseCompatRoute('#/settings/prompts')).toEqual({ id: 'settings-prompts', path: '/settings/prompts' })
    expect(parseCompatRoute('#/settings/usage')).toEqual({ id: 'settings-usage', path: '/settings/usage' })
    expect(parseCompatRoute('#/settings/archive')).toEqual({ id: 'settings-archive', path: '/settings/archive' })
  })

  it('normalizes hash, query and trailing slash forms', () => {
    expect(parseCompatRoute('/app/chat')).toEqual({ id: 'chat', path: '/app/chat' })
    expect(parseCompatRoute('#app/chat')).toEqual({ id: 'chat', path: '/app/chat' })
    expect(parseCompatRoute('#/app/chat/?topic=1')).toEqual({ id: 'chat', path: '/app/chat' })
    expect(parseCompatRoute('#/app/agents/')).toEqual({ id: 'agents', path: '/app/agents' })
  })

  it('falls back to the default route for empty input and reports unknown paths', () => {
    expect(parseCompatRoute('')).toEqual(DEFAULT_COMPAT_ROUTE)
    expect(parseCompatRoute(null)).toEqual(DEFAULT_COMPAT_ROUTE)
    expect(parseCompatRoute('#/settings/unknown')).toEqual({ id: 'unknown', path: '/settings/unknown' })
  })

  it('resolves the parameterized MCP detail route and its servers alias', () => {
    expect(parseCompatRoute('#/settings/mcp/settings/mcp_abc')).toEqual({
      id: 'settings-mcp-detail', path: '/settings/mcp/settings/mcp_abc', serverId: 'mcp_abc'
    })
    // Decoded so an id with reserved characters survives the round trip.
    expect(parseCompatRoute('#/settings/mcp/settings/a%20b')).toMatchObject({ serverId: 'a b' })
    // The layout route's list sub-path is an alias of the list route.
    expect(parseCompatRoute('#/settings/mcp/servers')).toEqual({ id: 'settings-mcp', path: '/settings/mcp' })
    // A deeper path is still unknown, not silently absorbed.
    expect(parseCompatRoute('#/settings/mcp/settings/a/b').id).toBe('unknown')
  })

  it('substitutes $param templates and throws on a missing param', () => {
    expect(resolveCompatPath('/settings/mcp/settings/$serverId', { serverId: 'mcp_1' })).toBe('/settings/mcp/settings/mcp_1')
    expect(resolveCompatPath('/settings/provider')).toBe('/settings/provider')
    expect(() => resolveCompatPath('/settings/mcp/settings/$serverId', {})).toThrow('$serverId')
  })

  it('serializes back to a hash form', () => {
    expect(compatRouteHash({ id: 'chat', path: COMPAT_ROUTE_PATHS.chat })).toBe('#/app/chat')
    expect(compatRouteHash({ id: 'unknown', path: '/nope' })).toBe('#/nope')
  })
})

describe('compat route browser integration', () => {
  const originalHash = window.location.hash

  beforeEach(() => {
    window.history.replaceState(null, '', '#/app/chat')
  })

  afterEach(() => {
    window.history.replaceState(null, '', originalHash || '#/app/chat')
  })

  it('navigates by pushing a new hash and notifies subscribers', async () => {
    const routes: string[] = []
    const unsubscribe = subscribeCompatRoute(route => routes.push(route.path))
    navigateCompatRoute({ id: 'settings-mcp', path: COMPAT_ROUTE_PATHS['settings-mcp'] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(window.location.hash).toBe('#/settings/mcp')
    expect(routes).toContain('/settings/mcp')
    unsubscribe()
  })

  it('plants the default route on an empty hash without a history entry', () => {
    window.history.replaceState(null, '', window.location.pathname)
    const route = ensureDefaultCompatRoute()
    expect(route.id).toBe('chat')
    expect(window.location.hash).toBe('#/app/chat')
  })

  it('keeps an existing hash untouched when ensuring the default route', () => {
    window.history.replaceState(null, '', '#/app/agents')
    expect(ensureDefaultCompatRoute().id).toBe('agents')
  })

  it('stops delivering after unsubscribe', async () => {
    const onChange = vi.fn()
    const unsubscribe = subscribeCompatRoute(onChange)
    unsubscribe()
    navigateCompatRoute({ id: 'agents', path: COMPAT_ROUTE_PATHS.agents })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('compat supported-path list', () => {
  // The blocked-route message used to be a hand-written literal and went stale three times
  // as routes were added. It is now DERIVED from `COMPAT_ROUTE_PATHS`, which is the fix —
  // and it means a test comparing the two would be a tautology (it compares an object to
  // itself). That test was written first and a mutation check proved it could not fail, so
  // it was deleted rather than kept as decoration. What remains asserts things derivation
  // does NOT guarantee on its own.

  it('has no duplicates — a derived list must not repeat a path', () => {
    expect(new Set(COMPAT_SUPPORTED_PATHS).size).toBe(COMPAT_SUPPORTED_PATHS.length)
  })

  it('resolves every listed path back to a non-unknown route', () => {
    // Derivation guarantees the paths are IN the map; it does not guarantee the PARSER
    // matches them. This is what the user's blocked-route message promises, so each entry
    // must actually resolve — a listed path that parses as `unknown` would be a lie in the
    // one place someone looks to find a working URL.
    for (const path of COMPAT_SUPPORTED_PATHS) {
      const parsed = parseCompatRoute('#' + path)
      expect(parsed.id, path + ' should resolve').not.toBe('unknown')
    }
  })

  it('lists a path for every entry in the path map', () => {
    // Not a tautology: this compares the DERIVED list against the map's own keys, so it
    // fails if the derivation is ever changed to filter or transform (the mutation that
    // motivated keeping this shape filtered one path out of the spread).
    // MCP detail, skill detail and scheduled-task detail are parameterized source paths.
    expect(COMPAT_SUPPORTED_PATHS.length).toBe(Object.keys(COMPAT_ROUTE_PATHS).length + 3)
  })
})
