import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeNovelaiMetadata, encodeNovelaiMetadata, readNovelaiMetadataFromPng, writeNovelaiMetadataToPng } from './novelai-metadata'

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
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))])
}

const params = { prompt: '1girl, {{long hair}}', negativePrompt: 'lowres', steps: 28, cfg: 5.5, seed: 424242, sampler: 'k_euler', scheduler: 'karras', width: 832, height: 1216, model: 'nai-diffusion-3', checkpoint: 'v3', loras: ['style-a'] }

describe('NovelAI metadata round trip (M6.6)', () => {
  it('encodes and decodes every modelled field', () => {
    const decoded = decodeNovelaiMetadata(encodeNovelaiMetadata(params))
    expect(decoded?.params).toEqual(params)
    expect(decoded?.version).toBe(1)
    expect(decoded?.unknown).toEqual({})
  })

  it('preserves keys a newer tool wrote instead of dropping them', () => {
    const text = JSON.stringify({ ...JSON.parse(encodeNovelaiMetadata(params)), futureField: { nested: [1, 2] } })
    const decoded = decodeNovelaiMetadata(text)
    expect(decoded?.unknown).toEqual({ futureField: { nested: [1, 2] } })
    // Re-encoding keeps the unknown key, so a later tool still sees its own data.
    const again = JSON.parse(encodeNovelaiMetadata(decoded!.params, decoded!.unknown))
    expect(again.futureField).toEqual({ nested: [1, 2] })
  })

  it('returns null for missing, malformed or prompt-less metadata', () => {
    expect(decodeNovelaiMetadata(null)).toBeNull()
    expect(decodeNovelaiMetadata('not json')).toBeNull()
    expect(decodeNovelaiMetadata('[]')).toBeNull()
    expect(decodeNovelaiMetadata('{"steps":10}')).toBeNull()
  })

  it('embeds into a PNG and reads back identical parameters', () => {
    const png = onePixelPng()
    const written = writeNovelaiMetadataToPng(png, params, { futureField: 'kept' })
    expect(written).not.toBeNull()
    const decoded = readNovelaiMetadataFromPng(written!)
    expect(decoded?.params).toEqual(params)
    expect(decoded?.unknown).toEqual({ futureField: 'kept' })
  })

  it('refuses non-PNG input rather than claiming success', () => {
    expect(writeNovelaiMetadataToPng(Buffer.from('jpeg-ish'), params)).toBeNull()
    expect(readNovelaiMetadataFromPng(Buffer.from('jpeg-ish'))).toBeNull()
  })
})
