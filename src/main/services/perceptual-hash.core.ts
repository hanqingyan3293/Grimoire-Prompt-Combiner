// 魔导书 Grimoire — 感知哈希纯逻辑（零依赖）
// PNG 解码走 node:zlib inflate + 手写 filter 重建（块读取风格与 media-metadata.core 一致），
// 支持灰度/RGB/调色板/灰度+Alpha/RGBA、位深 1/2/4/8/16 与 Adam7 交错。
// 限制：JPEG 的完整解码需要 DCT + 霍夫曼熵解码，代价过大且不在本模块范围，decodeImagePixels
// 对 JPEG 显式返回 null —— 感知哈希当前只覆盖 PNG（SD 工具链产物几乎都是 PNG）。
// 需要 JPEG 覆盖时走 CLIP sidecar（image_embeddings）通道，或在调用方用 ffmpeg 预转 PNG。

import zlib from 'node:zlib'

export interface DecodedPixels {
  width: number
  height: number
  rgba: Uint8Array
}

export interface PerceptualHashValues {
  dhash: string
  colorHistogram: string
  width: number
  height: number
}

export interface PerceptualHashRecord {
  dhash: string
  colorHistogram: string
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// IDAT 解压上限 128MB（4096×4096 的 RGBA/16 位图仍在界内）
const MAX_PNG_INFLATE_BYTES = 128 * 1024 * 1024
// 解码后 RGBA 的像素上限（16M 像素 ≈ 4096×4096 → RGBA 67MB），防止小体积压缩炸弹撑爆内存
const MAX_DECODED_PIXELS = 16 * 1024 * 1024

const DHASH_WIDTH = 9
const DHASH_HEIGHT = 8
// 每行 8 次相邻比较 × 8 行 = 64 位 = 16 个十六进制字符
const DHASH_HEX_LENGTH = DHASH_HEIGHT * (DHASH_WIDTH - 1) / 4
const HISTOGRAM_BINS = 4
const HISTOGRAM_BUCKETS = HISTOGRAM_BINS ** 3
const DHASH_WEIGHT = 0.7
const HISTOGRAM_WEIGHT = 0.3

// ---------- PNG 结构与解码 ----------

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const PNG_BIT_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

interface PngPass { x0: number; y0: number; dx: number; dy: number }

const SINGLE_PASS: PngPass[] = [{ x0: 0, y0: 0, dx: 1, dy: 1 }]
const ADAM7_PASSES: PngPass[] = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
]

interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
  palette: Uint8Array | null
  paletteAlpha: Uint8Array | null
}

interface PngPassGeometry { pass: PngPass; passWidth: number; passHeight: number; rowBytes: number }

