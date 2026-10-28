import { getDatabase, saveDatabase } from '../database'

// Embedded browser history (M3).
//
// The source history dialog lists visits, searches them and clears them. All three are plain table
// operations — no Electron session involved — so they can be implemented and tested without a browser
// host, which is the part still missing.
export interface BrowserVisit { readonly id: number; readonly url: string; readonly title: string; readonly visitedAt: string }

const MAX_TITLE = 300
const MAX_URL = 4000

export class BrowserHistoryError extends Error {
  constructor(readonly code: 'BAD_INPUT', message: string) {
    super(message)
    this.name = 'BrowserHistoryError'
  }
}

function cleanUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url || url.length > MAX_URL) throw new BrowserHistoryError('BAD_INPUT', 'url is required and must be under ' + MAX_URL + ' characters')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new BrowserHistoryError('BAD_INPUT', 'not a url: ' + url) }
  // Only web pages are history: file:// and javascript: would let a visited page smuggle local paths in.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new BrowserHistoryError('BAD_INPUT', 'unsupported protocol: ' + parsed.protocol)
  return parsed.toString()
}

export function recordBrowserVisit(input: { url: string; title?: string; visitedAt?: string }): BrowserVisit {
  const url = cleanUrl(input.url)
  const title = (input.title || '').slice(0, MAX_TITLE)
  const visitedAt = input.visitedAt || new Date().toISOString()
  const db = getDatabase()
  // Re-visiting the same URL updates the row instead of piling duplicates: the dialog shows sites,
  // not every single navigation.
  db.run('DELETE FROM browser_history WHERE url=?', [url])
  db.run('INSERT INTO browser_history (url, title, visited_at) VALUES (?,?,?)', [url, title, visitedAt])
  saveDatabase()
  const row = db.exec('SELECT id, url, title, visited_at FROM browser_history WHERE url=?', [url])[0]?.values?.[0]
  return { id: Number(row?.[0] ?? 0), url, title, visitedAt }
}

export function listBrowserHistory(input?: { query?: string; limit?: number }): BrowserVisit[] {
  const query = (input?.query || '').trim()
  const limit = Math.min(Math.max(Number(input?.limit) || 200, 1), 1000)
  const rows = query
    ? getDatabase().exec('SELECT id, url, title, visited_at FROM browser_history WHERE url LIKE ? OR title LIKE ? ORDER BY visited_at DESC LIMIT ?', ['%' + query + '%', '%' + query + '%', limit])[0]?.values ?? []
    : getDatabase().exec('SELECT id, url, title, visited_at FROM browser_history ORDER BY visited_at DESC LIMIT ?', [limit])[0]?.values ?? []
  return rows.map(row => ({ id: Number(row[0]), url: String(row[1]), title: String(row[2]), visitedAt: String(row[3]) }))
}

export function deleteBrowserVisit(id: number): boolean {
  const db = getDatabase()
  const before = Number(db.exec('SELECT count(*) FROM browser_history WHERE id=?', [id])[0]?.values?.[0]?.[0] ?? 0)
  if (!before) return false
  db.run('DELETE FROM browser_history WHERE id=?', [id])
  saveDatabase()
  return true
}

export function clearBrowserHistory(): number {
  const db = getDatabase()
  const count = Number(db.exec('SELECT count(*) FROM browser_history')[0]?.values?.[0]?.[0] ?? 0)
  db.run('DELETE FROM browser_history')
  saveDatabase()
  return count
}
