import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseA1111Parameters, parseComfyGraph, parseEmbeddedMetadata, parseNovelAICaption, readJpegExifUserComment, readPngTextChunks } from './media-metadata.core'

// ---------- 测试用 PNG/JPEG 程序化构造 ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

interface PngTextChunk { type: 'tEXt' | 'zTXt' | 'iTXt'; keyword: string; text: string; compressed?: boolean }

function buildPng(width: number, height: number, chunks: PngTextChunk[]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 2  // RGB
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)]
  for (const chunk of chunks) {
    const keyword = Buffer.from(chunk.keyword, 'latin1')
    if (chunk.type === 'tEXt') {
      parts.push(pngChunk('tEXt', Buffer.concat([keyword, Buffer.from([0]), Buffer.from(chunk.text, 'utf8')])))
    } else if (chunk.type === 'zTXt') {
      parts.push(pngChunk('zTXt', Buffer.concat([keyword, Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(chunk.text, 'utf8'))])))
    } else {
      const text = Buffer.from(chunk.text, 'utf8')
      parts.push(pngChunk('iTXt', Buffer.concat([
        keyword, Buffer.from([0, chunk.compressed ? 1 : 0, 0]), Buffer.from([0]), Buffer.from([0]),
        chunk.compressed ? zlib.deflateSync(text) : text,
      ])))
    }
  }
  parts.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

// 最小 JPEG：SOI + APP1(Exif) + EOI；TIFF 为 II 排列，IFD0(0x8769) → ExifIFD(0x9286)
function buildJpegUserComment(payload: Buffer): Buffer {
  const ifd0Offset = 8
  const exifIfdOffset = ifd0Offset + 2 + 12 + 4
  const dataOffset = exifIfdOffset + 2 + 12 + 4
  const tiff = Buffer.alloc(dataOffset + payload.length)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(ifd0Offset, 4)
  tiff.writeUInt16LE(1, ifd0Offset)
  const ifd0Entry = ifd0Offset + 2
  tiff.writeUInt16LE(0x8769, ifd0Entry)
  tiff.writeUInt16LE(4, ifd0Entry + 2)
  tiff.writeUInt32LE(1, ifd0Entry + 4)
  tiff.writeUInt32LE(exifIfdOffset, ifd0Entry + 8)
  tiff.writeUInt16LE(1, exifIfdOffset)
  const exifEntry = exifIfdOffset + 2
  tiff.writeUInt16LE(0x9286, exifEntry)
  tiff.writeUInt16LE(7, exifEntry + 2)
  tiff.writeUInt32LE(payload.length, exifEntry + 4)
  tiff.writeUInt32LE(dataOffset, exifEntry + 8)
  payload.copy(tiff, dataOffset)
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const app1 = Buffer.alloc(4 + exifPayload.length)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1.writeUInt16BE(2 + exifPayload.length, 2)
  exifPayload.copy(app1, 4)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])])
}

const A1111_TEXT = 'masterpiece, best quality, 1girl\nblue eyes\nNegative prompt: lowres, bad anatomy\nSteps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234567890, Size: 512x768, Model hash: e3b0c44298, Model: v1-5-pruned-emaonly, Denoising strength: 0.55, VAE: vae-ft-mse-840000'

// ---------- readPngTextChunks ----------