// 不校验 CRC（与 media-metadata.core 的块读取一致）；块损坏时按整体解码失败处理
function readPngStructure(buffer: Buffer): { header: PngHeader; idat: Buffer } | null {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  let header: PngHeader | null = null
  let palette: Uint8Array | null = null
  let paletteAlpha: Uint8Array | null = null
  const idatParts: Buffer[] = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) break
    if (type === 'IHDR') {
      if (length !== 13) return null
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        interlace: buffer[dataStart + 12],
        palette: null,
        paletteAlpha: null,
      }
    } else if (type === 'PLTE') {
      palette = new Uint8Array(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'tRNS') {
      // 只取调色板 Alpha（灰度/真彩 tRNS 的透明色本模块忽略，哈希不受影响）
      paletteAlpha = new Uint8Array(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IDAT') {
      idatParts.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }
  if (!header || idatParts.length === 0) return null
  if (header.interlace !== 0 && header.interlace !== 1) return null
  header.palette = palette
  header.paletteAlpha = paletteAlpha
  return { header, idat: Buffer.concat(idatParts) }
}

function passSize(length: number, start: number, step: number): number {
  return length > start ? Math.ceil((length - start) / step) : 0
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

// 就地重建一行（filter 1-4 依赖本行左侧与上一行已重建的字节）；未知 filter 视为损坏
function unfilterRow(row: Uint8Array, filterType: number, previous: Uint8Array | null, bpp: number): boolean {
  const length = row.length
  switch (filterType) {
    case 0:
      return true
    case 1:
      for (let index = bpp; index < length; index++) row[index] = (row[index] + row[index - bpp]) & 0xff
      return true
    case 2:
      if (previous) for (let index = 0; index < length; index++) row[index] = (row[index] + previous[index]) & 0xff
      return true
    case 3:
      for (let index = 0; index < length; index++) {
        const left = index >= bpp ? row[index - bpp] : 0
        const up = previous ? previous[index] : 0
        row[index] = (row[index] + ((left + up) >> 1)) & 0xff
      }
      return true
    case 4:
      for (let index = 0; index < length; index++) {
        const left = index >= bpp ? row[index - bpp] : 0
        const up = previous ? previous[index] : 0
        const upLeft = previous && index >= bpp ? previous[index - bpp] : 0
        row[index] = (row[index] + paeth(left, up, upLeft)) & 0xff
      }
      return true
    default:
      return false
  }
}

// 把一个 pass 的已重建行写入 RGBA 画布（非交错时即整幅图；交错时按 Adam7 步长落点）
function writeRowToRgba(
  row: Uint8Array,
  pass: PngPass,
  passWidth: number,
  rowIndex: number,
  header: PngHeader,
  channels: number,
  rgba: Uint8Array,
): void {
  const { bitDepth, colorType, palette, paletteAlpha, width } = header
  const y = pass.y0 + rowIndex * pass.dy
  for (let column = 0; column < passWidth; column++) {
    const x = pass.x0 + column * pass.dx
    const target = (y * width + x) * 4
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 255
    if (bitDepth === 8) {
      const base = column * channels
      if (colorType === 3) {
        const index = row[base]
        if (palette && index * 3 + 2 < palette.length) { red = palette[index * 3]; green = palette[index * 3 + 1]; blue = palette[index * 3 + 2] }
        if (paletteAlpha && index < paletteAlpha.length) alpha = paletteAlpha[index]
      } else if (colorType === 0 || colorType === 4) {
        red = green = blue = row[base]
        if (colorType === 4) alpha = row[base + 1]
      } else if (colorType === 2) {
        red = row[base]; green = row[base + 1]; blue = row[base + 2]
      } else {
        red = row[base]; green = row[base + 1]; blue = row[base + 2]; alpha = row[base + 3]
      }
    } else if (bitDepth === 16) {
      // 16 位只取高字节（8 位精度足够做感知哈希）
      const base = column * channels * 2
      if (colorType === 0 || colorType === 4) {
        red = green = blue = row[base]
        if (colorType === 4) alpha = row[base + 2]
      } else if (colorType === 2) {
        red = row[base]; green = row[base + 2]; blue = row[base + 4]
      } else {
        red = row[base]; green = row[base + 2]; blue = row[base + 4]; alpha = row[base + 6]
      }
    } else {
      // 1/2/4 位：仅灰度与调色板；灰度按最大值线性拉伸到 0-255
      const bitOffset = column * bitDepth
      const sample = (row[bitOffset >> 3] >> (8 - bitDepth - (bitOffset & 7))) & ((1 << bitDepth) - 1)
      if (colorType === 3) {
        if (palette && sample * 3 + 2 < palette.length) { red = palette[sample * 3]; green = palette[sample * 3 + 1]; blue = palette[sample * 3 + 2] }
        if (paletteAlpha && sample < paletteAlpha.length) alpha = paletteAlpha[sample]
      } else {
        red = green = blue = Math.round(sample * 255 / ((1 << bitDepth) - 1))
      }
    }
    rgba[target] = red
    rgba[target + 1] = green
    rgba[target + 2] = blue
    rgba[target + 3] = alpha
  }
}

function decodePng(buffer: Buffer): DecodedPixels | null {
  const structure = readPngStructure(buffer)
  if (!structure) return null
  const { header, idat } = structure
  const { width, height, bitDepth, colorType } = header
  const channels = PNG_CHANNELS[colorType]
  if (!channels || !PNG_BIT_DEPTHS[colorType].includes(bitDepth)) return null
  if (width <= 0 || height <= 0 || width * height > MAX_DECODED_PIXELS) return null
  if (colorType === 3 && (!header.palette || header.palette.length < 3)) return null
  // 灰度/真彩的每像素位数只由位深与通道数决定，可据此提前算出行字节
  const bitsPerPixel = channels * bitDepth
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const passes = header.interlace === 1 ? ADAM7_PASSES : SINGLE_PASS
  const geometries: PngPassGeometry[] = []
  let expectedBytes = 0
  for (const pass of passes) {
    const passWidth = passSize(width, pass.x0, pass.dx)
    const passHeight = passSize(height, pass.y0, pass.dy)
    if (passWidth === 0 || passHeight === 0) continue
    const rowBytes = Math.ceil(passWidth * bitsPerPixel / 8)
    expectedBytes += passHeight * (rowBytes + 1)
    geometries.push({ pass, passWidth, passHeight, rowBytes })
  }
  if (expectedBytes === 0 || expectedBytes > MAX_PNG_INFLATE_BYTES) return null
  let data: Uint8Array
  try {
    data = zlib.inflateSync(idat, { maxOutputLength: MAX_PNG_INFLATE_BYTES })
  } catch {
    return null
  }
  if (data.length < expectedBytes) return null
  const rgba = new Uint8Array(width * height * 4)
  let offset = 0
  for (const geometry of geometries) {
    let previous: Uint8Array | null = null
    for (let rowIndex = 0; rowIndex < geometry.passHeight; rowIndex++) {
      const filterType = data[offset]
      const row = data.subarray(offset + 1, offset + 1 + geometry.rowBytes)
      if (!unfilterRow(row, filterType, previous, bpp)) return null
      previous = row
      writeRowToRgba(row, geometry.pass, geometry.passWidth, rowIndex, header, channels, rgba)
      offset += geometry.rowBytes + 1
    }
  }
  return { width, height, rgba }
}

/**
 * 解码 PNG 到 RGBA 8 位像素；JPEG 与其它格式返回 null（见文件头注释的 JPEG 限制）。
 * 任何解析/解压/过滤错误都归为 null，调用方按“解码失败”处理。
 */
export function decodeImagePixels(buffer: Buffer): DecodedPixels | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  try {
    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return decodePng(buffer)
    return null
  } catch {
    return null
  }
}

// ---------- 灰度缩放与 dhash ----------

// BT.601 亮度（与 PIL convert('L') 同系数）；Alpha 不参与，与主流感知哈希一致
function toLuma(pixels: DecodedPixels): Float32Array {
  const { rgba } = pixels
  const luma = new Float32Array(pixels.width * pixels.height)
  for (let index = 0; index < luma.length; index++) {
    luma[index] = 0.299 * rgba[index * 4] + 0.587 * rgba[index * 4 + 1] + 0.114 * rgba[index * 4 + 2]
  }
  return luma
}

// 面积平均缩放（缩小取源区域均值，放大取最近单元），比最近邻对噪点/重压缩更稳
function resizeLuma(luma: Float32Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): Float32Array {
  const scaled = new Float32Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y++) {
    const top = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight))
    const bottom = Math.max(top + 1, Math.min(sourceHeight, Math.floor((y + 1) * sourceHeight / targetHeight)))
    for (let x = 0; x < targetWidth; x++) {
      const left = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / targetWidth))
      const right = Math.max(left + 1, Math.min(sourceWidth, Math.floor((x + 1) * sourceWidth / targetWidth)))
      let sum = 0
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) sum += luma[sy * sourceWidth + sx]
      }
      scaled[y * targetWidth + x] = sum / ((right - left) * (bottom - top))
    }
  }
  return scaled
}

