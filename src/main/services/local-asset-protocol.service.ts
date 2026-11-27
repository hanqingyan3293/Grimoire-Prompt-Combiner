import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { net, protocol } from 'electron'

export const LOCAL_ASSET_SCHEME = 'grimoire-asset'
export const LOCAL_ASSET_HOST = 'default-prompt-assets'

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif'])

/** Must run before app.whenReady: Electron ignores privileged scheme registration afterwards. */
export function registerLocalAssetSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: LOCAL_ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }])
}

/** Resolve a protocol URL to a file below the configured asset root, or null when it is unsafe. */
export function resolveLocalAssetPath(assetRoot: string, requestUrl: string): string | null {
  if (!assetRoot || !requestUrl) return null
  let url: URL
  try { url = new URL(requestUrl) } catch { return null }
  if (url.protocol !== LOCAL_ASSET_SCHEME + ':' || url.hostname !== LOCAL_ASSET_HOST) return null
  let decoded: string
  try { decoded = decodeURIComponent(url.pathname) } catch { return null }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null
  const relative = decoded.replace(/^\/+/, '')
  if (!relative || path.isAbsolute(relative)) return null
  const segments = relative.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(relative).toLowerCase())) return null
  const root = path.resolve(assetRoot)
  const resolved = path.resolve(root, ...segments)
  const relativeToRoot = path.relative(root, resolved)
  if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null
  return resolved
}

export function registerLocalAssetProtocol(assetRoot: string): void {
  protocol.handle(LOCAL_ASSET_SCHEME, async request => {
    const filePath = resolveLocalAssetPath(assetRoot, request.url)
    if (!filePath || !fs.existsSync(filePath)) return new Response('Not Found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
