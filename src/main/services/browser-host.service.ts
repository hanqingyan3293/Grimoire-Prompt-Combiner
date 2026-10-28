// Browser host (M3).
//
// The source browser lives in an embedded view. Grimoire panels are React, so the view has to be owned
// by the main process and positioned at the rectangle the renderer reports. Everything here is injected
// (window, view factory, session) so the lifecycle and validation can be tested without Electron.
export interface Bounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface BrowserViewLike {
  setBounds(bounds: Bounds): void
  destroy?(): void
  webContents: {
    loadURL(url: string): Promise<void> | void
    on(event: string, listener: (...args: unknown[]) => void): void
    getURL?(): string
    close?(): void
  }
}

export interface BrowserWindowLike {
  contentView: { addChildView(view: unknown): void; removeChildView?(view: unknown): void }
  getContentBounds(): Bounds
  isDestroyed?(): boolean
}

export type ViewFactory = (options: { partition: string }) => BrowserViewLike

export class BrowserHostError extends Error {
  constructor(readonly code: 'BAD_URL' | 'BAD_BOUNDS' | 'NOT_FOUND' | 'CLOSED', message: string) {
    super(message)
    this.name = 'BrowserHostError'
  }
}

export interface BrowserHostOptions {
  readonly window: BrowserWindowLike
  readonly createView: ViewFactory
  readonly onVisit?: (visit: { url: string; title: string }) => void
}

interface HostRecord { view: BrowserViewLike; bounds: Bounds; url: string; title: string }

const hosts = new Map<string, HostRecord>()

export function cleanBrowserUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) throw new BrowserHostError('BAD_URL', 'url is required')
  // A user typing `example.com` should work; anything that already has a scheme must be http/https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw
  let parsed: URL
  try { parsed = new URL(candidate) } catch { throw new BrowserHostError('BAD_URL', 'not a url: ' + raw) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new BrowserHostError('BAD_URL', 'unsupported protocol: ' + parsed.protocol)
  return parsed.toString()
}

const MIN_WIDTH = 80
const MIN_HEIGHT = 60

// Position is clamped so a view can never be pushed past the window edge, and size is clamped to the
// space that is actually left — clamping width to the window width alone would still overflow at x=1150.
function clampBounds(bounds: Bounds, window: BrowserWindowLike): Bounds {
  const limit = window.getContentBounds()
  const round = (value: number) => Math.max(0, Math.round(value))
  const x = Math.min(round(bounds.x), Math.max(0, round(limit.width) - MIN_WIDTH))
  const y = Math.min(round(bounds.y), Math.max(0, round(limit.height) - MIN_HEIGHT))
  const width = Math.min(round(bounds.width), round(limit.width) - x)
  const height = Math.min(round(bounds.height), round(limit.height) - y)
  if (width < MIN_WIDTH || height < MIN_HEIGHT) throw new BrowserHostError('BAD_BOUNDS', 'browser view needs at least ' + MIN_WIDTH + 'x' + MIN_HEIGHT + ' px')
  return { x, y, width, height }
}

export function openBrowserHost(id: string, options: BrowserHostOptions & { url: string; bounds: Bounds; partition?: string }): { id: string; url: string } {
  if (hosts.has(id)) closeBrowserHost(id, options.window)
  const url = cleanBrowserUrl(options.url)
  const bounds = clampBounds(options.bounds, options.window)
  const view = options.createView({ partition: options.partition || 'persist:grimoire-browser' })
  const record: HostRecord = { view, bounds, url, title: '' }
  hosts.set(id, record)
  options.window.contentView.addChildView(view)
  view.setBounds(bounds)
  view.webContents.on('did-navigate', (event, navUrl) => {
    const next = typeof navUrl === 'string' ? navUrl : String((event as { url?: string })?.url ?? '')
    if (!next) return
    record.url = next
    options.onVisit?.({ url: next, title: record.title })
  })
  view.webContents.on('page-title-updated', (_event, title) => {
    record.title = typeof title === 'string' ? title : ''
    options.onVisit?.({ url: record.url, title: record.title })
  })
  void view.webContents.loadURL(url)
  return { id, url }
}

export function updateBrowserHostBounds(id: string, bounds: Bounds, window: BrowserWindowLike): Bounds {
  const record = hosts.get(id)
  if (!record) throw new BrowserHostError('NOT_FOUND', 'no browser view ' + id)
  const clamped = clampBounds(bounds, window)
  record.bounds = clamped
  record.view.setBounds(clamped)
  return clamped
}

export function navigateBrowserHost(id: string, url: string): string {
  const record = hosts.get(id)
  if (!record) throw new BrowserHostError('NOT_FOUND', 'no browser view ' + id)
  const clean = cleanBrowserUrl(url)
  record.url = clean
  void record.view.webContents.loadURL(clean)
  return clean
}

export function closeBrowserHost(id: string, window?: BrowserWindowLike): boolean {
  const record = hosts.get(id)
  if (!record) return false
  hosts.delete(id)
  try { window?.contentView.removeChildView?.(record.view) } catch {}
  try { record.view.destroy?.() } catch {}
  try { record.view.webContents.close?.() } catch {}
  return true
}

export function getBrowserHost(id: string): { url: string; title: string; bounds: Bounds } | null {
  const record = hosts.get(id)
  if (!record) return null
  return { url: record.url, title: record.title, bounds: record.bounds }
}

export function closeAllBrowserHosts(): void {
  for (const id of [...hosts.keys()]) closeBrowserHost(id)
}