/**
 * 9×8 灰度差分哈希（dhash）：缩放到 9×8 灰度后每行比较相邻像素，左 > 右记 1。
 * 64 位按行优先 MSB-first 打包，返回 16 个十六进制字符。
 */
export function computeDhash(pixels: DecodedPixels): string {
  if (pixels.width <= 0 || pixels.height <= 0) return '0'.repeat(DHASH_HEX_LENGTH)
  const scaled = resizeLuma(toLuma(pixels), pixels.width, pixels.height, DHASH_WIDTH, DHASH_HEIGHT)
  const bytes = new Uint8Array(8)
  let bit = 0
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      if (scaled[y * DHASH_WIDTH + x] > scaled[y * DHASH_WIDTH + x + 1]) bytes[bit >> 3] |= 0x80 >> (bit & 7)
      bit += 1
    }
  }
  let hash = ''
  for (const byte of bytes) hash += byte.toString(16).padStart(2, '0')
  return hash
}

/**
 * 4×4×4=64 桶 RGB 直方图：每通道 8 位按高位 2 bit 分箱，计数按总像素数归一化，
 * 返回 64 个 0-1 数值（保留 4 位小数）的 JSON 数组字符串。Alpha 不参与。
 */
export function computeColorHistogram(pixels: DecodedPixels): string {
  const buckets = new Float64Array(HISTOGRAM_BUCKETS)
  const total = pixels.width * pixels.height
  if (total > 0) {
    const { rgba } = pixels
    for (let index = 0; index < total; index++) {
      const red = rgba[index * 4] >> 6
      const green = rgba[index * 4 + 1] >> 6
      const blue = rgba[index * 4 + 2] >> 6
      buckets[red * 16 + green * 4 + blue] += 1
    }
  }
  const output: number[] = []
  for (let index = 0; index < HISTOGRAM_BUCKETS; index++) output.push(Number((buckets[index] / (total || 1)).toFixed(4)))
  return JSON.stringify(output)
}

