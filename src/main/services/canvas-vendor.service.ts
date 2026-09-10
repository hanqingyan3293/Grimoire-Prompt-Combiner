import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
const MAX_NODES = 5000
const MAX_CONNECTIONS = 10000

export interface CanvasVendorProjectRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  nodes: unknown[]
  connections: unknown[]
  chatSessions: unknown[]
  activeChatId: string | null
  backgroundMode: string
  showImageInfo: boolean
  viewport: { x: number; y: number; k: number }
  revision: number
}

function normalizeProject(value: unknown, fallbackId?: string): CanvasVendorProjectRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无限画布项目格式无效')
  const input = value as Record<string, unknown>
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const connections = Array.isArray(input.connections) ? input.connections : []
  if (nodes.length > MAX_NODES || connections.length > MAX_CONNECTIONS) throw new Error('无限画布对象数量超过限制')
  const viewportValue = input.viewport && typeof input.viewport === 'object' ? input.viewport as Record<string, unknown> : {}
  const serialized = JSON.stringify(value)
  if (serialized.length > MAX_DOCUMENT_BYTES) throw new Error('无限画布项目过大')
  const now = new Date().toISOString()
  return {
    id: typeof input.id === 'string' && input.id ? input.id : fallbackId || `canvas_vendor_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 200) : '未命名画布',
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : now,
    updatedAt: now,
    nodes, connections,
    chatSessions: Array.isArray(input.chatSessions) ? input.chatSessions.slice(0, 100) : [],
    activeChatId: typeof input.activeChatId === 'string' ? input.activeChatId : null,
    backgroundMode: input.backgroundMode === 'dots' || input.backgroundMode === 'blank' ? input.backgroundMode : 'lines',
    showImageInfo: input.showImageInfo === true,
    viewport: {
      x: Number.isFinite(Number(viewportValue.x)) ? Number(viewportValue.x) : 0,
      y: Number.isFinite(Number(viewportValue.y)) ? Number(viewportValue.y) : 0,
      k: Math.max(0.05, Math.min(5, Number.isFinite(Number(viewportValue.k)) ? Number(viewportValue.k) : 1)),
    },
    revision: Number.isFinite(Number(input.revision)) ? Math.max(0, Math.floor(Number(input.revision))) : 0,
  }
}

function rowToProject(row: unknown[]): CanvasVendorProjectRecord {
  const parsed = JSON.parse(String(row[2]))
  return normalizeProject({ ...parsed, id: String(row[0]), title: String(row[1]), createdAt: String(row[3]), updatedAt: String(row[4]), revision: Number(row[5]) || 0 }, String(row[0]))
}

export function listCanvasVendorProjects(): Array<Pick<CanvasVendorProjectRecord, 'id' | 'title' | 'createdAt' | 'updatedAt'>> {
  const result = getDatabase().exec('SELECT id, title, data_json, created_at, updated_at, revision FROM canvas_vendor_projects ORDER BY updated_at DESC')
  return (result[0]?.values || []).map(row => {
    const project = rowToProject(row)
    return { id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt }
  })
}

export function getCanvasVendorProject(id: string): CanvasVendorProjectRecord | null {
  const result = getDatabase().exec('SELECT id, title, data_json, created_at, updated_at, revision FROM canvas_vendor_projects WHERE id=?', [id])
  return result[0]?.values?.[0] ? rowToProject(result[0].values[0]) : null
}

export function createCanvasVendorProject(title = '未命名画布', requestedId?: string): CanvasVendorProjectRecord {
  const project = normalizeProject({ title, id: requestedId })
  getDatabase().run('INSERT INTO canvas_vendor_projects (id, title, data_json, created_at, updated_at, revision) VALUES (?,?,?,?,?,?)', [project.id, project.title, JSON.stringify(project), project.createdAt, project.updatedAt, 0])
  saveDatabase()
  return project
}

export function saveCanvasVendorProject(id: string, value: unknown): CanvasVendorProjectRecord {
  const existing = getCanvasVendorProject(id)
  if (!existing) throw new Error('无限画布项目不存在')
  const project = normalizeProject(value, id)
  project.id = id
  project.createdAt = existing.createdAt
  const incomingRevision = Number.isFinite(Number((value as Record<string, unknown>)?.revision)) ? Math.max(0, Math.floor(Number((value as Record<string, unknown>).revision))) : existing.revision
  const expectedRevision = Math.max(0, incomingRevision - 1)
  const nextRevision = Math.max(existing.revision + 1, expectedRevision + 1)
  project.revision = nextRevision
  const result = getDatabase().run('UPDATE canvas_vendor_projects SET title=?, data_json=?, updated_at=?, revision=? WHERE id=? AND revision=?', [project.title, JSON.stringify(project), project.updatedAt, nextRevision, id, expectedRevision])
  if (Number(result.changes) === 0) throw new Error('无限画布项目版本已过期，请重新加载后重试')
  saveDatabase()
  return project
}

export function deleteCanvasVendorProject(id: string): boolean {
  const result = getDatabase().run('DELETE FROM canvas_vendor_projects WHERE id=?', [id])
  saveDatabase()
  return Number(result.changes) > 0
}
