import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import type { CanvasDocument, CanvasProject } from '../../shared/canvas-types'
import { validateCanvasDocument } from '../../shared/canvas-validation'

const EMPTY_DOCUMENT: CanvasDocument = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [], connections: [] }

function rowToProject(row: unknown[]): CanvasProject {
  return { id: String(row[0]), name: String(row[1]), document: JSON.parse(String(row[2])) as CanvasDocument, created_at: String(row[3]), updated_at: String(row[4]) }
}

export function listCanvasProjects(): CanvasProject[] {
  const result = getDatabase().exec('SELECT id, name, data_json, created_at, updated_at FROM canvas_projects ORDER BY updated_at DESC')
  return (result[0]?.values || []).map(rowToProject)
}

export function getCanvasProject(id: string): CanvasProject | null {
  const result = getDatabase().exec('SELECT id, name, data_json, created_at, updated_at FROM canvas_projects WHERE id=?', [id])
  return result[0]?.values?.[0] ? rowToProject(result[0].values[0]) : null
}

export function createCanvasProject(name = '未命名画布'): CanvasProject {
  const id = 'canvas_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
  const now = new Date().toISOString()
  const document = EMPTY_DOCUMENT
  getDatabase().run('INSERT INTO canvas_projects (id, name, data_json, created_at, updated_at) VALUES (?,?,?,?,?)', [id, name.trim().slice(0, 200) || '未命名画布', JSON.stringify(document), now, now])
  saveDatabase()
  return getCanvasProject(id)!
}

export function saveCanvasProject(id: string, name: string, document: CanvasDocument): CanvasProject {
  const existing = getCanvasProject(id)
  if (!existing) throw new Error('画布项目不存在')
  const next = validateCanvasDocument(document)
  const now = new Date().toISOString()
  getDatabase().run('UPDATE canvas_projects SET name=?, data_json=?, updated_at=? WHERE id=?', [name.trim().slice(0, 200) || existing.name, JSON.stringify(next), now, id])
  saveDatabase()
  return getCanvasProject(id)!
}

export function deleteCanvasProject(id: string): boolean {
  const result = getDatabase().run('DELETE FROM canvas_projects WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes) > 0
}
