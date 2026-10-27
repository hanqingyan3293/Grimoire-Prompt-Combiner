import type { BrowserWindow, WebContents } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { isAllowedNavigationPath } from '../../vendor/cherry/source/src/shared/utils/navigationPath'

/** Source IpcResult shape. Successful navigation requests resolve to void. */
export type CherryNavigationResult =
  | { ok: true; data: null | undefined }
  | { ok: false; error: { code: string; message: string } }

export const CHERRY_NAVIGATION_QUEUE_CAPACITY = 32
export const CHERRY_NAVIGATION_QUEUE_TTL_MS = 15_000
const MAX_PATH_LENGTH = 2048
export const OPEN_ROUTE_EVENT = 'navigation.open_route_requested'

// Actual createFileRoute paths in source/src/renderer/routes/{app,settings}.
// Index trailing slashes are normalized here; no broad /app or /settings prefix
// admission. Reuse the pure source matcher (no application/container imports).
// Source mainWindowNavigation itself cannot be imported safely: its singleton
// depends on Cherry's application, WindowManager and main/data services.
const SOURCE_ROUTES = [
  '/app/chat', '/app/agents', '/app/browser', '/app/code', '/app/file-preview',
  '/app/files', '/app/knowledge', '/app/launchpad', '/app/mini-app',
  '/app/mini-app/$appId', '/app/notes', '/app/paintings', '/app/paintings/$',
  '/app/release-notes', '/app/translate',
  '/settings', '/settings/about', '/settings/api-gateway', '/settings/appearance',
  '/settings/archive', '/settings/browser', '/settings/channels',
  '/settings/code-execution', '/settings/data', '/settings/dependencies',
  '/settings/device-connections', '/settings/file-processing', '/settings/general',
  '/settings/local-models', '/settings/mcp', '/settings/mcp/builtin',
  '/settings/mcp/marketplaces', '/settings/mcp/mcp-install', '/settings/mcp/npx-search',
  '/settings/mcp/servers', '/settings/mcp/settings/$serverId', '/settings/model',
  '/settings/notifications', '/settings/ocr', '/settings/prompts', '/settings/provider',
  '/settings/quick-assistant', '/settings/scheduled-tasks',
  '/settings/scheduled-tasks/$taskId', '/settings/screenshot', '/settings/search',
  '/settings/selection-assistant', '/settings/shortcut', '/settings/skills',
  '/settings/skills/$skillId', '/settings/system', '/settings/usage', '/settings/websearch'
] as const
// Deliberately omit the source /settings/mcp/$ catch-all: it accepts arbitrary
// descendants. Only explicit MCP routes above are admitted at this boundary.

interface PendingRoute {
  to: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
  resolve: (result: CherryNavigationResult) => void
}
interface ShellRegistration {
  window: BrowserWindow
  contents: WebContents
  generation: number
  readyGeneration: number | null
  pending: PendingRoute[]
  dispose: () => void
}
let shell: ShellRegistration | undefined

const success = (): CherryNavigationResult => ({ ok: true, data: undefined })
function failure(code: string, message: string): CherryNavigationResult {
  // Never include an untrusted path, URL, query, or native error in diagnostics.
  return { ok: false, error: { code, message } }
}
function isLive(registration: ShellRegistration): boolean {
  return !registration.window.isDestroyed() && !registration.contents.isDestroyed()
}
function invalidate(registration: ShellRegistration): void {
  registration.generation++
  registration.readyGeneration = null
}
function canDeliver(registration: ShellRegistration): boolean {
  if (!isLive(registration)) return false
  // Covers reload() -> did-start-navigation and crash-event gaps, as upstream
  // isTabDeliveryReady does. A duplicate ready must not re-enable a loading page.
  if (registration.contents.isLoadingMainFrame() || registration.contents.isCrashed()) {
    invalidate(registration)
    return false
  }
  return registration.readyGeneration === registration.generation
}
function finish(registration: ShellRegistration, pending: PendingRoute, result: CherryNavigationResult): void {
  const index = registration.pending.indexOf(pending)
  if (index === -1) return
  registration.pending.splice(index, 1)
  clearTimeout(pending.timer)
  pending.resolve(result)
}
function expire(registration: ShellRegistration): void {
  for (const pending of [...registration.pending]) {
    if (pending.expiresAt <= Date.now()) {
      finish(registration, pending, failure('NAVIGATION_QUEUE_EXPIRED', 'Cherry navigation request expired before delivery'))
    }
  }
}
function deliver(registration: ShellRegistration, to: string): CherryNavigationResult {
  try {
    // Exact source schema: { to }, directed only to the registered shell.
    registration.contents.send(IPC_CHANNELS.CHERRY_NAVIGATION_OPEN_ROUTE, { to })
    return success()
  } catch {
    invalidate(registration)
    return failure('NAVIGATION_DELIVERY_FAILED', 'Cherry navigation event could not be delivered')
  }
}
function drain(registration: ShellRegistration): void {
  expire(registration)
  while (registration.pending.length && canDeliver(registration)) {
    const pending = registration.pending[0]
    finish(registration, pending, deliver(registration, pending.to))
  }
}
function admittedSender(sender: WebContents | null): ShellRegistration | undefined {
  if (!shell || !sender || sender !== shell.contents) return undefined
  if (!isLive(shell)) {
    shell.dispose()
    return undefined
  }
  return shell
}

/**
 * Explicit main-process shell admission; call immediately after BrowserWindow
 * creation, before loadFile. Neither a window id nor a renderer-supplied identity
 * can register a shell. The coordinator must additionally validate event.senderFrame
 * (main frame + trusted source URL) before calling this module with event.sender.
 * Returns an idempotent listener-cleanup disposer. A second live shell is refused.
 */
