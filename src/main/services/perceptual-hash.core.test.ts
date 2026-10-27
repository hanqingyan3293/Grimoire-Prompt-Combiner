import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  combinedDistance,
  computeColorHistogram,
  computeDhash,
  computePerceptualHash,
  decodeImagePixels,
  hammingDistance,
  histogramDistance,
  type DecodedPixels,
} from './perceptual-hash.core'

// ---------- 测试用 PNG 编码器（CRC/分块风格与 media-metadata.core.test 一致） ----------

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

interface PngPass { x0: number; y0: number; dx: number; dy: number }

const ADAM7_PASSES: PngPass[] = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
]

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

interface PngSpec {
  width: number
  height: number
  colorType: 0 | 2 | 3 | 4 | 6
  bitDepth?: number
  interlace?: 0 | 1
  palette?: Buffer
  trns?: Buffer
  sample: (x: number, y: number) => number[]
  filters?: (row: number, pass: number) => number
}

function passSize(length: number, start: number, step: number): number {
  return length > start ? Math.ceil((length - start) / step) : 0
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

function packRow(spec: PngSpec, pass: PngPass, passWidth: number, rowIndex: number): Buffer {
  const bitDepth = spec.bitDepth ?? 8
  const channels = PNG_CHANNELS[spec.colorType]
  if (bitDepth === 8) {
    const row = Buffer.alloc(passWidth * channels)
    for (let column = 0; column < passWidth; column++) {
      const values = spec.sample(pass.x0 + column * pass.dx, pass.y0 + rowIndex * pass.dy)
      for (let channel = 0; channel < channels; channel++) row[column * channels + channel] = (values[channel] ?? 0) & 0xff
    }
    return row
  }
  if (bitDepth === 16) {
    const row = Buffer.alloc(passWidth * channels * 2)
    for (let column = 0; column < passWidth; column++) {
      const values = spec.sample(pass.x0 + column * pass.dx, pass.y0 + rowIndex * pass.dy)
      for (let channel = 0; channel < channels; channel++) row.writeUInt16BE((values[channel] ?? 0) & 0xffff, (column * channels + channel) * 2)
    }
    return row
  }
  const row = Buffer.alloc(Math.ceil(passWidth * bitDepth / 8))
  for (let column = 0; column < passWidth; column++) {
    const value = (spec.sample(pass.x0 + column * pass.dx, pass.y0 + rowIndex * pass.dy)[0] ?? 0) & ((1 << bitDepth) - 1)
    const bitOffset = column * bitDepth
    row[bitOffset >> 3] |= value << (8 - bitDepth - (bitOffset & 7))
  }
  return row
}

// 正向 filter（解码器的逆运算）：存储字节 = 原始字节 - 预测值
function filterRow(raw: Buffer, filterType: number, previous: Buffer | null, bpp: number): Buffer {
  if (filterType === 0) return raw
  const output = Buffer.alloc(raw.length)
  for (let index = 0; index < raw.length; index++) {
    const left = index >= bpp ? raw[index - bpp] : 0
    const up = previous ? previous[index] : 0
    const upLeft = previous && index >= bpp ? previous[index - bpp] : 0
    let predictor = 0
    if (filterType === 1) predictor = left
    else if (filterType === 2) predictor = up
    else if (filterType === 3) predictor = (left + up) >> 1
    else if (filterType === 4) predictor = paethPredictor(left, up, upLeft)
    output[index] = (raw[index] - predictor) & 0xff
  }
  return output
}

function encodePng(spec: PngSpec): Buffer {
  const bitDepth = spec.bitDepth ?? 8
  const channels = PNG_CHANNELS[spec.colorType]
  const bpp = Math.max(1, Math.ceil(channels * bitDepth / 8))
  const passes = spec.interlace === 1 ? ADAM7_PASSES : [{ x0: 0, y0: 0, dx: 1, dy: 1 }]
  const parts: Buffer[] = []
  let passIndex = 0
  for (const pass of passes) {
    const passWidth = passSize(spec.width, pass.x0, pass.dx)
    const passHeight = passSize(spec.height, pass.y0, pass.dy)
    if (passWidth === 0 || passHeight === 0) continue
    let previous: Buffer | null = null
    for (let rowIndex = 0; rowIndex < passHeight; rowIndex++) {
      const raw = packRow(spec, pass, passWidth, rowIndex)
      const filterType = spec.filters ? spec.filters(rowIndex, passIndex) : 0
      parts.push(Buffer.from([filterType]), filterRow(raw, filterType, previous, bpp))
      previous = raw
    }
    passIndex += 1
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(spec.width, 0)
  ihdr.writeUInt32BE(spec.height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = spec.colorType
  ihdr[12] = spec.interlace ?? 0
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)]
  if (spec.palette) chunks.push(pngChunk('PLTE', spec.palette))
  if (spec.trns) chunks.push(pngChunk('tRNS', spec.trns))
  chunks.push(pngChunk('IDAT', zlib.deflateSync(Buffer.concat(parts))))
  chunks.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

function rgbaAt(pixels: DecodedPixels, x: number, y: number): number[] {
  const base = (y * pixels.width + x) * 4
  return Array.from(pixels.rgba.subarray(base, base + 4))
}

// 直接构造灰度像素（不经过 PNG 解码），用于精确验证 dhash 位序
function pixelsFromGray(width: number, height: number, value: (x: number, y: number) => number): DecodedPixels {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gray = value(x, y)
      const base = (y * width + x) * 4
      rgba[base] = gray
      rgba[base + 1] = gray
      rgba[base + 2] = gray
      rgba[base + 3] = 255
    }
  }
  return { width, height, rgba }
}

