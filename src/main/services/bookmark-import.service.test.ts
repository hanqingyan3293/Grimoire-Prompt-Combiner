import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''
vi.mock('electron', () => ({ app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) } }))

import { closeDatabase, initDatabase } from '../database'
import { clearBookmarks, importBookmarks, listBookmarks, parseBookmarkFile } from './bookmark-import.service'

const EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>开发</H3>
    <DL><p>
        <DT><A HREF="https://example.com/docs">文档</A>
        <DT><A HREF="https://example.com/api?a=1&amp;b=2">API &amp; 参考</A>
        <DT><A HREF="javascript:alert(1)">坏书签</A>
        <DT><A HREF="chrome://settings">内部页</A>
    </DL><p>
    <DT><H3>日常</H3>
    <DL><p>
        <DT><A HREF="http://news.example.com/">新闻</A>
    </DL><p>
</DL><p>`

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-bookmarks-'))
  await initDatabase()
})
afterEach(() => { closeDatabase(); fs.rmSync(testRoot, { recursive: true, force: true }) })

describe('bookmark import (M3)', () => {
  it('parses folders and links, decoding entities and skipping non-web schemes', () => {
    const parsed = parseBookmarkFile(EXPORT)
    expect(parsed.bookmarks).toHaveLength(3)
    expect(parsed.bookmarks[0]).toEqual({ title: '文档', url: 'https://example.com/docs', folder: '开发' })
    expect(parsed.bookmarks[1].title).toBe('API & 参考')
    expect(parsed.bookmarks[1].url).toBe('https://example.com/api?a=1&b=2')
    expect(parsed.bookmarks[2].folder).toBe('日常')
    expect(parsed.skipped).toBe(2)
  })

  it('imports once and is idempotent on re-import', () => {
    const first = importBookmarks(EXPORT)
    expect(first.imported).toBe(3)
    expect(first.folders.sort()).toEqual(['开发', '日常'].sort())
    const second = importBookmarks(EXPORT)
    expect(second.imported).toBe(0)
    expect(listBookmarks()).toHaveLength(3)
  })

  it('returns an empty result for a file with no bookmarks and clears cleanly', () => {
    expect(parseBookmarkFile('<html><body>nothing</body></html>').bookmarks).toHaveLength(0)
    importBookmarks(EXPORT)
    expect(clearBookmarks()).toBe(3)
    expect(listBookmarks()).toHaveLength(0)
  })
})
