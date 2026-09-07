import fs from 'fs'
import path from 'path'
import { getDatabase, getResourceRoot, saveDatabase } from '../database'
import { buildManagedImagePath, inspectImageFile } from './asset.core'

export interface ManagedImageRecord {
  id: number
  file_path: string
  storage_mode: 'managed'
  asset_hash: string
  mime_type: string
  file_size: number
  original_name: string
}

/** Validate, hash, deduplicate and persist a local image in the managed library. */
export async function registerManagedImage(sourcePath: string, originalName?: string): Promise<ManagedImageRecord> {
  const inspection = await inspectImageFile(sourcePath)
  const db = getDatabase()
  const existing = db.exec(
    "SELECT id, file_path, storage_mode, asset_hash, mime_type, file_size, original_name FROM image_refs WHERE asset_hash=? AND storage_mode='managed' LIMIT 1",
    [inspection.hash]
  )
  const existingRow = existing[0]?.values?.[0]
  if (existingRow) {
    const canonicalPath = buildManagedImagePath(getResourceRoot(), inspection)
    if (!fs.existsSync(canonicalPath)) {
      await fs.promises.mkdir(path.dirname(canonicalPath), { recursive: true })
      await fs.promises.copyFile(sourcePath, canonicalPath)
    }
    db.run('UPDATE image_refs SET file_path=?, available=1 WHERE id=?', [canonicalPath, Number(existingRow[0])])
    saveDatabase()
    return {
      id: Number(existingRow[0]),
      file_path: canonicalPath,
      storage_mode: 'managed',
      asset_hash: String(existingRow[3]),
      mime_type: String(existingRow[4]),
      file_size: Number(existingRow[5]),
      original_name: String(existingRow[6] || path.basename(sourcePath)),
    }
  }

  const filePath = buildManagedImagePath(getResourceRoot(), inspection)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  if (!fs.existsSync(filePath)) await fs.promises.copyFile(sourcePath, filePath)

  db.run(
    'INSERT INTO image_refs (file_path, storage_mode, asset_hash, mime_type, file_size, original_name, available) VALUES (?,?,?,?,?,?,?)',
    [filePath, 'managed', inspection.hash, inspection.mimeType, inspection.size, safeImageName(originalName || inspection.originalName), 1]
  )
  saveDatabase()
  const idResult = db.exec('SELECT last_insert_rowid()')
  const id = Number(idResult[0]?.values?.[0]?.[0])
  return {
    id,
    file_path: filePath,
    storage_mode: 'managed',
    asset_hash: inspection.hash,
    mime_type: inspection.mimeType,
    file_size: inspection.size,
    original_name: safeImageName(originalName || inspection.originalName),
  }
}

function safeImageName(value: string): string {
  return path.basename(value).slice(0, 255) || 'image'
}