// ---------- decodeImagePixels ----------

describe('decodeImagePixels', () => {
  it('decodes 8-bit RGB PNGs back to RGBA pixels', () => {
    const png = encodePng({ width: 3, height: 2, colorType: 2, sample: (x, y) => [x * 80, y * 120, 40] })
    const decoded = decodeImagePixels(png)
    expect(decoded).not.toBeNull()
    expect(decoded!.width).toBe(3)
    expect(decoded!.height).toBe(2)
    expect(decoded!.rgba.length).toBe(3 * 2 * 4)
    expect(rgbaAt(decoded!, 0, 0)).toEqual([0, 0, 40, 255])
    expect(rgbaAt(decoded!, 2, 0)).toEqual([160, 0, 40, 255])
    expect(rgbaAt(decoded!, 1, 1)).toEqual([80, 120, 40, 255])
  })

  it('decodes 8-bit RGBA PNGs with alpha preserved', () => {
    const png = encodePng({ width: 2, height: 1, colorType: 6, sample: x => [200, 100, 50, x === 0 ? 0 : 128] })
    const decoded = decodeImagePixels(png)
    expect(decoded).not.toBeNull()
    expect(rgbaAt(decoded!, 0, 0)).toEqual([200, 100, 50, 0])
    expect(rgbaAt(decoded!, 1, 0)).toEqual([200, 100, 50, 128])
  })

  it('decodes 8-bit grayscale and 4-bit grayscale (linearly stretched)', () => {
    const gray8 = decodeImagePixels(encodePng({ width: 2, height: 1, colorType: 0, sample: x => [x === 0 ? 10 : 240] }))
    expect(gray8).not.toBeNull()
    expect(rgbaAt(gray8!, 0, 0)).toEqual([10, 10, 10, 255])
    expect(rgbaAt(gray8!, 1, 0)).toEqual([240, 240, 240, 255])

    // 4 位灰度：16 个像素覆盖全部样本值，期望 round(v * 255 / 15) = v * 17
    const gray4 = decodeImagePixels(encodePng({ width: 16, height: 1, colorType: 0, bitDepth: 4, sample: x => [x] }))
    expect(gray4).not.toBeNull()
    for (let x = 0; x < 16; x++) expect(rgbaAt(gray4!, x, 0)).toEqual([x * 17, x * 17, x * 17, 255])
  })

  it('decodes 16-bit grayscale using the high byte', () => {
    const png = encodePng({ width: 2, height: 1, colorType: 0, bitDepth: 16, sample: x => [x === 0 ? 0x12ab : 0x34cd] })
    const decoded = decodeImagePixels(png)
    expect(decoded).not.toBeNull()
    expect(rgbaAt(decoded!, 0, 0)).toEqual([0x12, 0x12, 0x12, 255])
    expect(rgbaAt(decoded!, 1, 0)).toEqual([0x34, 0x34, 0x34, 255])
  })

  it('decodes palette PNGs and applies tRNS alpha', () => {
    const png = encodePng({
      width: 4,
      height: 1,
      colorType: 3,
      palette: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]),
      trns: Buffer.from([255, 128, 64, 0]),
      sample: x => [x],
    })
    const decoded = decodeImagePixels(png)
    expect(decoded).not.toBeNull()
    expect(rgbaAt(decoded!, 0, 0)).toEqual([255, 0, 0, 255])
    expect(rgbaAt(decoded!, 1, 0)).toEqual([0, 255, 0, 128])
    expect(rgbaAt(decoded!, 2, 0)).toEqual([0, 0, 255, 64])
    expect(rgbaAt(decoded!, 3, 0)).toEqual([10, 20, 30, 0])
  })

  it('rebuilds all five scanline filter types', () => {
    const sample = (x: number, y: number): number[] => [x * 30 + y * 7, 255 - x * 20, (x * y * 3) & 0xff]
    const png = encodePng({ width: 6, height: 5, colorType: 2, sample, filters: row => row % 5 }) // 0,1,2,3,4
    const decoded = decodeImagePixels(png)
    expect(decoded).not.toBeNull()
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) expect(rgbaAt(decoded!, x, y)).toEqual([...sample(x, y), 255])
    }
  })

  it('decodes Adam7 interlaced PNGs', () => {
    const sample = (x: number, y: number): number[] => [x * 30, y * 30, 90]
    const png = encodePng({ width: 8, height: 8, colorType: 2, interlace: 1, sample })
    const decoded = decodeImagePixels(png)
    expect(decoded).not.toBeNull()
    expect(decoded!.width).toBe(8)
    expect(decoded!.height).toBe(8)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(rgbaAt(decoded!, x, y)).toEqual([x * 30, y * 30, 90, 255])
    }
  })

  it('returns null for non-PNG, truncated and malformed input', () => {
    const valid = encodePng({ width: 4, height: 4, colorType: 2, sample: () => [1, 2, 3] })
    expect(decodeImagePixels(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toBeNull()
    expect(decodeImagePixels(Buffer.alloc(0))).toBeNull()
    expect(decodeImagePixels(Buffer.from('definitely not a png file'))).toBeNull()
    expect(decodeImagePixels(valid.subarray(0, 30))).toBeNull()
    expect(decodeImagePixels(valid.subarray(0, 40))).toBeNull()
    // 签名正确但 IDAT 载荷损坏（zlib/adler 校验拦截）
    const corrupted = Buffer.from(valid)
    const idatDataStart = valid.indexOf(Buffer.from('IDAT', 'ascii')) + 4
    corrupted[idatDataStart + 3] ^= 0xff
    expect(decodeImagePixels(corrupted)).toBeNull()
  })
})

