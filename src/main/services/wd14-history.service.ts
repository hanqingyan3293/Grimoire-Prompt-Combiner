import crypto from "crypto"
import fs from 'fs'
import path from 'path'
import type { WD14HistoryRecord, WD14TagBuckets } from "../../shared/wd14-types"
import { getDatabase, getResourceRoot, saveDatabase } from "../database"

type HistoryStatus = WD14HistoryRecord["status"]

function normalizeTags(value: unknown): WD14TagBuckets {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const bucket = (key: keyof WD14TagBuckets) => Array.isArray(source[key])
    ? source[key].filter((item): item is { name: string; confidence: number } => Boolean(item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"))
      .map(item => ({ name: item.name, confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0 }))
    : []
  return { general: bucket("general"), character: bucket("character"), rating: bucket("rating"), quality: bucket("quality") }
}

function rowToHistory(row: unknown[]): WD14HistoryRecord {
  let tags: WD14TagBuckets = { general: [], character: [], rating: [], quality: [] }
  try { tags = normalizeTags(JSON.parse(String(row[4] || "{}"))) } catch {}
  return {
    id: String(row[0]),
    task_id: String(row[1]),
    image_id: Number(row[2]),
    image_name: String(row[3] || ""),
    tags,
    model_id: String(row[5] || ""),
    threshold: Number(row[6] || 0.35),
    status: row[7] === "failed" ? "failed" : "succeeded",
    error_message: row[8] == null ? null : String(row[8]),
    image_snapshot_available: typeof row[9] === 'string' && Boolean(row[9]) && fs.existsSync(String(row[9])),
    created_at: String(row[11] || row[9]),
  }
}

export function saveWD14History(input: { taskId: string; imageId: number; tags?: unknown; modelId?: string; threshold?: number; status?: HistoryStatus; errorMessage?: string | null }): WD14HistoryRecord {
  const db = getDatabase()
  const image = db.exec("SELECT file_path, original_name, mime_type FROM image_refs WHERE id=?", [input.imageId])[0]?.values?.[0]
  const now = new Date().toISOString()
  const id = "wd14_hist_" + crypto.createHash("sha256").update(input.taskId).digest("hex").slice(0, 24)
  const tags = normalizeTags(input.tags)
  const imageName = String(image?.[1] || "图片 " + input.imageId)
  const imageMime = typeof image?.[2] === 'string' && image[2] ? String(image[2]) : 'image/png'
  const snapshotRoot = path.join(getResourceRoot(), 'wd14-history')
  const extension = imageMime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png'
  const snapshotPath = path.join(snapshotRoot, id + '.' + extension)
  if (typeof image?.[0] === 'string' && fs.existsSync(String(image[0]))) {
    try {
      fs.mkdirSync(snapshotRoot, { recursive: true })
      fs.copyFileSync(String(image[0]), snapshotPath)
    } catch { /* The history row remains usable even when snapshot copying fails. */ }
  }
  db.run(
    "INSERT OR REPLACE INTO wd14_history (id, task_id, image_id, image_name, tags_json, model_id, threshold, status, error_message, image_snapshot_path, image_snapshot_mime, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, input.taskId, input.imageId, imageName, JSON.stringify(tags), input.modelId || "", Number(input.threshold || 0.35), input.status || "succeeded", input.errorMessage || null, fs.existsSync(snapshotPath) ? snapshotPath : null, imageMime, now],
  )
  saveDatabase()
  return getWD14History(id)!
}

export function listWD14History(options: { query?: string; status?: HistoryStatus; limit?: number; offset?: number } = {}): WD14HistoryRecord[] {
  const db = getDatabase()
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit || 100)))
  const offset = Math.max(0, Math.floor(options.offset || 0))
  const query = String(options.query || "").trim().toLowerCase()
  const clauses: string[] = []
  const params: unknown[] = []
  if (options.status) { clauses.push("status=?"); params.push(options.status) }
  if (query) { clauses.push("(lower(image_name) LIKE ? OR lower(tags_json) LIKE ? OR lower(model_id) LIKE ? OR lower(created_at) LIKE ?)"); const pattern = "%" + query + "%"; params.push(pattern, pattern, pattern, pattern) }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : ""
  const result = db.exec("SELECT id, task_id, image_id, image_name, tags_json, model_id, threshold, status, error_message, image_snapshot_path, image_snapshot_mime, created_at FROM wd14_history" + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?", [...params, limit, offset])
  return (result[0]?.values || []).map(rowToHistory)
}

export function getWD14History(id: string): WD14HistoryRecord | null {
  const db = getDatabase()
  const result = db.exec("SELECT id, task_id, image_id, image_name, tags_json, model_id, threshold, status, error_message, image_snapshot_path, image_snapshot_mime, created_at FROM wd14_history WHERE id=?", [id])
  return result[0]?.values?.[0] ? rowToHistory(result[0].values[0]) : null
}

export function deleteWD14History(id: string): boolean {
  const row = getDatabase().exec("SELECT image_snapshot_path FROM wd14_history WHERE id=?", [id])[0]?.values?.[0]
  const result = getDatabase().run("DELETE FROM wd14_history WHERE id=?", [id])
  if (typeof row?.[0] === 'string') { try { fs.rmSync(String(row[0]), { force: true }) } catch {} }
  saveDatabase()
  return Number(result.changes || 0) > 0
}

export function clearWD14History(): boolean {
  const rows = getDatabase().exec("SELECT image_snapshot_path FROM wd14_history WHERE image_snapshot_path IS NOT NULL")[0]?.values || []
  getDatabase().run("DELETE FROM wd14_history")
  for (const row of rows) if (typeof row[0] === 'string') { try { fs.rmSync(String(row[0]), { force: true }) } catch {} }
  saveDatabase()
  return true
}

export async function readWD14HistoryImageData(id: string): Promise<string | null> {
  const row = getDatabase().exec("SELECT image_snapshot_path, image_snapshot_mime, image_id FROM wd14_history WHERE id=?", [id])[0]?.values?.[0]
  if (!row) return null
  let filePath = typeof row[0] === 'string' && row[0] ? String(row[0]) : ''
  let mime = typeof row[1] === 'string' && row[1] ? String(row[1]) : 'image/png'
  if (!filePath || !fs.existsSync(filePath)) {
    const image = getDatabase().exec('SELECT file_path,mime_type FROM image_refs WHERE id=?', [Number(row[2])])[0]?.values?.[0]
    filePath = typeof image?.[0] === 'string' ? String(image[0]) : ''
    mime = typeof image?.[1] === 'string' && image[1] ? String(image[1]) : mime
  }
  if (!filePath || !fs.existsSync(filePath)) return null
  return `data:${mime};base64,${(await fs.promises.readFile(filePath)).toString('base64')}`
}
