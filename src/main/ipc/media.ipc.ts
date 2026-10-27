import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { batchDeleteMediaAssets, batchUpdateMediaAssets, deleteMediaAsset, getImageGenerationMetadata, getMediaAsset, listMediaAssets, listMediaRelations, createMediaRelation, deleteMediaRelation, relocateMediaAsset, saveImageGenerationMetadata, updateMediaAsset } from '../services/media.service'
import { ensureMediaAsset } from '../services/media.service'
import { getDatabase } from '../database'
import { previewMediaBatch, queryGallery, type GalleryQuery } from '../services/gallery-query.service'
import { ensureThumbnails, readThumbnails } from '../services/thumbnail.service'
import { parseMediaMetadata, scanMediaMetadata } from '../services/media-metadata.service'
import { indexPerceptualHashes, querySimilarImages } from '../services/similarity.service'
import { indexClipEmbeddings } from '../services/clip-index.service'
import { clipWorker, configureClipModelDirectory, configureClipPythonPath } from '../services/clip-worker'
import { findDuplicateGroups } from '../services/duplicate.service'
import { importScannedFiles, scanImageDirectory } from '../services/folder-scan.service'
import { deleteImageArtifacts } from '../services/image-asset.service'

export function registerMediaIPC(): void {
  ipcMain.handle(IPC_CHANNELS.MEDIA_LIST, async (_event, input: unknown) => listMediaAssets(input && typeof input === 'object' ? input as Record<string, unknown> : {}))
  ipcMain.handle(IPC_CHANNELS.MEDIA_GET, async (_event, id: unknown) => getMediaAsset(id))
  ipcMain.handle(IPC_CHANNELS.MEDIA_SEARCH, async (_event, input: unknown) => listMediaAssets(input && typeof input === 'object' ? input as Record<string, unknown> : {}))
  ipcMain.handle(IPC_CHANNELS.MEDIA_UPDATE, async (_event, input: unknown) => updateMediaAsset(input as { id: string; title?: string; description?: string; favorite?: boolean; rating?: number; sourceKind?: any; status?: string; metadata?: Record<string, unknown> }))
  ipcMain.handle(IPC_CHANNELS.MEDIA_DELETE, async (_event, id: unknown) => deleteMediaAsset(id))
  ipcMain.handle(IPC_CHANNELS.MEDIA_RELOCATE, async (_event, input: unknown) => relocateMediaAsset(String((input as any)?.id || ''), String((input as any)?.filePath || '')))
  ipcMain.handle(IPC_CHANNELS.MEDIA_BATCH_UPDATE, async (_event, input: unknown) => batchUpdateMediaAssets(input as { ids: string[]; favorite?: boolean; rating?: number }))
  ipcMain.handle(IPC_CHANNELS.MEDIA_BATCH_DELETE, async (_event, input: unknown) => {
    const ids = Array.isArray((input as any)?.ids) ? (input as any).ids.map(String) : []
    // 先清磁盘产物（托管副本/派生图；外链原文件绝不触碰），再删 DB 行——与 images.delete 同一策略。
    for (const id of ids) {
      const media = getMediaAsset(id)
      if (media) await deleteImageArtifacts(media.image_ref_id).catch(() => { /* 清理失败不阻塞 */ })
    }
    return batchDeleteMediaAssets(ids)
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_METADATA_GET, async (_event, id: unknown) => getImageGenerationMetadata(String(id || '')))
  ipcMain.handle(IPC_CHANNELS.MEDIA_METADATA_SAVE, async (_event, input: unknown) => saveImageGenerationMetadata(input as any))
  ipcMain.handle(IPC_CHANNELS.MEDIA_RELATIONS_LIST, async (_event, input: unknown) => { const value = input as { type: string; key: string }; return listMediaRelations(value.type, value.key) })
  ipcMain.handle(IPC_CHANNELS.MEDIA_RELATIONS_CREATE, async (_event, input: unknown) => createMediaRelation(input as any))
  ipcMain.handle(IPC_CHANNELS.MEDIA_RELATIONS_DELETE, async (_event, id: unknown) => deleteMediaRelation(id))
  // Ensure old callers that only create image_refs get a logical media asset.
  ipcMain.handle('media:ensure', async (_event, input: unknown) => ensureMediaAsset(Number((input as any)?.imageId), (input as any)?.sourceKind || 'imported-reference'))
  ipcMain.handle(IPC_CHANNELS.MEDIA_QUERY, async (_event, input: unknown) => {
    const value = (input || {}) as { query?: GalleryQuery; page?: { limit?: number; offset?: number } }
    return queryGallery(getDatabase(), value.query || {}, value.page || {})
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_THUMBS_LIST, async (_event, input: unknown) => {
    const value = (input || {}) as { ids?: unknown[]; kind?: string }
    const ids = Array.isArray(value.ids) ? value.ids.map(Number).filter(Number.isFinite) : []
    // Materialize missing derivatives first: the serial queue dedupes and skips
    // ids that already have a row, so repeat reads stay fast; new ids generate
    // once and are then served from image_derivatives.
    await Promise.all(ids.map(id => ensureThumbnails(id)))
    return readThumbnails(ids, value.kind === 'preview' ? 'preview' : 'thumbnail')
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_METADATA_PARSE, async (_event, input: unknown) => {
    const value = (input || {}) as { mediaId?: string; persist?: boolean }
    return parseMediaMetadata(String(value.mediaId || ''), { persist: value.persist })
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_METADATA_SCAN, async (event, input: unknown) => {
    const value = (input || {}) as { batchSize?: number }
    const sender = event.sender
    return scanMediaMetadata({
      batchSize: Number(value.batchSize) || undefined,
      onProgress: (done, total) => { try { sender.send(IPC_CHANNELS.MEDIA_SCAN_PROGRESS, { done, total }) } catch { /* window closed */ } },
    })
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_BATCH_PREVIEW, async (_event, input: unknown) => previewMediaBatch(getDatabase(), (input || {}) as { ids?: string[]; query?: GalleryQuery }))
  // Similarity / duplicates / folder scan (schema v30).
  ipcMain.handle(IPC_CHANNELS.MEDIA_SIMILARITY, async (_event, input: unknown) => {
    const value = (input || {}) as { imageRefId?: unknown; limit?: unknown; method?: unknown; maxDistance?: unknown }
    const imageRefId = Number(value.imageRefId)
    if (!Number.isInteger(imageRefId) || imageRefId <= 0) throw new Error('图片 ID 无效')
    const method = value.method === 'hash' || value.method === 'clip' ? value.method : 'auto'
    return querySimilarImages(getDatabase(), {
      imageRefId,
      limit: Number.isFinite(Number(value.limit)) ? Math.max(1, Math.min(200, Number(value.limit))) : 20,
      method,
      maxDistance: Number.isFinite(Number(value.maxDistance)) ? Math.max(0, Math.min(1, Number(value.maxDistance))) : undefined,
    })
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_SIMILARITY_INDEX, async (event, input: unknown) => {
    const value = (input || {}) as { batchSize?: unknown }
    const sender = event.sender
    const batchSize = Number.isFinite(Number(value.batchSize)) ? Math.max(1, Math.min(64, Number(value.batchSize))) : 16
    const report = (done: number, total: number) => { try { sender.send(IPC_CHANNELS.MEDIA_SIMILARITY_PROGRESS, { done, total }) } catch { /* window closed */ } }
    const hash = await indexPerceptualHashes(getDatabase(), { batchSize, onProgress: report })
    // 感知哈希永远可建；CLIP 嵌入只在 sidecar 可用（有模型）时尝试，失败静默
    // 降级——「相似图」按钮本身会在无嵌入数据时如实回落 hash 通道。
    let clip: { indexed: number; skipped: number; failed: number } | null = null
    try {
      const diagnostics = clipWorker.diagnostics()
      if (diagnostics.modelCount > 0 && diagnostics.pythonAvailable) {
        clip = await indexClipEmbeddings(getDatabase(), { batchSize: Math.min(8, batchSize), onProgress: report })
      }
    } catch { /* CLIP 不可用时保持 hash-only 索引 */ }
    return { ...hash, clip }
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_DUPLICATES, async (_event, input: unknown) => {
    const value = (input || {}) as { maxDistance?: unknown; limit?: unknown; page?: unknown }
    return findDuplicateGroups(getDatabase(), {
      maxDistance: Number.isFinite(Number(value.maxDistance)) ? Math.max(0, Math.min(16, Number(value.maxDistance))) : undefined,
      limit: Number.isFinite(Number(value.limit)) ? Math.max(1, Math.min(100, Number(value.limit))) : 50,
      page: Number.isFinite(Number(value.page)) ? Math.max(0, Number(value.page)) : 0,
    })
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_FOLDER_SCAN, async (_event, input: unknown) => {
    const value = (input || {}) as { directory?: unknown; recursive?: unknown }
    return scanImageDirectory(getDatabase(), { directory: String(value.directory || ''), recursive: value.recursive === true })
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_FOLDER_IMPORT, async (_event, input: unknown) => {
    const value = (input || {}) as { filePaths?: unknown; mode?: unknown }
    return importScannedFiles(getDatabase(), {
      filePaths: Array.isArray(value.filePaths) ? value.filePaths.map(String) : [],
      mode: value.mode === 'external' ? 'external' : 'managed',
    })
  })
  // CLIP sidecar 配置（照搬 WD14 的选择目录/解释器模式；settings 持久化由渲染层调 settings.set）。
  ipcMain.handle(IPC_CHANNELS.MEDIA_CLIP_DIAGNOSTICS, async () => clipWorker.diagnostics())
  ipcMain.handle(IPC_CHANNELS.MEDIA_CLIP_SELECT_MODEL_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    const directory = result.filePaths[0]
    await clipWorker.stop()
    configureClipModelDirectory(directory)
    return directory
  })
  ipcMain.handle(IPC_CHANNELS.MEDIA_CLIP_SELECT_PYTHON_PATH, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Python', extensions: ['exe'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    const pythonPath = result.filePaths[0]
    await clipWorker.stop()
    configureClipPythonPath(pythonPath)
    return pythonPath
  })
}
