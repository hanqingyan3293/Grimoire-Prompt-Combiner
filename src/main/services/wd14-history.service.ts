import crypto from "crypto"
import type { WD14HistoryRecord, WD14TagBuckets } from "../../shared/wd14-types"
import { getDatabase, saveDatabase } from "../database"

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
    created_at: String(row[9]),
  }
}

export function saveWD14History(input: { taskId: string; imageId: number; tags?: unknown; modelId?: string; threshold?: number; status?: HistoryStatus; errorMessage?: string | null }): WD14HistoryRecord {
  const db = getDatabase()
  const image = db.exec("SELECT original_name FROM image_refs WHERE id=?", [input.imageId])[0]?.values?.[0]
  const now = new Date().toISOString()
  const id = "wd14_hist_" + crypto.createHash("sha256").update(input.taskId).digest("hex").slice(0, 24)
  const tags = normalizeTags(input.tags)
  db.run(
    "INSERT OR REPLACE INTO wd14_history (id, task_id, image_id, image_name, tags_json, model_id, threshold, status, error_message, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, input.taskId, input.imageId, String(image?.[0] || "图片 " + input.imageId), JSON.stringify(tags), input.modelId || "", Number(input.threshold || 0.35), input.status || "succeeded", input.errorMessage || null, now],
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
  if (query) { clauses.push("(lower(image_name) LIKE ? OR lower(tags_json) LIKE ? OR lower(model_id) LIKE ?)"); const pattern = "%" + query + "%"; params.push(pattern, pattern, pattern) }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : ""
  const result = db.exec("SELECT id, task_id, image_id, image_name, tags_json, model_id, threshold, status, error_message, created_at FROM wd14_history" + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?", [...params, limit, offset])
  return (result[0]?.values || []).map(rowToHistory)
}

export function getWD14History(id: string): WD14HistoryRecord | null {
  const db = getDatabase()
  const result = db.exec("SELECT id, task_id, image_id, image_name, tags_json, model_id, threshold, status, error_message, created_at FROM wd14_history WHERE id=?", [id])
  return result[0]?.values?.[0] ? rowToHistory(result[0].values[0]) : null
}

export function deleteWD14History(id: string): boolean {
  const result = getDatabase().run("DELETE FROM wd14_history WHERE id=?", [id])
  saveDatabase()
  return Number(result.changes || 0) > 0
}

export function clearWD14History(): boolean {
  getDatabase().run("DELETE FROM wd14_history")
  saveDatabase()
  return true
}
