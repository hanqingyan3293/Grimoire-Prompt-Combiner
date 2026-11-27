import type { ComfySourceLogLevel } from './comfy-source-bridge'

/**
 * Replacement for the source's @logger module. The source calls
 * loggerService.withContext(...) at module load; the returned methods resolve
 * the main-process bridge lazily so importing the bundle never writes logs
 * before Grimoire's redacting logger is available.
 */
type LeveledLogger = Record<ComfySourceLogLevel, (message: string, ...rest: unknown[]) => void>

function emit(level: ComfySourceLogLevel, context: string, args: unknown[]): void {
  const bridge = globalThis.__grimoireComfySourceBridge
  if (!bridge) return
  const text = args
    .map(value => typeof value === 'string' ? value : safeJson(value))
    .join(' ')
  bridge.log(level, context, text)
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}

export const loggerService = {
  withContext(context: string): LeveledLogger {
    return {
      warn: (message: string, ...rest: unknown[]) => emit('warn', context, [message, ...rest]),
      info: (message: string, ...rest: unknown[]) => emit('info', context, [message, ...rest]),
      debug: (message: string, ...rest: unknown[]) => emit('debug', context, [message, ...rest]),
      error: (message: string, ...rest: unknown[]) => emit('error', context, [message, ...rest]),
    }
  },
}
