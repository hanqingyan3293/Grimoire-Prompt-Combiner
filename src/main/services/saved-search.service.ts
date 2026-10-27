// 魔导书 Grimoire v7 — 保存搜索服务（schema v23）
// Persists gallery query snapshots (query_json / sort_json) with an optional
// pinned flag. Payloads are opaque JSON strings produced by the renderer store;
// the service only validates shape and size, never interprets the query.
import crypto from 'crypto'
import { saveDatabase } from '../database'
import type { LegacyDatabase } from './sqlite.compat'

export interface SavedSearchRecord {
  id: string
  name: string
  queryJson: string
  sortJson: string
  viewMode: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

const MAX_JSON_LENGTH = 100_000

function rowToSavedSearch(row: unknown[]): SavedSearchRecord {
  return {
    id: String(row[0]),
    name: String(row[1] || ''),
    queryJson: String(row[2] || '{}'),
    sortJson: String(row[3] || '{}'),
    viewMode: String(row[4] || 'grid'),
    pinned: Number(row[5]) === 1,
    createdAt: String(row[6] || ''),
    updatedAt: String(row[7] || ''),
  }
}

function requireName(value: unknown): string {
  const name = String(value || '').trim()
  if (!name || name.length > 200) throw new Error('保存搜索名称无效')
  return name
}

function normalizeJson(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback
  const text = String(value)
  if (text.length > MAX_JSON_LENGTH) throw new Error('保存搜索内容过大')
  try {
    JSON.parse(text)
    return text
  } catch {
    throw new Error('保存搜索内容不是有效 JSON')
  }
}

export function listSavedSearches(db: LegacyDatabase): SavedSearchRecord[] {
  const rows = db.exec('SELECT id,name,query_json,sort_json,view_mode,pinned,created_at,updated_at FROM tag_saved_searches ORDER BY pinned DESC, updated_at DESC')[0]?.values || []
  return rows.map(rowToSavedSearch)
}

export function saveSavedSearch(
  db: LegacyDatabase,
  input: { id?: string; name: unknown; queryJson?: unknown; sortJson?: unknown; viewMode?: unknown; pinned?: unknown },
): SavedSearchRecord {
  const name = requireName(input.name)
  const now = new Date().toISOString()
  const id = String(input.id || '').trim()
  const current = id ? db.exec('SELECT query_json,sort_json,view_mode,pinned,created_at FROM tag_saved_searches WHERE id=?', [id])[0]?.values?.[0] : undefined
  const queryJson = normalizeJson(input.queryJson, String(current?.[0] || '{}'))
  const sortJson = normalizeJson(input.sortJson, String(current?.[1] || '{}'))
  const viewMode = String(input.viewMode || current?.[2] || 'grid').slice(0, 40) || 'grid'
  const pinned = input.pinned === undefined ? Number(current?.[3] || 0) === 1 : Boolean(input.pinned)
  const createdAt = String(current?.[4] || now)

  if (current) {
    db.run('UPDATE tag_saved_searches SET name=?,query_json=?,sort_json=?,view_mode=?,pinned=?,updated_at=? WHERE id=?', [name, queryJson, sortJson, viewMode, pinned ? 1 : 0, now, id])
  } else {
    const newId = 'search_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    db.run('INSERT INTO tag_saved_searches (id,name,query_json,sort_json,view_mode,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [newId, name, queryJson, sortJson, viewMode, pinned ? 1 : 0, now, now])
    saveDatabase()
    return { id: newId, name, queryJson, sortJson, viewMode, pinned, createdAt: now, updatedAt: now }
  }
  saveDatabase()
  return { id, name, queryJson, sortJson, viewMode, pinned, createdAt, updatedAt: now }
}

export function deleteSavedSearch(db: LegacyDatabase, idValue: unknown): boolean {
  const id = String(idValue || '').trim()
  if (!id) return false
  const result = db.run('DELETE FROM tag_saved_searches WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes || 0) > 0
}