export function registerCherryNavigationWindow(window: BrowserWindow): () => void {
  if (shell?.window === window && isLive(shell)) return shell.dispose
  if (shell && isLive(shell)) throw new Error('A Cherry navigation shell is already registered')
  shell?.dispose()
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    throw new Error('Cannot register a destroyed Cherry navigation shell')
  }
  const contents = window.webContents
  const registration: ShellRegistration = {
    window, contents, generation: 0, readyGeneration: null, pending: [], dispose: () => undefined
  }
  const onNavigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame && !isInPlace) invalidate(registration)
  }
  const onCrash = () => invalidate(registration)
  const onDestroy = () => registration.dispose()
  let disposed = false
  registration.dispose = () => {
    if (disposed) return
    disposed = true
    invalidate(registration)
    contents.removeListener('did-start-navigation', onNavigation)
    contents.removeListener('render-process-gone', onCrash)
    contents.removeListener('destroyed', onDestroy)
    window.removeListener('closed', onDestroy)
    for (const pending of [...registration.pending]) {
      finish(registration, pending, failure('NAVIGATION_WINDOW_CLOSED', 'Cherry navigation shell was closed or unregistered'))
    }
    if (shell === registration) shell = undefined
  }
  contents.on('did-start-navigation', onNavigation)
  contents.on('render-process-gone', onCrash)
  contents.on('destroyed', onDestroy)
  window.on('closed', onDestroy)
  shell = registration
  return registration.dispose
}

export function isRegisteredCherryNavigationSender(sender: WebContents | null): boolean {
  return admittedSender(sender) !== undefined
}

/** No cold-start producer is installed; never fabricate a navigation or tab. */
export function getCherryNavigationInitData(sender: WebContents | null = null): CherryNavigationResult {
  return admittedSender(sender)
    ? { ok: true, data: null }
    : failure('NAVIGATION_INVALID_SENDER', 'Cherry navigation requires the registered shell sender')
}

/**
 * Shell-only ADAPTER of mainWindowNavigation + ProtocolService readiness reset.
 * Deviation: source live navigation is ephemeral even before readiness; here
 * accepted pre-ready commands wait in a bounded, nonpersistent FIFO (32 / 15s).
 * Their promises resolve with source void only after send, or an explicit expiry,
 * capacity, close or delivery failure. Dispatcher must await this return value.
 * Reload/crash retains only undelivered requests until TTL; delivered routes are
 * never replayed. Registration destruction clears requests, not retargets them.
 * No OS protocol ingress/registration, tab attach, conversation ownership, URL
 * import or window creation/focus policy is provided by this scoped adapter.
 */
export function handleCherryNavigationRequest(
  route: string,
  input: unknown,
  sender: WebContents | null = null
): CherryNavigationResult | Promise<CherryNavigationResult> | undefined {
  if (route !== 'navigation.protocol_dispatch_ready' && route !== 'navigation.open_route_in_main' &&
      route !== 'navigation.ack_open_route') return undefined
  const registration = admittedSender(sender)
  if (!registration) return failure('NAVIGATION_INVALID_SENDER', 'Cherry navigation requires the registered shell sender')

  if (route === 'navigation.protocol_dispatch_ready') {
    if (input !== undefined) return failure('INVALID_INPUT', 'Cherry navigation readiness input must be void')
    if (registration.contents.isLoadingMainFrame() || registration.contents.isCrashed()) {
      invalidate(registration)
      return failure('NAVIGATION_RENDERER_NOT_READY', 'Cherry renderer is loading or crashed')
    }
    registration.readyGeneration = registration.generation
    drain(registration)
    return success()
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('INVALID_INPUT', 'Invalid Cherry navigation request input')
  }
  const value = input as Record<string, unknown>
  if (route === 'navigation.ack_open_route') {
    if (Object.keys(value).length !== 1 || !Number.isSafeInteger(value.requestId) || (value.requestId as number) < 0) {
      return failure('INVALID_INPUT', 'Invalid Cherry navigation acknowledgement')
    }
    // Source ACK only clears matching cold init data. None exists here, so a
    // valid ACK truthfully has nothing to clear; it never acknowledges the FIFO.
    return success()
  }
  if (Object.keys(value).length !== 1 || typeof value.path !== 'string') {
    return failure('INVALID_INPUT', 'Cherry route input requires only a path string')
  }
  const path = value.path
  // Strict internal paths only: no query (including protocolInstallRequestId,
  // provider payloads, OAuth tokens), fragment, encoding, control or whitespace.
  // Do not decode/normalize a forbidden route into an allowed one.
  if (path.length > MAX_PATH_LENGTH || /[?\x23%\s\x00-\x1f\x7f]/u.test(path) ||
      !isAllowedNavigationPath(path, SOURCE_ROUTES)) {
    return failure('NAVIGATION_ROUTE_FORBIDDEN', 'Cherry navigation path is not allowlisted')
  }
  expire(registration)
  if (canDeliver(registration)) return deliver(registration, path)
  if (registration.pending.length >= CHERRY_NAVIGATION_QUEUE_CAPACITY) {
    return failure('NAVIGATION_QUEUE_FULL', 'Cherry navigation queue capacity exceeded')
  }
  return new Promise<CherryNavigationResult>(resolve => {
    const pending: PendingRoute = {
      to: path, expiresAt: Date.now() + CHERRY_NAVIGATION_QUEUE_TTL_MS, resolve,
      timer: setTimeout(() => {
        finish(registration, pending, failure('NAVIGATION_QUEUE_EXPIRED', 'Cherry navigation request expired before delivery'))
      }, CHERRY_NAVIGATION_QUEUE_TTL_MS)
    }
    pending.timer.unref?.()
    registration.pending.push(pending)
  })
}
