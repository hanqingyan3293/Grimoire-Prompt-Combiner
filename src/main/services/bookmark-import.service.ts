import { getDatabase, saveDatabase } from '../database'

// Bookmark import (M3).
//
// Chrome, Edge and Firefox all export the Netscape bookmark format, so one parser covers the three
// sources the settings dialog offers. The parser is deliberately strict about what a bookmark is: a
// link with an http(s) URL. Anything else (`javascript:`, `place:`, `chrome://`) is skipped, because
// importing them into a browser host would create entries that can never be opened safely.
export interface ParsedBookmark { readonly title: string; readonly url: string; readonly folder: string }

export interface ImportResult { readonly imported: number; readonly skipped: number; readonly folders: string[] }

const LINK = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
const FOLDER = /<h3[^>]*>([\s\S]*?)<\/h3>/gi
const MAX_BOOKMARKS = 20000

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseBookmarkFile(html: string): { bookmarks: ParsedBookmark[]; skipped: number } {
  if (typeof html !== 'string' || !html) return { bookmarks: [], skipped: 0 }
  const folders: string[] = []
  const bookmarks: ParsedBookmark[] = []
  let skipped = 0
  // Folder state comes from the most recent <H3>; the format is flat enough that the nearest preceding
  // heading is the folder a link belongs to.
  const events: Array<{ index: number; kind: 'link' | 'folder'; url?: string; text: string }> = []
  for (const match of html.matchAll(LINK)) events.push({ index: match.index ?? 0, kind: 'link', url: match[1], text: decode(match[2]) })
  for (const match of html.matchAll(FOLDER)) events.push({ index: match.index ?? 0, kind: 'folder', text: decode(match[1]) })
  events.sort((left, right) => left.index - right.index)
  for (const event of events) {
    if (event.kind === 'folder') {
      if (event.text) folders.push(event.text)
      continue
    }
    if (bookmarks.length >= MAX_BOOKMARKS) { skipped += 1; continue }
    // href values are HTML-escaped too (`&amp;` in query strings), so decode before validating.
    const url = decode(String(event.url ?? ''))
    if (!/^https?:\/\//i.test(url)) { skipped += 1; continue }
    bookmarks.push({ title: event.text || url, url, folder: folders[folders.length - 1] ?? '' })
  }
  return { bookmarks, skipped }
}

export function importBookmarks(html: string): ImportResult {
  const parsed = parseBookmarkFile(html)
  const db = getDatabase()
  let imported = 0
  for (const bookmark of parsed.bookmarks) {
    // One row per URL: re-importing the same export must not duplicate entries.
    const existing = db.exec('SELECT 1 FROM browser_bookmark WHERE url=?', [bookmark.url])[0]?.values?.length ?? 0
    if (existing) continue
    db.run('INSERT INTO browser_bookmark (url, title, folder, created_at) VALUES (?,?,?,?)', [bookmark.url, bookmark.title, bookmark.folder, new Date().toISOString()])
    imported += 1
  }
  if (imported) saveDatabase()
  const folders = [...new Set(parsed.bookmarks.map(bookmark => bookmark.folder).filter(Boolean))]
  return { imported, skipped: parsed.skipped, folders }
}

export function listBookmarks(): Array<{ url: string; title: string; folder: string }> {
  const rows = getDatabase().exec('SELECT url, title, folder FROM browser_bookmark ORDER BY created_at DESC, url ASC')[0]?.values ?? []
  return rows.map(row => ({ url: String(row[0]), title: String(row[1]), folder: String(row[2]) }))
}

export function clearBookmarks(): number {
  const db = getDatabase()
  const count = Number(db.exec('SELECT count(*) FROM browser_bookmark')[0]?.values?.[0]?.[0] ?? 0)
  db.run('DELETE FROM browser_bookmark')
  saveDatabase()
  return count
}
