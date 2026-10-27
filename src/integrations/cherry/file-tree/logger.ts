/** Grimoire boundary for the extracted Cherry logger. No filesystem/database writes. */
export const loggerService = {
  withContext(context: string) {
    return {
      warn(message: string, error?: unknown) { console.warn(`[${context}] ${message}`, error ?? '') },
      error(message: string, error?: unknown) { console.error(`[${context}] ${message}`, error ?? '') }
    }
  }
}