// ---------- computeDhash ----------

describe('computeDhash', () => {
  it('is deterministic and 16 lowercase hex chars', () => {
    const pixels = pixelsFromGray(9, 8, x => x * 28)
    const first = computeDhash(pixels)
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(computeDhash(pixels)).toBe(first)
    expect(hammingDistance(first, first)).toBe(0)
  })

  it('produces the expected bit pattern for a strictly increasing gradient', () => {
    // 每行左<右：所有 bit 为 0
    expect(computeDhash(pixelsFromGray(9, 8, x => x * 28))).toBe('0000000000000000')
    // 镜像（严格递减）：所有 bit 为 1，与渐变距离 64
    const gradient = computeDhash(pixelsFromGray(9, 8, x => x * 28))
    const mirror = computeDhash(pixelsFromGray(9, 8, x => (8 - x) * 28))
    expect(mirror).toBe('ffffffffffffffff')
    expect(hammingDistance(gradient, mirror)).toBe(64)
  })

  it('differs strongly between a solid-color image and a striped pattern', () => {
    const solid = computeDhash(pixelsFromGray(9, 8, () => 0))
    // 奇偶列黑白交替：每行比较位为 1010 1010 = 0xaa（行优先打包，8 行即 8 个 0xaa 字节）
    const stripes = computeDhash(pixelsFromGray(9, 8, x => (x % 2 === 0 ? 255 : 0)))
    expect(solid).toBe('0000000000000000')
    expect(stripes).toBe('aaaaaaaaaaaaaaaa')
    expect(hammingDistance(solid, stripes)).toBe(32)
  })

  it('resizes by area average: a 2:1 half-white/half-black image averages the mixed column', () => {
    // 18 宽缩到 9 列时列 4 = (255+0)/2 = 127.5，每行比较位 00011000 = 0x18
    const pixels = pixelsFromGray(18, 16, x => (x < 9 ? 255 : 0))
    expect(computeDhash(pixels)).toBe('1818181818181818')
  })
})

