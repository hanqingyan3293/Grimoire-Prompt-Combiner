import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import {
  isAllowedCherryDocumentUrl, isTrustedCherryMainFrame,
  type CherryIpcAdmissionPolicy, type CherryIpcEventLike, type CherryIpcFrameLike
} from './cherry-ipc-admission'

// Real URL/path parsing and explicit structural Electron doubles: no module mocks.
const root = path.resolve('admission-fixture', '魔导书 # space')
const compat = path.join(root, 'src/vendor/cherry/compat/dist/index.html')
const sourceShell = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
const allowedDocumentPaths = [compat, sourceShell]
const compatUrl = pathToFileURL(compat).href
const sourceUrl = pathToFileURL(sourceShell).href

function fixture(url = compatUrl) {
  const frame: CherryIpcFrameLike = { url, detached: false, parent: null, top: null }
  Object.assign(frame, { top: frame })
  let documentUrl = url
  let destroyed = false
  let crashed = false
  const sender: CherryIpcEventLike['sender'] = {
    mainFrame: frame,
    getURL: () => documentUrl,
    isDestroyed: () => destroyed,
    isCrashed: () => crashed
  }
  const event: CherryIpcEventLike = { sender, senderFrame: frame }
  const policy: CherryIpcAdmissionPolicy = {
    allowedDocumentPaths,
    isRegisteredSender: candidate => candidate === sender
  }
  return {
    frame, sender, event, policy,
    navigate(next: string) { Object.assign(frame, { url: next }); documentUrl = next },
    setDocumentUrl(next: string) { documentUrl = next },
    destroy() { destroyed = true },
    crash() { crashed = true }
  }
}

// Compile-only contract: the coordinator can pass an actual Electron IPC event.
const acceptsElectronEvent: (event: IpcMainInvokeEvent, policy: CherryIpcAdmissionPolicy) => boolean = isTrustedCherryMainFrame
void acceptsElectronEvent
const acceptsRegisteredWebContents = (event: IpcMainInvokeEvent, isRegisteredSender: (sender: WebContents) => boolean) =>
  isTrustedCherryMainFrame(event, { isRegisteredSender, allowedDocumentPaths })
void acceptsRegisteredWebContents

describe('exact Cherry document URL admission', () => {
  it.each([compatUrl, sourceUrl, compatUrl + '#/settings/provider', sourceUrl + '#anchor?not-a-document-query'])('admits exact artifact %s', url => {
    expect(isAllowedCherryDocumentUrl(url, allowedDocumentPaths)).toBe(true)
  })

  it('handles percent-encoded Unicode, spaces and # through fileURLToPath', () => {
    expect(compatUrl).toContain('%20')
    expect(compatUrl).toContain('%23')
    expect(isAllowedCherryDocumentUrl(compatUrl, allowedDocumentPaths)).toBe(true)
  })

  it.each([
    '', 'not a URL', 'https://example.org/index.html', 'http://localhost:5173/',
    'data:text/html,<h1>shell</h1>', 'about:blank', 'javascript:void(0)',
    'file://remote-host/share/index.html', compatUrl + '?mode=shell', compatUrl + '?',
    compatUrl + '?mode=shell#/settings', compatUrl + '.evil',
    compatUrl.replace('index.html', 'other.html'),
    compatUrl.replace('/dist/', '/dist-copy/'),
    compatUrl.replace('index.html', '%2findex.html'),
    compatUrl.replace('index.html', '%5Cindex.html'),
    compatUrl.replace('index.html', '%00index.html'),
    compatUrl.replace('index.html', '%ZZindex.html'),
    compatUrl.replace('index.html', '%252findex.html'),
    compatUrl.replace('index.html', '%252e%252e/index.html'),
    ' ' + compatUrl, compatUrl + '\n'
  ])('rejects untrusted URL %s', url => {
    expect(isAllowedCherryDocumentUrl(url, allowedDocumentPaths)).toBe(false)
  })

  it('rejects arbitrary local files, primary Grimoire HTML and prefix siblings', () => {
    for (const other of [path.join(root, 'dist/index.html'), path.join(root, 'dist/cherry-compat/index.html.evil'), path.join(root, 'src/preload/index.js')]) {
      expect(isAllowedCherryDocumentUrl(pathToFileURL(other).href, allowedDocumentPaths)).toBe(false)
    }
  })

  it('uses normalized exact absolute paths, never cwd-relative renderer paths', () => {
    expect(isAllowedCherryDocumentUrl(compatUrl, [path.join(path.dirname(compat), '..', 'dist', 'index.html')])).toBe(true)
    expect(isAllowedCherryDocumentUrl(compatUrl, ['index.html'])).toBe(false)
    expect(isAllowedCherryDocumentUrl(compatUrl, [])).toBe(false)
  })

  it('supports main-derived packaged artifact paths without a directory allowlist', () => {
    // Current getCherryCompatPath resolves compiled main/index.js ../../cherry-compat.
    // The isolated source-shell loader still targets its own dist-source-shell HTML.
    const compiledMainDir = path.join(root, 'dist/main/main')
    const packaged = [path.join(compiledMainDir, '../../cherry-compat/index.html'), sourceShell]
    for (const file of packaged) expect(isAllowedCherryDocumentUrl(pathToFileURL(file).href, packaged)).toBe(true)
    expect(isAllowedCherryDocumentUrl(pathToFileURL(path.join(root, 'dist/cherry-compat/other.html')).href, packaged)).toBe(false)
  })

  it('follows native Windows case equality, preserving POSIX case sensitivity', () => {
    const casedUrl = compatUrl.replace('index.html', 'INDEX.HTML')
    expect(isAllowedCherryDocumentUrl(casedUrl, allowedDocumentPaths)).toBe(process.platform === 'win32')
  })
})