// ---------- 距离度量 ----------

const NIBBLE_POPCOUNT = (() => {
  const table = new Uint8Array(16)
  for (let value = 0; value < 16; value++) table[value] = (value & 1) + ((value >> 1) & 1) + ((value >> 2) & 1) + ((value >> 3) & 1)
  return table
})()

const HEX_PATTERN = /^[0-9a-f]+$/i

/**
 * 两个等长十六进制哈希（dhash 为 16 字符 / 64 位）的汉明距离（16 字符时 0-64）。
 * 长度不一致、为空或含非十六进制字符时抛错（损坏的 DB 行由调用方先行过滤）。
 */
export function hammingDistance(a: string, b: string): number {
  const left = String(a)
  const right = String(b)
  if (left.length === 0 || left.length !== right.length) {
    throw new Error(`汉明距离要求两个等长非空哈希（当前 ${left.length} vs ${right.length} 位）`)
  }
  if (!HEX_PATTERN.test(left) || !HEX_PATTERN.test(right)) throw new Error('哈希包含非十六进制字符')
  let distance = 0
  for (let index = 0; index < left.length; index++) {
    distance += NIBBLE_POPCOUNT[parseInt(left[index], 16) ^ parseInt(right[index], 16)]
  }
  return distance
}

function parseHistogram(value: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    for (const entry of parsed) {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) return null
    }
    return parsed as number[]
  } catch {
    return null
  }
}

/** 直方图 L1 距离（桶数一致时范围 0-2）；JSON 非法或桶数不一致抛错 */
export function histogramDistance(a: string, b: string): number {
  const left = parseHistogram(String(a))
  const right = parseHistogram(String(b))
  if (!left || !right) throw new Error('直方图必须是合法的 JSON 数值数组')
  if (left.length !== right.length) throw new Error(`直方图桶数不一致：${left.length} vs ${right.length}`)
  let distance = 0
  for (let index = 0; index < left.length; index++) distance += Math.abs(left[index] - right[index])
  return distance
}

/**
 * dhash 与颜色直方图的加权综合距离（0-1）：dhash 权重 0.7、直方图 0.3，
 * 各自先归一化（汉明距离 / 位数，L1 距离 / 2）。任一侧缺少直方图时退化为纯 dhash 距离。
 */
export function combinedDistance(a: PerceptualHashRecord, b: PerceptualHashRecord): number {
  const hashDistance = hammingDistance(a.dhash, b.dhash) / Math.max(1, a.dhash.length * 4)
  const histogramA = String(a.colorHistogram || '')
  const histogramB = String(b.colorHistogram || '')
  if (!histogramA || !histogramB) return hashDistance
  const histogramScore = Math.min(1, histogramDistance(histogramA, histogramB) / 2)
  return DHASH_WEIGHT * hashDistance + HISTOGRAM_WEIGHT * histogramScore
}

/** 一步计算 PNG 的 dhash、颜色直方图与尺寸；解码失败返回 null */
export function computePerceptualHash(buffer: Buffer): PerceptualHashValues | null {
  try {
    const pixels = decodeImagePixels(buffer)
    if (!pixels) return null
    return {
      dhash: computeDhash(pixels),
      colorHistogram: computeColorHistogram(pixels),
      width: pixels.width,
      height: pixels.height,
    }
  } catch {
    return null
  }
}