describe('readPngTextChunks', () => {
  it('reads tEXt, zTXt and iTXt chunks (iTXt both plain and compressed)', () => {
    const png = buildPng(64, 64, [
      { type: 'tEXt', keyword: 'parameters', text: A1111_TEXT },
      { type: 'zTXt', keyword: 'compressed', text: 'zlib 文本块内容' },
      { type: 'iTXt', keyword: 'plain', text: '国际文本 iTXt' },
      { type: 'iTXt', keyword: 'packed', text: '压缩 iTXt 内容', compressed: true },
    ])
    const chunks = readPngTextChunks(png)
    expect(chunks.parameters).toBe(A1111_TEXT)
    expect(chunks.compressed).toBe('zlib 文本块内容')
    expect(chunks.plain).toBe('国际文本 iTXt')
    expect(chunks.packed).toBe('压缩 iTXt 内容')
  })

  it('falls back to latin1 when bytes are not valid UTF-8', () => {
    const png = buildPng(8, 8, []) // 先建骨架，再手工替换为 latin1 tEXt
    const latin1Chunk = pngChunk('tEXt', Buffer.concat([Buffer.from('note', 'latin1'), Buffer.from([0]), Buffer.from('café', 'latin1')]))
    const rebuilt = Buffer.concat([png.subarray(0, 33), latin1Chunk, pngChunk('IEND', Buffer.alloc(0))]) // 33 = 签名8 + IHDR块25
    expect(readPngTextChunks(rebuilt).note).toBe('café')
  })

  it('returns an empty record for non-PNG, truncated and empty input', () => {
    expect(readPngTextChunks(Buffer.from('not a png at all'))).toEqual({})
    expect(readPngTextChunks(Buffer.alloc(0))).toEqual({})
    const png = buildPng(64, 64, [{ type: 'tEXt', keyword: 'parameters', text: A1111_TEXT }])
    expect(readPngTextChunks(png.subarray(0, 30))).toEqual({})
  })
})

// ---------- parseA1111Parameters ----------

describe('parseA1111Parameters', () => {
  it('parses positive/negative prompts and the trailing parameter line', () => {
    const parsed = parseA1111Parameters(A1111_TEXT)
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('webui')
    expect(parsed!.prompt).toBe('masterpiece, best quality, 1girl\nblue eyes')
    expect(parsed!.negativePrompt).toBe('lowres, bad anatomy')
    expect(parsed!.steps).toBe(28)
    expect(parsed!.sampler).toBe('DPM++ 2M Karras')
    expect(parsed!.cfg).toBe(7)
    expect(parsed!.seed).toBe(1234567890)
    expect(parsed!.width).toBe(512)
    expect(parsed!.height).toBe(768)
    expect(parsed!.modelHash).toBe('e3b0c44298')
    expect(parsed!.checkpoint).toBe('v1-5-pruned-emaonly')
    expect(parsed!.raw.a1111).toBe(A1111_TEXT)
  })

  it('tolerates lowercase keys and different key order, ignoring Forge extras', () => {
    const parsed = parseA1111Parameters('cat\nNegative prompt: dog\nsteps: 20, seed: 7, size: 640x480, cfg scale: 4.5, sampler: Euler a, Model hash: f00dbabe, VAE: sdxl_vae, Clip skip: 2, Denoising strength: 0.4')
    expect(parsed).not.toBeNull()
    expect(parsed!.steps).toBe(20)
    expect(parsed!.cfg).toBe(4.5)
    expect(parsed!.seed).toBe(7)
    expect(parsed!.sampler).toBe('Euler a')
    expect(parsed!.width).toBe(640)
    expect(parsed!.height).toBe(480)
    expect(parsed!.modelHash).toBe('f00dbabe')
    expect(parsed!.checkpoint).toBe('')
  })

  it('supports a negative-only body without a parameter tail', () => {
    const parsed = parseA1111Parameters('a landscape\nNegative prompt: ugly')
    expect(parsed).not.toBeNull()
    expect(parsed!.prompt).toBe('a landscape')
    expect(parsed!.negativePrompt).toBe('ugly')
    expect(parsed!.steps).toBeNull()
    expect(parsed!.seed).toBeNull()
  })

  it('returns null for empty or whitespace-only input', () => {
    expect(parseA1111Parameters('')).toBeNull()
    expect(parseA1111Parameters('   \n\t ')).toBeNull()
  })
})

// ---------- parseNovelAICaption ----------

