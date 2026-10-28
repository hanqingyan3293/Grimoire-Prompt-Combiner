import fs from 'node:fs'
import path from 'node:path'

import { readNovelaiMetadataFromPng, writeNovelaiMetadataToPng, type DecodedNovelaiMetadata, type NovelaiGenerationParams } from './novelai-metadata'

// File-level access for the PNG metadata round trip (M6.6).
//
// Writing never overwrites the user's image: the result goes to a sibling `<name>.meta.png`, which
// is the only reversible option when the source may be someone else's file. Reading is pure.
export interface MetadataExportResult { readonly writtenPath: string; readonly bytes: number }

export function exportNovelaiMetadataToPng(input: { filePath: string; params: NovelaiGenerationParams; unknown?: Record<string, unknown> }): MetadataExportResult {
  if (typeof input.filePath !== 'string' || !input.filePath) throw new Error('filePath is required')
  const source = fs.readFileSync(input.filePath)
  const written = writeNovelaiMetadataToPng(source, input.params, input.unknown ?? {})
  if (!written) throw new Error('不是 PNG 文件：无法写入生成参数（JPEG 需要编码器，本版本不伪造成功）')
  const parsed = path.parse(input.filePath)
  const target = path.join(parsed.dir, parsed.name + '.meta' + (parsed.ext || '.png'))
  fs.writeFileSync(target, written)
  return { writtenPath: target, bytes: written.length }
}

export function readNovelaiMetadataFromFile(filePath: string): DecodedNovelaiMetadata | null {
  if (typeof filePath !== 'string' || !filePath) throw new Error('filePath is required')
  return readNovelaiMetadataFromPng(fs.readFileSync(filePath))
}
