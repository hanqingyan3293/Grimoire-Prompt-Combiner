import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'

/** Source-shaped IpcResult; undefined from handle means the route is not owned here. */
export type CherryWindowResult =
  | { ok: true; data: boolean | null | undefined }
  | { ok: false; error: { code: string; message: string } }

// Adapted from Cherry shared/utils/window.ts and AppShell's compact-width policy.
// MainWindowService itself delegates without clamping. This caller-scoped adapter
// adds an untrusted-input floor, permitting the real shell's 520 x 600 request.
const COMPACT_MIN_WIDTH = 520
const DEFAULT_MIN_WIDTH = 960
const MIN_HEIGHT = 600
const MAX_NATIVE_DIMENSION = 2 ** 31 - 1

function failure(code: string, message: string): CherryWindowResult {
  return { ok: false, error: { code, message } }
}

function minimumSize(input: unknown): [number, number] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const { width, height } = input as Record<string, unknown>
  if (typeof width !== 'number' || typeof height !== 'number' ||
      !Number.isFinite(width) || !Number.isFinite(height) ||
      Math.abs(width) > MAX_NATIVE_DIMENSION || Math.abs(height) > MAX_NATIVE_DIMENSION) return null
  // Electron requires integer native dimensions. Round up so a requested minimum
  // is never reduced, then clamp to the source shell's smallest supported layout.
  return [Math.max(COMPACT_MIN_WIDTH, Math.ceil(width)), Math.max(MIN_HEIGHT, Math.ceil(height))]
}

/**
 * Narrow adapter for the Cherry MAIN shell hosted by Grimoire.
 *
 * Source contracts: shared/ipc/schemas/window.ts, main/ipc/handlers/window.ts,
 * MainWindowService.setMainWindowMinimumSize and WindowManager.getInitData.
 * Unlike the source singleton-directed set_minimum_size, this approved adapter
 * changes only the actual caller: never the primary Grimoire window or a focused
 * window selected globally. The coordinator owns sender trust/shell admission.
 *
 * WindowType.Main is 'main', but it is NOT an init-data field. Source Main init
 * data is a navigation/tab-attach command (shared/types/mainWindow.ts). No such
 * command is supplied when this shell opens, so get_init_data returns null, just
 * as the source init-data store does on cold start. No session/tab/subwindow is
 * invented, and this adapter does not establish a multi-window lifecycle.
 */
export function handle(
  request: string,
  input: unknown,
  sender: WebContents | null = null
): CherryWindowResult | undefined {
  if (request !== 'window.is_maximized' && request !== 'window.get_init_data' &&
      request !== 'window.main.set_minimum_size' && request !== 'window.main.reset_minimum_size') return undefined

  const size = request === 'window.main.set_minimum_size' ? minimumSize(input) : null
  if (request === 'window.main.set_minimum_size' ? !size : input !== undefined) {
    return failure('INVALID_INPUT', 'Invalid Cherry window request input')
  }

  try {
    const window = sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : null
    const caller = window && !window.isDestroyed() ? window : null
    if (request === 'window.is_maximized') {
      // Source queries return false for an unresolved caller, not a fabricated
      // successful reading from some other window.
      return { ok: true, data: caller ? caller.isMaximized() : false }
    }
    if (request === 'window.get_init_data') return { ok: true, data: null }
    if (!caller) return failure('WINDOW_NOT_FOUND', 'Cherry caller window is missing or destroyed')
    if (request === 'window.main.reset_minimum_size') {
      // Explicit SOURCE baseline, not an inferred/restored getMinimumSize snapshot:
      // Grimoire createCherryWindow starts at 960 x 640, while the approved source
      // shell resets to MIN_WINDOW_WIDTH/MIN_WINDOW_HEIGHT = 960 x 600. Upstream
      // only grows width when below that floor, preserving the actual height.
      caller.setMinimumSize(DEFAULT_MIN_WIDTH, MIN_HEIGHT)
      const [width, height] = caller.getSize() ?? [DEFAULT_MIN_WIDTH, MIN_HEIGHT]
      if (width < DEFAULT_MIN_WIDTH) caller.setSize(DEFAULT_MIN_WIDTH, height)
    } else {
      caller.setMinimumSize(size![0], size![1])
    }
    // Source output is void. The envelope distinguishes this from an unhandled route.
    return { ok: true, data: undefined }
  } catch (error) {
    return failure('WINDOW_OPERATION_FAILED', error instanceof Error ? error.message : 'Cherry window operation failed')
  }
}

export { handle as handleCherryWindowRequest }