describe('parseNovelAICaption', () => {
  it('maps prompt/uc/scale and the numeric fields', () => {
    const nai = JSON.stringify({ prompt: '1girl, white hair', uc: 'lowres, bad hands', steps: 28, sampler: 'k_euler_ancestral', seed: 987654321, width: 832, height: 1216, scale: 11, model: 'nai-diffusion-3' })
    const parsed = parseNovelAICaption(nai)
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('novelai')
    expect(parsed!.prompt).toBe('1girl, white hair')
    expect(parsed!.negativePrompt).toBe('lowres, bad hands')
    expect(parsed!.steps).toBe(28)
    expect(parsed!.sampler).toBe('k_euler_ancestral')
    expect(parsed!.seed).toBe(987654321)
    expect(parsed!.width).toBe(832)
    expect(parsed!.height).toBe(1216)
    expect(parsed!.cfg).toBe(11)
    expect(parsed!.checkpoint).toBe('nai-diffusion-3')
    expect(parsed!.raw.nai).toMatchObject({ uc: 'lowres, bad hands', scale: 11 })
  })

  it('tolerates missing fields', () => {
    const parsed = parseNovelAICaption('{"prompt":"solo"}')
    expect(parsed).not.toBeNull()
    expect(parsed!.prompt).toBe('solo')
    expect(parsed!.negativePrompt).toBe('')
    expect(parsed!.seed).toBeNull()
    expect(parsed!.cfg).toBeNull()
  })

  it('returns null for invalid JSON, non-objects and unknown-shape objects', () => {
    expect(parseNovelAICaption('{invalid json')).toBeNull()
    expect(parseNovelAICaption('[1,2,3]')).toBeNull()
    expect(parseNovelAICaption('"just a string"')).toBeNull()
    expect(parseNovelAICaption('{}')).toBeNull()
    expect(parseNovelAICaption('{"foo":1}')).toBeNull()
    expect(parseNovelAICaption('')).toBeNull()
  })
})

// ---------- parseComfyGraph ----------

