import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_ASSET_SCHEME, resolveLocalAssetPath } from './local-asset-protocol.service'

const root = path.resolve('data/default-prompt-assets')

describe('local asset image protocol', () => {
  it('resolves a default prompt asset image inside the asset root', () => {
    expect(resolveLocalAssetPath(root, `${LOCAL_ASSET_SCHEME}://default-prompt-assets/moss-character/001.webp`)).toBe(path.join(root, 'moss-character', '001.webp'))
  })

  it('rejects encoded traversal, foreign roots, absolute paths and non-images', () => {
    const rejected = [
      `${LOCAL_ASSET_SCHEME}://default-prompt-assets/%2e%2e/%2e%2e/package.json`,
      `${LOCAL_ASSET_SCHEME}://default-prompt-assets/..%5c..%5cpackage.json`,
      `${LOCAL_ASSET_SCHEME}://another-root/moss-character/001.webp`,
      'file:///C:/Windows/win.ini',
      `${LOCAL_ASSET_SCHEME}://default-prompt-assets/moss-character/001.json`,
      `${LOCAL_ASSET_SCHEME}://default-prompt-assets/C:%5cWindows%5cwin.ini`,
      'not a url',
    ]
    for (const url of rejected) expect(resolveLocalAssetPath(root, url)).toBeNull()
  })

  it('is allowed by the renderer image CSP', () => {
    const html = fs.readFileSync(path.resolve('index.html'), 'utf8')
    expect(html).toContain("img-src 'self' data: file: grimoire-asset:")
  })
})
