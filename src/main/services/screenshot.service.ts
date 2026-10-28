import fs from 'node:fs'
import path from 'node:path'

// Screen capture (M3).
//
// The capturer and the clock are injected so the pipeline can be tested without a display: the
// interesting behaviour is validation (what we accept, where it lands, how big it may be), not the
// OS call itself.
export interface CaptureSource { readonly id: string; readonly name: string; readonly thumbnailDataUrl: string; readonly width: number; readonly height: number }

export type CaptureProvider = () => Promise<Array<{ id: string; name: string; thumbnail: { toDataURL: () => string; getSize: () => { width: number; height: number } } }>>

export class ScreenshotError extends Error {
  constructor(readonly code: 'BAD_PAYLOAD' | 'TOO_LARGE' | 'NO_SOURCES' | 'WRITE_FAILED', message: string) {
    super(message)
    this.name = 'ScreenshotError'
  }
}

const MAX_PNG_BYTES = 40 * 1024 * 1024
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

export async function listCaptureSources(provider: CaptureProvider): Promise<CaptureSource[]> {
  const sources = await provider()
  if (!sources.length) throw new ScreenshotError('NO_SOURCES', 'no screen or window could be captured')
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    width: source.thumbnail.getSize().width,
    height: source.thumbnail.getSize().height,
  }))
}

export function decodePngDataUrl(dataUrl: string): Buffer {
  const match = DATA_URL.exec(dataUrl)
  if (!match) throw new ScreenshotError('BAD_PAYLOAD', 'expected a base64 PNG data URL')
  const buffer = Buffer.from(match[1], 'base64')
  if (!buffer.length) throw new ScreenshotError('BAD_PAYLOAD', 'decoded PNG is empty')
  if (buffer.length > MAX_PNG_BYTES) throw new ScreenshotError('TOO_LARGE', 'PNG exceeds ' + MAX_PNG_BYTES + ' bytes')
  // PNG signature check: a data URL that claims PNG but is not one must not reach the media library.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(signature)) throw new ScreenshotError('BAD_PAYLOAD', 'payload is not a PNG')
  return buffer
}

export function saveCapturedPng(input: { directory: string; dataUrl: string; name?: string; now?: number }): { filePath: string; bytes: number } {
  const buffer = decodePngDataUrl(input.dataUrl)
  const stamp = new Date(input.now ?? Date.now()).toISOString().replace(/[:.]/g, '-')
  const safeName = (input.name || 'screenshot').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60) || 'screenshot'
  try {
    fs.mkdirSync(input.directory, { recursive: true })
    const filePath = path.join(input.directory, safeName + '-' + stamp + '.png')
    fs.writeFileSync(filePath, buffer)
    return { filePath, bytes: buffer.length }
  } catch (error) {
    throw new ScreenshotError('WRITE_FAILED', error instanceof Error ? error.message : String(error))
  }
}
