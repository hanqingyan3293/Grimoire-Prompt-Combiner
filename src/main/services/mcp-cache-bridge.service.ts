import { createHash } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { McpServerRecord } from '../../shared/agent-types'
import { listMcpServers, onMcpServersChanged } from './mcp.service'

/**
 * Shared-cache bridge for the mounted source MCP pages.
 *
 * The source renderer `CacheService` reads `window.api.cache.getAllShared()` on init
 * and subscribes to `window.api.cache.onSync`; the source main-process
 * `McpRuntimeService`/`McpCatalogService` write `mcp.status.<serverId>` and
 * `mcp.tools.<serverId>` into that shared tier, and the source MCP detail page's
 * runtime badge and tools tab read them from there. Cherry's main `CacheService` is
 * bound to Cherry's application core (lifecycle, `@application`) and is not mountable
 * here, so this module serves the same two channel names backed by the Grimoire MCP
 * tables as the single writer, with the value shapes copied verbatim:
 *
 * - `mcp.status.<id>` = `{ state: 'disabled'|'connecting'|'connected'|'error', lastCheckedAt, lastError? }`
 * - `mcp.tools.<id>`  = the source `McpTool[]` shape
 *
 * Entries are re-derived from the Grimoire tables on every read and after every MCP
 * mutation — this is a projection, never a second store.
 */

export const CHANNEL_CACHE_GET_ALL_SHARED = 'cache:get-all-shared'
export const CHANNEL_CACHE_SYNC = 'cache:sync'

/** The source leaves `expireAt` unset for non-expiring entries. */
const NO_EXPIRY = undefined

export const MCP_STATUS_CACHE_PREFIX = 'mcp.status.'
export const MCP_TOOLS_CACHE_PREFIX = 'mcp.tools.'

type CacheEntry = { value: unknown; expireAt?: number }

export type McpRuntimeStatus = {
  state: 'disabled' | 'connecting' | 'connected' | 'error'
  lastCheckedAt: number
  lastError?: string
}

/** ASCII camelCase slug, mirroring the source `toCamelCase` body. */
export function toWireSlug(value: string): string {
  let result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
  if (result && !/^[a-zA-Z_]/.test(result)) result = '_' + result
  return result
}

/**
 * Source `McpTool.id` (`src/main/ai/mcp/mcpToolId.ts`): `mcp__<serverSlug>__<toolSlug>_<digest>`
 * with `digest = sha256(serverId + '\0' + toolName)[0,20)`. The identity-bearing digest
 * is byte-identical to the source. The source additionally romanizes CJK names through
 * `tiny-pinyin` before slugging; a pinyin the compat renderer cannot reproduce would
 * desynchronize the id between the list and `mcpSourcePolicy`'s rule matching, so
 * non-ASCII names fall back to the same ASCII slug the source uses when pinyin is
 * unsupported. Rule matching still works because `matchesMcpSourceToolRule` also
 * matches the raw tool name, which is what both sides store.
 */
export function mcpToolWireId(serverId: string, serverName: string, toolName: string): string {
  const digest = createHash('sha256').update(serverId).update('\0').update(toolName).digest('hex').slice(0, 20)
  const serverPart = toWireSlug(serverName) || 'server'
  const toolPart = toWireSlug(toolName) || 'tool'
  const suffix = '_' + digest
  const body = ('mcp__' + serverPart + '__' + toolPart).slice(0, 63 - suffix.length).replace(/_+$/, '')
  return body + suffix
}

export function mcpRuntimeStatusFor(record: McpServerRecord): McpRuntimeStatus {
  const lastCheckedAt = Date.now()
  if (!record.enabled) return { state: 'disabled', lastCheckedAt }
  if (record.status === 'connected') return { state: 'connected', lastCheckedAt }
  if (record.status === 'failed') {
    return { state: 'error', lastCheckedAt, ...(record.error_message ? { lastError: record.error_message } : {}) }
  }
  // 'disconnected' and 'connecting' both read as connecting for an enabled server —
  // the source default for an active server whose runtime has not reported yet.
  return { state: 'connecting', lastCheckedAt }
}

export function mcpToolsFor(record: McpServerRecord): Array<Record<string, unknown>> {
  return record.tools.map(tool => ({
    id: mcpToolWireId(record.id, record.name, tool.name),
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    type: 'mcp',
    serverId: record.id,
    serverName: record.name,
    inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} }
  }))
}

/** Derives every `mcp.*` shared-cache entry the source main process would hold. */
export function snapshotMcpEntries(): Record<string, CacheEntry> {
  const entries: Record<string, CacheEntry> = {}
  for (const record of listMcpServers()) {
    entries[MCP_STATUS_CACHE_PREFIX + record.id] = { value: mcpRuntimeStatusFor(record), expireAt: NO_EXPIRY }
    entries[MCP_TOOLS_CACHE_PREFIX + record.id] = {
      value: record.status === 'connected' ? mcpToolsFor(record) : [],
      expireAt: NO_EXPIRY
    }
  }
  return entries
}

function broadcastSync(message: { type: 'shared'; key: string; value: unknown; expireAt?: number }): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNEL_CACHE_SYNC, message)
  }
}

/**
 * Serves the source cache channels and pushes a sync per changed `mcp.*` key.
 * Diffed against the last snapshot so a no-op status touch does not spam IPC — the
 * same no-op guard the source `McpRuntimeService.setServerStatus` applies.
 */
export function registerMcpCacheBridgeIPC(): void {
  let lastSnapshot: Record<string, CacheEntry> = {}

  ipcMain.handle(CHANNEL_CACHE_GET_ALL_SHARED, () => {
    lastSnapshot = snapshotMcpEntries()
    return lastSnapshot
  })

  const publish = (): void => {
    const next = snapshotMcpEntries()
    for (const [key, entry] of Object.entries(next)) {
      const previous = lastSnapshot[key]
      if (previous && JSON.stringify(previous.value) === JSON.stringify(entry.value)) continue
      broadcastSync({ type: 'shared', key, value: entry.value, expireAt: entry.expireAt })
    }
    // A removed server's entries vanish: an `undefined` value is the source
    // renderer CacheService's deletion tombstone (physical delete + notify).
    for (const key of Object.keys(lastSnapshot)) {
      if (!(key in next)) broadcastSync({ type: 'shared', key, value: undefined, expireAt: NO_EXPIRY })
    }
    lastSnapshot = next
  }

  onMcpServersChanged(publish)
}

/** Test hook: the pure projections, without any Electron dependency. */
export const __test = { toWireSlug, mcpToolWireId, mcpRuntimeStatusFor, mcpToolsFor }
