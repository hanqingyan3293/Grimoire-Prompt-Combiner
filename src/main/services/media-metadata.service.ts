// 魔导书 Grimoire — 图片生成元数据解析服务
// 读取 media_assets → image_refs 文件，按 MIME 解析嵌入元数据并落库（COALESCE 不覆盖语义）。

import fs from 'fs'
import { probeImageDimensions } from './asset.core'
import { parseEmbeddedMetadata, type ParsedGenerationMetadata } from './media-metadata.core'
import { getDatabase, saveDatabase } from '../database'

const MAX_METADATA_FILE_BYTES = 64 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface MediaFileRow {
  mediaId: string
  imageRefId: number
  filePath: string
  mimeType: string
}

function readMediaFileRow(mediaId: string): MediaFileRow | null {
  const row = getDatabase().exec('SELECT m.id,m.image_ref_id,r.file_path,r.mime_type FROM media_assets m JOIN image_refs r ON r.id=m.image_ref_id WHERE m.id=?', [mediaId])[0]?.values?.[0]
  if (!row) return null
  return { mediaId: String(row[0]), imageRefId: Number(row[1]), filePath: String(row[2] || ''), mimeType: String(row[3] || '') }
}

function sniffMime(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  return ''
}

// COALESCE 语义：已有非空字段绝不被覆盖；origin 仅在现有为空时写入；空数组/空对象视同未填
const UPSERT_METADATA_SQL = `
INSERT INTO image_generation_metadata (media_asset_id, origin, prompt, negative_prompt, checkpoint, model, loras_json, seed, sampler, scheduler, steps, cfg, width, height, raw_json, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(media_asset_id) DO UPDATE SET
  origin = CASE WHEN COALESCE(origin, '') = '' THEN excluded.origin ELSE origin END,
  prompt = COALESCE(NULLIF(prompt, ''), excluded.prompt),
  negative_prompt = COALESCE(NULLIF(negative_prompt, ''), excluded.negative_prompt),
  checkpoint = COALESCE(NULLIF(checkpoint, ''), excluded.checkpoint),
  model = COALESCE(NULLIF(model, ''), excluded.model),
  loras_json = CASE WHEN COALESCE(NULLIF(loras_json, ''), '[]') = '[]' THEN excluded.loras_json ELSE loras_json END,
  seed = COALESCE(seed, excluded.seed),
  sampler = COALESCE(NULLIF(sampler, ''), excluded.sampler),
  scheduler = COALESCE(NULLIF(scheduler, ''), excluded.scheduler),
  steps = COALESCE(steps, excluded.steps),
  cfg = COALESCE(cfg, excluded.cfg),
  width = COALESCE(width, excluded.width),
  height = COALESCE(height, excluded.height),
  raw_json = CASE WHEN COALESCE(NULLIF(raw_json, ''), '{}') = '{}' THEN excluded.raw_json ELSE raw_json END`

function persistParsedMetadata(mediaId: string, parsed: ParsedGenerationMetadata): void {
  getDatabase().run(UPSERT_METADATA_SQL, [
    mediaId, parsed.origin, parsed.prompt, parsed.negativePrompt, parsed.checkpoint,
    // model 列同步写入 checkpoint 名称（媒体面板以此字段展示模型）
    parsed.checkpoint, JSON.stringify(parsed.loras || []), parsed.seed, parsed.sampler,
    parsed.scheduler, parsed.steps, parsed.cfg, parsed.width, parsed.height,
    JSON.stringify(parsed.raw || {}), new Date().toISOString(),
  ])
  saveDatabase()
}

// 仅当列为 NULL 时补齐：尺寸来自文件头探测，mtime 来自文件系统（epoch 毫秒）
function persistRefImageInfo(imageRefId: number, buffer: Buffer, mtimeMs: number | null): void {
  const dimensions = probeImageDimensions(buffer)
  getDatabase().run('UPDATE image_refs SET width=COALESCE(width,?),height=COALESCE(height,?),file_mtime=COALESCE(file_mtime,?) WHERE id=?', [
    dimensions?.width ?? null, dimensions?.height ?? null, mtimeMs === null ? null : Math.floor(mtimeMs), imageRefId,
  ])
  saveDatabase()
}

/**
 * 解析单个媒体资产的嵌入生成元数据。
 * 读文件失败/超限/无嵌入元数据时返回 null；persist !== false 时写库并补齐图片尺寸。
 */
export async function parseMediaMetadata(mediaId: string, options: { persist?: boolean } = {}): Promise<ParsedGenerationMetadata | null> {
  const id = String(mediaId || '').trim()
  if (!id) return null
  const file = readMediaFileRow(id)
  if (!file || !file.filePath) return null
  let stats: fs.Stats
  try { stats = await fs.promises.stat(file.filePath) } catch { return null }
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_METADATA_FILE_BYTES) return null
  let buffer: Buffer
  try { buffer = await fs.promises.readFile(file.filePath) } catch { return null }
  const persist = options.persist !== false
  if (persist) persistRefImageInfo(file.imageRefId, buffer, stats.mtimeMs)
  const parsed = parseEmbeddedMetadata(buffer, file.mimeType || sniffMime(buffer))
  if (parsed && persist) persistParsedMetadata(id, parsed)
  return parsed
}

/**
 * 扫描候选资产（asset_type='image' 且生成元数据行缺失或全空）并批量解析。
 * skipped = 读文件失败 / 无嵌入元数据 / 超限；返回 { scanned, parsed, skipped }。
 */
export async function scanMediaMetadata(options: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<{ scanned: number; parsed: number; skipped: number }> {
  const batchSize = Math.min(1000, Math.max(1, Math.floor(Number(options.batchSize) || 100)))
  const candidates = getDatabase().exec(
    "SELECT m.id FROM media_assets m LEFT JOIN image_generation_metadata g ON g.media_asset_id=m.id WHERE m.asset_type='image' AND (g.media_asset_id IS NULL OR (COALESCE(g.prompt,'')='' AND COALESCE(NULLIF(g.raw_json,''),'{}')='{}')) ORDER BY m.created_at ASC, m.id ASC",
  )[0]?.values || []
  const ids = candidates.map(row => String(row[0]))
  let parsed = 0
  let skipped = 0
  for (let start = 0; start < ids.length; start += batchSize) {
    const batch = ids.slice(start, start + batchSize)
    for (const id of batch) {
      try {
        const result = await parseMediaMetadata(id)
        if (result) parsed += 1
        else skipped += 1
      } catch { skipped += 1 }
    }
    options.onProgress?.(Math.min(start + batchSize, ids.length), ids.length)
  }
  return { scanned: ids.length, parsed, skipped }
}