// ---------- hammingDistance ----------

describe('hammingDistance', () => {
  it('returns 0-64 and matches bit counts', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0)
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1)
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64)
  })

  it('is case-insensitive and accepts longer hashes', () => {
    expect(hammingDistance('ABCDEF0123456789', 'abcdef0123456789')).toBe(0)
    // 6 个 nibble 两两互补（0^f = 4 位），共 24 位
    expect(hammingDistance('0f0f0f', 'f0f0f0')).toBe(24)
  })

  it('throws on length mismatch, empty and non-hex input', () => {
    expect(() => hammingDistance('0000000000000000', '000000000000000')).toThrow()
    expect(() => hammingDistance('', '')).toThrow()
    expect(() => hammingDistance('0000000000000000', '')).toThrow()
    expect(() => hammingDistance('zzzzzzzzzzzzzzzz', '0000000000000000')).toThrow()
  })
})

// ---------- computeColorHistogram ----------

describe('computeColorHistogram', () => {
  it('normalizes a solid red image into bucket 48 (r=3,g=0,b=0)', () => {
    const pixels: DecodedPixels = { width: 2, height: 2, rgba: Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]) }
    const histogram = JSON.parse(computeColorHistogram(pixels)) as number[]
    expect(histogram).toHaveLength(64)
    expect(histogram[48]).toBe(1)
    expect(histogram.reduce((sum, entry) => sum + entry, 0)).toBeCloseTo(1, 6)
    expect(histogram.every(entry => entry >= 0 && entry <= 1)).toBe(true)
  })

  it('splits counts between buckets and rounds to 4 decimals', () => {
    // 红(255,0,0) → 桶 48；白(255,255,255) → 桶 63，各占一半
    const pixels: DecodedPixels = { width: 2, height: 1, rgba: Uint8Array.from([255, 0, 0, 255, 255, 255, 255, 255]) }
    const histogram = JSON.parse(computeColorHistogram(pixels)) as number[]
    expect(histogram[48]).toBe(0.5)
    expect(histogram[63]).toBe(0.5)
  })
})

// ---------- histogramDistance ----------

describe('histogramDistance', () => {
  it('is 0 for identical histograms and sums the L1 difference otherwise', () => {
    expect(histogramDistance('[1,0,0,0]', '[1,0,0,0]')).toBe(0)
    expect(histogramDistance('[1,0,0,0]', '[0,1,0,0]')).toBe(2)
    expect(histogramDistance('[0.5,0.5]', '[0.25,0.25]')).toBeCloseTo(0.5, 6)
  })

  it('throws on invalid JSON, empty arrays and bucket-count mismatch', () => {
    expect(() => histogramDistance('not json', '[1]')).toThrow()
    expect(() => histogramDistance('[]', '[1]')).toThrow()
    expect(() => histogramDistance('[1,2]', '[1,2,3]')).toThrow()
    expect(() => histogramDistance('[1,"a"]', '[1,2]')).toThrow()
  })
})

