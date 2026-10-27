import zlib from 'node:zlib'

// PNG text-chunk metadata (M6.6).
//
// The NovelAI ecosystem stores generation parameters inside the image as `tEXt`/`iTXt` chunks, so
// a prompt survives copying the file around. Node has zlib but no image library, and the project
// deliberately adds no dependency for this: PNG chunking is a small, well-specified format and
// writing it here keeps the round trip testable byte-for-byte.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface PngTextEntry { readonly keyword: string; readonly text: string }

export class PngMetadataError extends Error {
  constructor(readonly code: 'NOT_PNG' | 'BAD_CHUNK' | 'BAD_TEXT', message: string) {
    super(message)
    this.name = 'PngMetadataError'
  }
}

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

interface Chunk { readonly type: string; readonly data: Buffer }

function readChunks(buffer: Buffer): Chunk[] {
  if (!isPng(buffer)) throw new PngMetadataError('NOT_PNG', 'not a PNG file')
  const chunks: Chunk[] = []
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > buffer.length) throw new PngMetadataError('BAD_CHUNK', 'truncated chunk ' + type)
    chunks.push({ type, data: buffer.subarray(start, end) })
    offset = end + 4 // skip CRC; it is recomputed when writing
    if (type === 'IEND') break
  }
  return chunks
}

function keywordOf(data: Buffer): { keyword: string; rest: Buffer } {
  const zero = data.indexOf(0)
  if (zero <= 0) return { keyword: '', rest: data }
  return { keyword: data.toString('latin1', 0, zero), rest: data.subarray(zero + 1) }
}

function decodeText(chunk: Chunk): PngTextEntry | null {
  if (chunk.type === 'tEXt') {
    const { keyword, rest } = keywordOf(chunk.data)
    return keyword ? { keyword, text: rest.toString('latin1') } : null
  }
  if (chunk.type !== 'iTXt') return null
  // keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
  const { keyword, rest } = keywordOf(chunk.data)
  if (!keyword || rest.length < 2) return null
  const compressed = rest[0] === 1
  const languageEnd = rest.indexOf(0, 2)
  const translatedEnd = languageEnd >= 0 ? rest.indexOf(0, languageEnd + 1) : -1
  if (languageEnd < 0 || translatedEnd < 0) return null
  const body = rest.subarray(translatedEnd + 1)
  try {
    const text = compressed ? zlib.inflateSync(body).toString('utf8') : body.toString('utf8')
    return { keyword, text }
  } catch {
    return null
  }
}

/** All text entries, in file order. Unknown/broken entries are skipped, not guessed. */
export function readPngText(buffer: Buffer): PngTextEntry[] {
  const entries: PngTextEntry[] = []
  for (const chunk of readChunks(buffer)) {
    const entry = decodeText(chunk)
    if (entry) entries.push(entry)
  }
  return entries
}

export function getPngText(buffer: Buffer, keyword: string): string | null {
  const found = readPngText(buffer).filter(entry => entry.keyword === keyword)
  return found.length ? found[found.length - 1].text : null
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0)
  return Buffer.concat([header, data, crc])
}

function encodeText(entry: PngTextEntry): Buffer {
  if (!entry.keyword || entry.keyword.length > 79) throw new PngMetadataError('BAD_TEXT', 'keyword must be 1-79 bytes')
  if (/[\u0000-\u001f\u0080-\u00ff]/.test(entry.keyword)) throw new PngMetadataError('BAD_TEXT', 'keyword must be printable latin-1')
  const compressed = zlib.deflateSync(Buffer.from(entry.text, 'utf8'))
  const body = Buffer.concat([
    Buffer.from(entry.keyword, 'latin1'), Buffer.from([0]),
    Buffer.from([1, 0]), // compression flag = 1, method = 0
    Buffer.from([0]), // empty language tag
    Buffer.from([0]), // empty translated keyword
    compressed,
  ])
  return chunk('iTXt', body)
}

/**
 * Insert (or replace) text entries and return a valid PNG. Every other chunk is copied
 * byte-for-byte and the IEND stays last, so pixels and colour data are untouched.
 */
export function writePngText(buffer: Buffer, entries: readonly PngTextEntry[]): Buffer {
  const chunks = readChunks(buffer)
  const replaced = new Set(entries.map(entry => entry.keyword))
  const output: Buffer[] = [PNG_SIGNATURE]
  let inserted = false
  const insert = () => {
    if (inserted) return
    for (const entry of entries) output.push(encodeText(entry))
    inserted = true
  }
  for (const current of chunks) {
    if (current.type === 'IEND') { insert(); output.push(chunk('IEND', current.data)); continue }
    const decoded = decodeText(current)
    if (decoded && replaced.has(decoded.keyword)) continue
    output.push(chunk(current.type, current.data))
  }
  return Buffer.concat(output)
}
