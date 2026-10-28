import { BrowserWindow, shell } from 'electron'

import { readCherryPreference } from './cherry-preference-consumers'
import { openBrowserHost } from './browser-host.service'

// Where a web link goes (M3).
//
// `app.browser.open_links_in_browser` decides whether clicks open in the embedded browser or leave for
// the system one. The rule is applied in ONE place so a link cannot take two different routes depending
// on which surface opened it.
export type OpenTarget = 'embedded' | 'system'

export function resolveOpenTarget(url: string): OpenTarget {
  let parsed: URL
  try { parsed = new URL(url) } catch { return 'system' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'system'
  return readCherryPreference('app.browser.open_links_in_browser') === true ? 'embedded' : 'system'
}

export interface OpenResult { readonly target: OpenTarget; readonly url: string }

export async function openWebLink(input: {
  url: string
  window: BrowserWindow | null
  windowLikeFactory?: (window: BrowserWindow) => { getContentBounds(): { x: number; y: number; width: number; height: number }; contentView: { addChildView(view: unknown): void } }
  createView?: (options: { partition: string }) => never
}): Promise<OpenResult> {
  const parsed = new URL(input.url).toString()
  const target = resolveOpenTarget(parsed)
  if (target === 'system' || !input.window) {
    await shell.openExternal(parsed)
    return { target: 'system', url: parsed }
  }
  // Embedded: reuse a single host per window so repeated clicks navigate instead of stacking views.
  const window = input.window
  const content = window.getContentBounds()
  openBrowserHost('external-links', {
    window: (input.windowLikeFactory ? input.windowLikeFactory(window) : window) as never,
    createView: input.createView as never,
    url: parsed,
    // The external view covers the window: links opened from a link mean the user wants to read the page.
    bounds: { x: 0, y: 0, width: content.width, height: content.height },
  })
  return { target: 'embedded', url: parsed }
}