// ---------- combinedDistance ----------

describe('combinedDistance', () => {
  it('is 0 for identical records and stays within 0-1', () => {
    const record = { dhash: '0f0f0f0f0f0f0f0f', colorHistogram: '[1,0,0,0]' }
    expect(combinedDistance(record, record)).toBe(0)
    const worst = combinedDistance({ dhash: '0000000000000000', colorHistogram: '[1,0]' }, { dhash: 'ffffffffffffffff', colorHistogram: '[0,1]' })
    expect(worst).toBeCloseTo(1, 6)
    expect(worst).toBeGreaterThanOrEqual(0)
    expect(worst).toBeLessThanOrEqual(1)
  })

  it('weights dhash 0.7 and histogram 0.3 after normalizing each', () => {
    // 32/64 位不同 → 0.5；直方图 L1 = 2 → 1.0；合计 0.7*0.5 + 0.3*1.0
    const distance = combinedDistance(
      { dhash: '0000000000000000', colorHistogram: '[1,0,0,0]' },
      { dhash: 'ffffffff00000000', colorHistogram: '[0,1,0,0]' },
    )
    expect(distance).toBeCloseTo(0.65, 6)
    // 直方图相同：只剩 dhash 分量
    const hashOnly = combinedDistance(
      { dhash: '0000000000000000', colorHistogram: '[1,0]' },
      { dhash: 'ffffffff00000000', colorHistogram: '[1,0]' },
    )
    expect(hashOnly).toBeCloseTo(0.35, 6)
  })

  it('falls back to the pure normalized dhash distance when either histogram is missing', () => {
    // 32/64 位不同 → 0.5；任一侧直方图缺失时不再加权，直接返回该值
    const distance = combinedDistance(
      { dhash: '0000000000000000', colorHistogram: '' },
      { dhash: 'ffffffff00000000', colorHistogram: '[0,1]' },
    )
    expect(distance).toBeCloseTo(0.5, 6)
  })
})

// ---------- computePerceptualHash ----------

describe('computePerceptualHash', () => {
  it('computes dhash, histogram and dimensions from a PNG buffer', () => {
    const png = encodePng({ width: 12, height: 12, colorType: 2, sample: (x, y) => [x * 20, y * 20, 64] })
    const result = computePerceptualHash(png)
    expect(result).not.toBeNull()
    expect(result!.dhash).toMatch(/^[0-9a-f]{16}$/)
    expect(result!.width).toBe(12)
    expect(result!.height).toBe(12)
    const histogram = JSON.parse(result!.colorHistogram) as number[]
    expect(histogram).toHaveLength(64)
    // 每桶 4 位小数取整，64 桶累计误差上限 64 * 5e-5
    expect(histogram.reduce((sum, entry) => sum + entry, 0)).toBeCloseTo(1, 3)
  })

  it('is stable across identical inputs and close for a near-identical image', () => {
    const base = encodePng({ width: 12, height: 12, colorType: 2, sample: (x, y) => [x * 20, y * 20, 64] })
    const shifted = encodePng({ width: 12, height: 12, colorType: 2, sample: (x, y) => [x * 20 + 4, y * 20 + 4, 64] })
    const first = computePerceptualHash(base)!
    const second = computePerceptualHash(base)!
    const near = computePerceptualHash(shifted)!
    expect(first.dhash).toBe(second.dhash)
    expect(hammingDistance(first.dhash, near.dhash)).toBeLessThanOrEqual(8)
  })

  it('returns null for JPEG, empty and garbage buffers', () => {
    expect(computePerceptualHash(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]))).toBeNull()
    expect(computePerceptualHash(Buffer.alloc(0))).toBeNull()
    expect(computePerceptualHash(Buffer.from('not an image'))).toBeNull()
  })
})
