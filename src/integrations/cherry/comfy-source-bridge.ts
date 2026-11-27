/**
 * Runtime boundary for the read-only Cherry ComfyUI transport bundle.
 *
 * The bundle is produced from src/vendor/cherry/source (AGPL-3.0-only) by
 * scripts/build-comfy-source.mjs. Its virtual @logger and @main/i18n modules
 * must not reach into the source tree at runtime, so both read this single
 * global bridge. Grimoire main installs it once before the first cancel.
 */
export type ComfySourceLogLevel = 'warn' | 'info' | 'debug' | 'error'

export interface ComfySourceBridge {
  log(level: ComfySourceLogLevel, context: string, message: string): void
  t(key: string, params?: Record<string, string | number>): string
}

declare global {
  // eslint-disable-next-line no-var
  var __grimoireComfySourceBridge: ComfySourceBridge | undefined
}

export function setComfySourceBridge(bridge: ComfySourceBridge): void {
  globalThis.__grimoireComfySourceBridge = bridge
}

export function getComfySourceBridge(): ComfySourceBridge | undefined {
  return globalThis.__grimoireComfySourceBridge
}