describe('parseComfyGraph', () => {
  it('parses API-format prompt dictionaries with links, loras and latent size', () => {
    const apiPrompt = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
      '2': { class_type: 'LoraLoader', inputs: { lora_name: 'detail.safetensors', strength_model: 0.8, model: ['1', 0], clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat, masterpiece', clip: ['2', 1] } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['2', 1] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      '6': { class_type: 'KSampler', inputs: { seed: 424242, steps: 25, cfg: 7.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['2', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
    }
    const parsed = parseComfyGraph(JSON.stringify(apiPrompt))
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('comfyui-embedded')
    expect(parsed!.prompt).toBe('a cat, masterpiece')
    expect(parsed!.negativePrompt).toBe('blurry, low quality')
    expect(parsed!.seed).toBe(424242)
    expect(parsed!.steps).toBe(25)
    expect(parsed!.cfg).toBe(7.5)
    expect(parsed!.sampler).toBe('euler')
    expect(parsed!.scheduler).toBe('normal')
    expect(parsed!.checkpoint).toBe('sd_xl_base_1.0.safetensors')
    expect(parsed!.loras).toEqual(['detail.safetensors'])
    expect(parsed!.width).toBe(1024)
    expect(parsed!.height).toBe(1024)
  })

  it('supports KSamplerAdvanced (noise_seed) and text resolved through nested links', () => {
    const apiPrompt = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: ['9', 0] } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'bad' } },
      '9': { class_type: 'PrimitiveNode', inputs: { value: 'linked prompt text' } },
      '3': { class_type: 'KSamplerAdvanced', inputs: { add_noise: 'enable', noise_seed: 777, steps: 30, cfg: 8, sampler_name: 'dpmpp_2m', scheduler: 'karras', positive: ['1', 0], negative: ['2', 0] } },
    }
    const parsed = parseComfyGraph(JSON.stringify(apiPrompt))
    expect(parsed).not.toBeNull()
    expect(parsed!.seed).toBe(777)
    expect(parsed!.steps).toBe(30)
    expect(parsed!.cfg).toBe(8)
    expect(parsed!.sampler).toBe('dpmpp_2m')
    expect(parsed!.scheduler).toBe('karras')
    expect(parsed!.prompt).toBe('linked prompt text')
    expect(parsed!.negativePrompt).toBe('bad')
  })

  it('parses workflow-format node arrays with widgets and link table', () => {
    const workflow = {
      nodes: [
        { id: 3, type: 'KSampler', widgets_values: [42, 'randomize', 20, 7.5, 'euler', 'normal', 1], inputs: [{ name: 'positive', link: 10 }, { name: 'negative', link: 11 }, { name: 'latent_image', link: 12 }] },
        { id: 4, type: 'CheckpointLoaderSimple', widgets_values: ['sd15.safetensors'], inputs: [] },
        { id: 5, type: 'EmptyLatentImage', widgets_values: [832, 1216, 1], inputs: [] },
        { id: 6, type: 'CLIPTextEncode', widgets_values: ['a dog'], inputs: [] },
        { id: 7, type: 'CLIPTextEncode', widgets_values: ['watermark'], inputs: [] },
        { id: 8, type: 'LoraLoader', widgets_values: ['style.safetensors', 0.8, 0.8], inputs: [] },
      ],
      links: [[10, 6, 0, 3, 0, 'CONDITIONING'], [11, 7, 0, 3, 1, 'CONDITIONING'], [12, 5, 0, 3, 2, 'LATENT']],
    }
    const parsed = parseComfyGraph(JSON.stringify(workflow))
    expect(parsed).not.toBeNull()
    expect(parsed!.seed).toBe(42)
    expect(parsed!.steps).toBe(20)
    expect(parsed!.cfg).toBe(7.5)
    expect(parsed!.sampler).toBe('euler')
    expect(parsed!.scheduler).toBe('normal')
    expect(parsed!.prompt).toBe('a dog')
    expect(parsed!.negativePrompt).toBe('watermark')
    expect(parsed!.checkpoint).toBe('sd15.safetensors')
    expect(parsed!.loras).toEqual(['style.safetensors'])
    expect(parsed!.width).toBe(832)
    expect(parsed!.height).toBe(1216)
  })

  it('handles legacy KSampler widgets without the control value', () => {
    const workflow = { nodes: [{ id: 3, type: 'KSampler', widgets_values: [7, 15, 6.5, 'ddim', 'normal', 0.9], inputs: [] }] }
    const parsed = parseComfyGraph(JSON.stringify(workflow))
    expect(parsed).not.toBeNull()
    expect(parsed!.seed).toBe(7)
    expect(parsed!.steps).toBe(15)
    expect(parsed!.cfg).toBe(6.5)
    expect(parsed!.sampler).toBe('ddim')
  })

  it('returns null for malformed or unrecognized JSON', () => {
    expect(parseComfyGraph('not json')).toBeNull()
    expect(parseComfyGraph('{}')).toBeNull()
    expect(parseComfyGraph('{"nodes":[]}')).toBeNull()
    expect(parseComfyGraph('[]')).toBeNull()
    expect(parseComfyGraph('')).toBeNull()
  })
})

// ---------- readJpegExifUserComment ----------

describe('readJpegExifUserComment', () => {
  it('reads Unicode (UTF-16LE) and ASCII user comments from a minimal APP1/EXIF segment', () => {
    const text = 'a cat\nNegative prompt: blurry\nSteps: 20, Sampler: euler, CFG scale: 7, Seed: 5, Size: 64x64'
    const unicodeLittle = Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), Buffer.from(text, 'utf16le')])
    expect(readJpegExifUserComment(buildJpegUserComment(unicodeLittle))).toBe(text)
    const ascii = Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from(text, 'latin1')])
    expect(readJpegExifUserComment(buildJpegUserComment(ascii))).toBe(text)
  })

  it('detects UTF-16BE payloads without BOM (piexif style) under little-endian TIFF', () => {
    const text = 'Steps: 20, Sampler: euler, CFG scale: 7, Seed: 5, Size: 64x64'
    const bigEndian = Buffer.from(text, 'utf16le').swap16()
    const payload = Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), bigEndian])
    expect(readJpegExifUserComment(buildJpegUserComment(payload))).toBe(text)
  })

  it('returns null for JPEGs without EXIF user comments', () => {
    expect(readJpegExifUserComment(Buffer.alloc(0))).toBeNull()
    expect(readJpegExifUserComment(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
    expect(readJpegExifUserComment(Buffer.from('not a jpeg'))).toBeNull()
  })
})

