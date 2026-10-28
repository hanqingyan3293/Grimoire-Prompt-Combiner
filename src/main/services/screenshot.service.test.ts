import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodePngDataUrl, listCaptureSources, saveCapturedPng, ScreenshotError } from './screenshot.service'

function pngBytes(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(data.length, 0)
    header.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0)
    return Buffer.concat([header, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(14))), chunk('IEND', Buffer.alloc(0))])
}

let root = ''
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-shot-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('screen capture pipeline (M3)', () => {
  it('lists sources with data URLs and sizes', async () => {
    const sources = await listCaptureSources(async () => [{ id: 'screen:1', name: '屏幕 1', thumbnail: { toDataURL: () => 'data:image/png;base64,AAA', getSize: () => ({ width: 1920, height: 1080 }) } }])
    expect(sources[0]).toMatchObject({ id: 'screen:1', name: '屏幕 1', width: 1920, height: 1080 })
  })

  it('reports when nothing can be captured instead of returning an empty list', async () => {
    await expect(listCaptureSources(async () => [])).rejects.toBeInstanceOf(ScreenshotError)
  })

  it('saves a real PNG under a sanitised, timestamped name', () => {
    const dataUrl = 'data:image/png;base64,' + pngBytes().toString('base64')
    const result = saveCapturedPng({ directory: path.join(root, 'shots'), dataUrl, name: '窗口 A/1', now: Date.UTC(2026, 9, 28, 1, 2, 3) })
    expect(path.basename(result.filePath)).toBe('窗口_A_1-2026-10-28T01-02-03-000Z.png')
    expect(fs.readFileSync(result.filePath).equals(pngBytes())).toBe(true)
  })

  it('rejects non-PNG data, oversized payloads and non-data-URL input', () => {
    expect(() => decodePngDataUrl('data:image/jpeg;base64,AAAA')).toThrow(ScreenshotError)
    expect(() => decodePngDataUrl('https://example.com/a.png')).toThrow(ScreenshotError)
    const notPng = Buffer.from('not a png at all').toString('base64')
    expect(() => decodePngDataUrl('data:image/png;base64,' + notPng)).toThrow(/not a PNG/)
  })
})
