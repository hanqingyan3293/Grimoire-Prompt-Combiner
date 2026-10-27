/**
 * Compat logger shim: mirrors the source `LoggerService` surface the compat bundle
 * imports, forwarding to the console (the compat window's console messages are
 * already piped to the Grimoire diagnostic log by the main process).
 *
 * `initWindowSource` exists because the source shiki worker calls
 * `loggerService.initWindowSource('Worker')` at module scope; a shim without it
 * threw `initWindowSource is not a function` during renderer startup — a real bug
 * the visual-baseline run surfaced. It returns the service so `.withContext(...)`
 * chains keep working, and stores the source so contextual prefixes stay truthful.
 */
type LogFn = (...args: unknown[]) => void

type LoggerLike = {
  error: LogFn
  warn: LogFn
  info: LogFn
  debug: LogFn
  verbose: LogFn
  silly: LogFn
  trace: LogFn
  log: LogFn
}

let windowSource = ''

function createLogger(context?: string): LoggerLike {
  const prefix = context ? '[' + context + ']' : undefined
  const wrap = (fn: LogFn): LogFn => (...args: unknown[]) => {
    if (prefix) fn(prefix, ...args)
    else fn(...args)
  }
  return {
    error: wrap(console.error.bind(console)),
    warn: wrap(console.warn.bind(console)),
    info: wrap(console.info.bind(console)),
    debug: wrap(console.debug.bind(console)),
    verbose: wrap(console.debug.bind(console)),
    silly: wrap(console.debug.bind(console)),
    trace: wrap(console.debug.bind(console)),
    log: wrap(console.log.bind(console)),
  }
}

let errorReporter: ((error: Error, entry: Record<string, unknown>) => void) | null = null

export const loggerService = {
  /** Source contract: sets the window/worker source label; returns the service for chaining. */
  initWindowSource(window: string) {
    windowSource = String(window || '')
    return loggerService
  },
  getWindowSource(): string {
    return windowSource
  },
  /** Source contract: installs the error reporter (compat has no Sentry; stored, never called). */
  setErrorReporter(reporter: (error: Error, entry: Record<string, unknown>) => void): void {
    errorReporter = typeof reporter === 'function' ? reporter : null
  },
  getErrorReporter(): ((error: Error, entry: Record<string, unknown>) => void) | null {
    return errorReporter
  },
  withContext: (context?: string) => createLogger(context),
}