// ---------- parseEmbeddedMetadata ----------

describe('parseEmbeddedMetadata', () => {
  it('routes PNG parameters chunks to A1111 and keeps the raw block', () => {
    const png = buildPng(512, 768, [{ type: 'tEXt', keyword: 'parameters', text: A1111_TEXT }])
    const parsed = parseEmbeddedMetadata(png, 'image/png')
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('webui')
    expect(parsed!.seed).toBe(1234567890)
    expect(parsed!.raw.a1111).toBe(A1111_TEXT)
    expect(parsed!.raw.chunks).toEqual(['parameters'])
  })

  it('routes PNG Comment JSON chunks to NovelAI (iTXt container)', () => {
    const nai = JSON.stringify({ prompt: 'cat', uc: 'dog', steps: 28, sampler: 'k_euler', seed: 1, width: 512, height: 512, scale: 5 })
    const png = buildPng(512, 512, [{ type: 'iTXt', keyword: 'Comment', text: nai }])
    const parsed = parseEmbeddedMetadata(png, 'image/png')
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('novelai')
    expect(parsed!.prompt).toBe('cat')
    expect(parsed!.negativePrompt).toBe('dog')
    expect(parsed!.cfg).toBe(5)
  })

  it('routes PNG prompt+workflow chunks to ComfyUI', () => {
    const apiPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 3, steps: 10, cfg: 6, sampler_name: 'euler', scheduler: 'normal' } } }
    const workflow = { nodes: [{ id: 1, type: 'KSampler', widgets_values: [3] }], links: [] }
    const png = buildPng(64, 64, [
      { type: 'zTXt', keyword: 'prompt', text: JSON.stringify(apiPrompt) },
      { type: 'tEXt', keyword: 'workflow', text: JSON.stringify(workflow) },
    ])
    const parsed = parseEmbeddedMetadata(png, 'image/png')
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('comfyui-embedded')
    expect(parsed!.seed).toBe(3)
    expect(parsed!.steps).toBe(10)
    expect(parsed!.raw.comfyPrompt).toMatchObject(apiPrompt)
    expect([...(parsed!.raw.chunks as string[])].sort()).toEqual(['prompt', 'workflow'])
  })

  it('returns null when PNG chunks are unknown or the input is malformed', () => {
    const unknownOnly = buildPng(8, 8, [{ type: 'tEXt', keyword: 'Software', text: 'something' }])
    expect(parseEmbeddedMetadata(unknownOnly, 'image/png')).toBeNull()
    expect(parseEmbeddedMetadata(Buffer.alloc(0), 'image/png')).toBeNull()
    const valid = buildPng(64, 64, [{ type: 'tEXt', keyword: 'parameters', text: A1111_TEXT }])
    expect(parseEmbeddedMetadata(valid.subarray(0, 40), 'image/png')).toBeNull()
  })

  it('returns null for non-PNG/JPEG mime types', () => {
    const png = buildPng(64, 64, [{ type: 'tEXt', keyword: 'parameters', text: A1111_TEXT }])
    expect(parseEmbeddedMetadata(png, 'image/webp')).toBeNull()
    expect(parseEmbeddedMetadata(png, 'image/bmp')).toBeNull()
    expect(parseEmbeddedMetadata(png, 'text/plain')).toBeNull()
    expect(parseEmbeddedMetadata(png, '')).toBeNull()
  })

  it('parses A1111 text carried in a JPEG EXIF user comment', () => {
    const text = 'a cat\nNegative prompt: blurry\nSteps: 20, Sampler: euler, CFG scale: 7, Seed: 5, Size: 64x64'
    const payload = Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), Buffer.from(text, 'utf16le')])
    const parsed = parseEmbeddedMetadata(buildJpegUserComment(payload), 'image/jpeg')
    expect(parsed).not.toBeNull()
    expect(parsed!.origin).toBe('webui')
    expect(parsed!.prompt).toBe('a cat')
    expect(parsed!.negativePrompt).toBe('blurry')
    expect(parsed!.seed).toBe(5)
  })
})