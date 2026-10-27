import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebContents, WebFrameMain } from 'electron'

/** Structural Electron surface, so tests exercise the guard without mocking Electron. */
export interface CherryIpcEventLike {
  sender: Pick<WebContents, 'isDestroyed' | 'isCrashed' | 'getURL'> & {
    readonly mainFrame: CherryIpcFrameLike
  }
  readonly senderFrame: CherryIpcFrameLike | null
}
export type CherryIpcFrameLike = Pick<WebFrameMain, 'url' | 'detached'> & {
  readonly parent: CherryIpcFrameLike | null
  readonly top: CherryIpcFrameLike | null
}

export interface CherryIpcAdmissionPolicy<TSender extends CherryIpcEventLike['sender'] = CherryIpcEventLike['sender']> {
  /** Main-owned registration lookup; NEVER a renderer id, preload marker or URL test. */
  isRegisteredSender: (sender: TSender) => boolean
  /** Exact absolute HTML paths selected by main's loader, not renderer input. */
  allowedDocumentPaths: readonly string[]
}

/**
 * Match one local document, not a scheme or directory. Hashes are allowed because
 * the existing compat router uses them; URL queries (including empty '?') are not.
 * The real source TabRouter uses memory history and does not change this URL.
 * Use the host's native path rules: Windows is case-insensitive, POSIX is not.
 * fileURLToPath rejects encoded separators, malformed escapes and foreign hosts;
 * explicitly refuse UNC authorities on Windows as well (these are LOCAL artifacts).
 */
export function isAllowedCherryDocumentUrl(url: string, allowedDocumentPaths: readonly string[]): boolean {
  try {
    if (!url || /[\x00-\x20\x7f]/u.test(url)) return false
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:' || parsed.hostname !== '' || parsed.username || parsed.password || parsed.port) return false
    if (url.split('#', 1)[0].includes('?')) return false
    // Node rejects %2f everywhere and %5c on Windows. Refuse both consistently,
    // including POSIX, so the policy never admits an encoded path separator.
    if (/%(?:2f|5c)/i.test(parsed.pathname)) return false
    const documentPath = fileURLToPath(parsed)
    if (documentPath.includes('\0')) return false
    const normalize = (value: string): string => {
      const normalized = path.normalize(value)
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized
    }
    return allowedDocumentPaths.some(allowed => path.isAbsolute(allowed) && normalize(allowed) === normalize(documentPath))
  } catch {
    return false
  }
}

/**
 * Fail-closed admission for Cherry window/navigation IPC. Pass the FULL Electron
 * event, not just event.sender. Policy must be created in main from the registered
 * shell and the actual loadFile targets (compat dist/index.html and isolated
 * dist-source-shell/source-shell.html). No localhost/dev-server exception exists.
 *
 * Identity alone is insufficient: a CDP Page.navigate keeps the same WebContents.
 * Conversely, navigating that registered contents to either allowed artifact is
 * legitimate. Do not pin an initial URL or use a renderer route/tab as identity.
 */
export function isTrustedCherryMainFrame<TEvent extends CherryIpcEventLike>(
  event: TEvent | null | undefined,
  policy: CherryIpcAdmissionPolicy<TEvent['sender']>
): boolean {
  try {
    if (!event || !policy.isRegisteredSender(event.sender) ||
        event.sender.isDestroyed() || event.sender.isCrashed()) return false
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame || frame.detached ||
        frame.parent !== null || frame.top !== frame) return false
    const frameUrl = frame.url
    const documentUrl = event.sender.getURL()
    if (!isAllowedCherryDocumentUrl(frameUrl, policy.allowedDocumentPaths) ||
        !isAllowedCherryDocumentUrl(documentUrl, policy.allowedDocumentPaths)) return false
    // Both observations must name the SAME artifact. Ignore only hashes: a hash
    // transition may be in flight without replacing the document/main frame.
    const framePath = path.normalize(fileURLToPath(new URL(frameUrl)))
    const documentPath = path.normalize(fileURLToPath(new URL(documentUrl)))
    return process.platform === 'win32'
      ? framePath.toLowerCase() === documentPath.toLowerCase()
      : framePath === documentPath
  } catch {
    // Electron frame getters can throw after navigation/detach/destruction.
    return false
  }
}