describe('Cherry main-frame sender admission', () => {
  it('accepts only a live registered main frame with the allowed current document', () => {
    const f = fixture()
    expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(true)
    expect(isTrustedCherryMainFrame(f.event, { ...f.policy, isRegisteredSender: () => false })).toBe(false)
  })

  it('does not trust another window even with the same preload/document URL', () => {
    const f = fixture()
    const other = fixture()
    expect(isTrustedCherryMainFrame(other.event, f.policy)).toBe(false)
  })

  it('rejects subframes including same-document local frames', () => {
    const f = fixture()
    const child: CherryIpcFrameLike = { url: compatUrl, detached: false, parent: f.frame, top: f.frame }
    expect(isTrustedCherryMainFrame({ sender: f.sender, senderFrame: child }, f.policy)).toBe(false)
  })

  it('requires actual frame object equality, not matching URL or frame ids', () => {
    const f = fixture()
    const stale: CherryIpcFrameLike = { ...f.frame }
    Object.assign(stale, { top: stale })
    expect(isTrustedCherryMainFrame({ sender: f.sender, senderFrame: stale }, f.policy)).toBe(false)
  })

  it('fails closed for missing, detached, non-top and parented frames', () => {
    const f = fixture()
    expect(isTrustedCherryMainFrame(null, f.policy)).toBe(false)
    expect(isTrustedCherryMainFrame(undefined, f.policy)).toBe(false)
    expect(isTrustedCherryMainFrame({ sender: f.sender, senderFrame: null }, f.policy)).toBe(false)
    for (const patch of [{ detached: true }, { top: null }, { parent: f.frame }]) {
      const next = fixture()
      Object.assign(next.frame, patch)
      expect(isTrustedCherryMainFrame(next.event, next.policy)).toBe(false)
    }
  })

  it('rejects destroyed and crashed senders', () => {
    const dead = fixture()
    dead.destroy()
    expect(isTrustedCherryMainFrame(dead.event, dead.policy)).toBe(false)
    const crashed = fixture()
    crashed.crash()
    expect(isTrustedCherryMainFrame(crashed.event, crashed.policy)).toBe(false)
  })

  it('rejects stale or inconsistent document observations, even two allowed artifacts', () => {
    const f = fixture()
    for (const url of ['https://example.org', 'data:text/html,remote', sourceUrl]) {
      f.setDocumentUrl(url)
      expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(false)
    }
    f.setDocumentUrl(compatUrl)
    Object.assign(f.frame, { url: 'https://example.org' })
    expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(false)
  })

  it('allows same-WebContents Page.navigate to either real artifact, never remote/data', () => {
    const f = fixture()
    for (const url of [sourceUrl, compatUrl + '#/settings', sourceUrl]) {
      f.navigate(url)
      expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(true)
    }
    for (const url of ['https://example.org', 'data:text/html,shell', 'about:blank', sourceUrl + '?injected=true']) {
      f.navigate(url)
      expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(false)
    }
  })

  it('does not confuse native memory tab paths with document URLs; permits hash-only transitions', () => {
    const f = fixture(sourceUrl)
    // Source tabs route to /app/chat in memory; the main document remains this HTML.
    expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(true)
    f.setDocumentUrl(sourceUrl + '#anchor')
    expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(true)
    f.navigate('file:///app/chat')
    expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(false)
  })

  it('fails closed when Electron getters or registration throw after navigation', () => {
    const f = fixture()
    Object.defineProperty(f.sender, 'mainFrame', { get() { throw new Error('destroyed') } })
    expect(isTrustedCherryMainFrame(f.event, f.policy)).toBe(false)
    const next = fixture()
    Object.defineProperty(next.frame, 'url', { get() { throw new Error('detached') } })
    expect(isTrustedCherryMainFrame(next.event, next.policy)).toBe(false)
    const last = fixture()
    last.sender.getURL = () => { throw new Error('destroyed') }
    expect(isTrustedCherryMainFrame(last.event, last.policy)).toBe(false)
    expect(isTrustedCherryMainFrame(fixture().event, { allowedDocumentPaths, isRegisteredSender: () => { throw new Error('closed') } })).toBe(false)
  })
})
