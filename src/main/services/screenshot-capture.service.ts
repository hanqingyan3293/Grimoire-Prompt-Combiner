import { app, clipboard, desktopCapturer, nativeImage } from 'electron'
import path from 'node:path'

import { listCaptureSources, saveCapturedPng } from './screenshot.service'

// Real screen capture (M3).
//
// Wraps the OS call and keeps the validation in `screenshot.service` (signature check, size cap, name
// sanitising) so the same rules apply to a shortcut capture and to one requested from the UI.
export interface CaptureOutcome { readonly filePath: string; readonly bytes: number; readonly width: number; readonly height: number; readonly sourceName: string }

export function screenshotDirectory(): string {
  return path.join(app.getPath('userData'), 'media', 'screenshots')
}

export async function capturePrimaryScreen(options?: { directory?: string; copyToClipboard?: boolean }): Promise<CaptureOutcome> {
  const sources = await listCaptureSources(async () => {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    return list.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail }))
  })
  const source = sources[0]
  const saved = saveCapturedPng({ directory: options?.directory ?? screenshotDirectory(), dataUrl: source.thumbnailDataUrl, name: source.name })
  if (options?.copyToClipboard !== false) {
    const image = nativeImage.createFromPath(saved.filePath)
    if (!image.isEmpty()) clipboard.writeImage(image)
  }
  return { filePath: saved.filePath, bytes: saved.bytes, width: source.width, height: source.height, sourceName: source.name }
}
