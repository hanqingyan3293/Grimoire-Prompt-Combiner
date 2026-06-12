// ============================================================
// 图片元数据解析服务（PNG tEXt/iTXt, JPEG EXIF）
// ============================================================

import fs from 'fs'
import path from 'path'

export interface ImageMetadata {
  filePath: string
  fileName: string
  ext: string
  sizeBytes: number
  prompt?: string
  negativePrompt?: string
  parameters?: string
  steps?: number
  sampler?: string
  cfgScale?: number
  seed?: number
  model?: string
  width?: number
  height?: number
}

export async function parseImageMetadata(filePath: string): Promise<ImageMetadata> {
  const stats = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const metadata: ImageMetadata = {
    filePath,
    fileName: path.basename(filePath),
    ext,
    sizeBytes: stats.size
  }

  try {
    if (ext === '.png') {
      parsePNGMetadata(filePath, metadata)
    } else if (ext === '.jpg' || ext === '.jpeg') {
      parseJPEGMetadata(filePath, metadata)
    }
  } catch (e) {
    console.error('[ImageParser] Error parsing metadata:', e)
  }

  return metadata
}

function parsePNGMetadata(filePath: string, metadata: ImageMetadata): void {
  const buffer = fs.readFileSync(filePath)
  let offset = 8 // Skip PNG signature

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)

    if (type === 'tEXt' || type === 'iTXt') {
      const data = buffer.toString('utf-8', offset + 8, offset + 8 + length)
      const nullIdx = data.indexOf('\0')
      if (nullIdx > 0) {
        const key = data.substring(0, nullIdx)
        const value = data.substring(nullIdx + 1)
        if (key === 'parameters' || key === 'prompt') {
          metadata.parameters = value
          parseSDParameters(value, metadata)
        } else if (key === 'Comment') {
          metadata.prompt = metadata.prompt || value
        }
      }
    }

    offset += 12 + length
    if (offset >= buffer.length) break
  }
}

function parseJPEGMetadata(filePath: string, metadata: ImageMetadata): void {
  // Basic JPEG EXIF parsing - extract UserComment or ImageDescription
  const buffer = fs.readFileSync(filePath)
  let offset = 2 // Skip SOI marker

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xFF) {
      offset++
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === 0xE1) { // APP1 - EXIF
      const length = buffer.readUInt16BE(offset + 2)
      const chunk = buffer.subarray(offset + 4, offset + 2 + length)
      const exifStr = chunk.toString('ascii', 0, 6)
      if (exifStr === 'Exif\0\0') {
        parseExifChunk(chunk, metadata)
        break
      }
    } else if (marker === 0xED) { // APP13 - Photoshop IRB
      // Could contain IPTC data
    }
    if (marker === 0xDA) break // Start of Scan - stop
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
}

function parseExifChunk(chunk: Buffer, metadata: ImageMetadata): void {
  const exifStr = chunk.toString('binary', 8)
  const userCommentIdx = exifStr.indexOf('UserComment')
  if (userCommentIdx > 0) {
    const commentStart = exifStr.indexOf('\0', userCommentIdx + 20)
    if (commentStart > 0) {
      const commentEnd = exifStr.indexOf('\0', commentStart + 8)
      if (commentEnd > 0) {
        const comment = exifStr.substring(commentStart + 8, commentEnd)
        if (comment.length > 10) {
          metadata.parameters = comment
          parseSDParameters(comment, metadata)
        }
      }
    }
  }
}

function parseSDParameters(params: string, metadata: ImageMetadata): void {
  // Parse Stable Diffusion / NovelAI style parameters:
  // positive prompt\nNegative prompt: negative\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, ...
  const negIdx = params.indexOf('Negative prompt:')
  if (negIdx >= 0) {
    metadata.prompt = params.substring(0, negIdx).trim()
    const afterNeg = params.substring(negIdx + 16)
    const stepsIdx = afterNeg.indexOf('Steps:')
    if (stepsIdx >= 0) {
      metadata.negativePrompt = afterNeg.substring(0, stepsIdx).trim()
      const paramStr = afterNeg.substring(stepsIdx)

      const stepsM = paramStr.match(/Steps:\s*(\d+)/)
      if (stepsM) metadata.steps = parseInt(stepsM[1])

      const samplerM = paramStr.match(/Sampler:\s*([^,]+)/)
      if (samplerM) metadata.sampler = samplerM[1].trim()

      const cfgM = paramStr.match(/CFG scale:\s*([\d.]+)/)
      if (cfgM) metadata.cfgScale = parseFloat(cfgM[1])

      const seedM = paramStr.match(/Seed:\s*(\d+)/)
      if (seedM) metadata.seed = parseInt(seedM[1])

      const modelM = paramStr.match(/Model(?: hash)?:\s*([^,]+)/)
      if (modelM) metadata.model = modelM[1].trim()

      const sizeM = paramStr.match(/Size:\s*(\d+)x(\d+)/)
      if (sizeM) {
        metadata.width = parseInt(sizeM[1])
        metadata.height = parseInt(sizeM[2])
      }
    } else {
      metadata.negativePrompt = afterNeg.trim()
    }
  } else {
    metadata.prompt = params.trim()
  }
}
