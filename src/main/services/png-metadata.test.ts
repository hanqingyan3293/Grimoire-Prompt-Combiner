import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PngMetadataError, getPngText, isPng, readPngText, writePngText } from './png-metadata'

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0)
  return Buffer.concat([header, data, crc])
}

function onePixelPng(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  const raw = Buffer.from([0, 255, 0, 0]) // filter byte + one red pixel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('PNG text metadata (M6.6)', () => {
  it('round-trips a text entry without touching image chunks', () => {
    const original = onePixelPng()
    const written = writePngText(original, [{ keyword: 'Comment', text: '1girl, {{long hair}}, seed=42' }])
    expect(isPng(written)).toBe(true)
    expect(getPngText(written, 'Comment')).toBe('1girl, {{long hair}}, seed=42')
    // Pixel data must survive byte-for-byte: same IDAT payload, same IHDR, IEND still last.
    const payload = (buffer: Buffer, type: string) => {
      const index = buffer.indexOf(type, 0, 'latin1')
      const length = buffer.readUInt32BE(index - 4)
      return buffer.subarray(index + 4, index + 4 + length)
    }
    expect(payload(written, 'IDAT').equals(payload(original, 'IDAT'))).toBe(true)
    expect(payload(written, 'IHDR').equals(payload(original, 'IHDR'))).toBe(true)
    expect(written.subarray(written.length - 8).includes(Buffer.from('IEND'))).toBe(true)
  })

  it('replaces an existing keyword instead of appending duplicates', () => {
    const once = writePngText(onePixelPng(), [{ keyword: 'Comment', text: 'first' }])
    const twice = writePngText(once, [{ keyword: 'Comment', text: 'second' }])
    expect(readPngText(twice).filter(entry => entry.keyword === 'Comment')).toHaveLength(1)
    expect(getPngText(twice, 'Comment')).toBe('second')
  })

  it('keeps multiple distinct entries readable in file order', () => {
    const written = writePngText(onePixelPng(), [
      { keyword: 'Comment', text: 'prompt' },
      { keyword: 'Software', text: '魔导书' },
    ])
    expect(readPngText(written).map(entry => entry.keyword)).toEqual(['Comment', 'Software'])
    expect(getPngText(written, 'Software')).toBe('魔导书')
  })

  it('refuses non-PNG input and unusable keywords', () => {
    expect(isPng(Buffer.from('not a png'))).toBe(false)
    expect(() => readPngText(Buffer.from('not a png'))).toThrowError(PngMetadataError)
    expect(() => writePngText(onePixelPng(), [{ keyword: '', text: 'x' }])).toThrow(/keyword/i)
  })
})
