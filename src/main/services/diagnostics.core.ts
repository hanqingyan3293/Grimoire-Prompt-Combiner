export type DiagnosticLevel = "debug" | "info" | "warn" | "error"

export interface DiagnosticEvent {
  timestamp: string
  level: DiagnosticLevel
  module: string
  message: string
  context?: string
  stack?: string
  taskId?: string
  phase?: string
  durationMs?: number
  errorCode?: string
  retryable?: boolean
}

const SECRET_PATTERNS: RegExp[] = [
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[:=]\s*)([^\s,;"'}]+)/gi,
  /(Bearer\s+)([^\s,;"'}]+)/gi,
  /\b(sk-[A-Za-z0-9_-]{8,})\b/g,
]

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "$1[REDACTED]"), value)
}

export function createDiagnosticEvent(
  level: DiagnosticLevel,
  module: string,
  message: string,
  details: Omit<DiagnosticEvent, "timestamp" | "level" | "module" | "message"> = {},
  now = new Date(),
): DiagnosticEvent {
  const event: DiagnosticEvent = {
    timestamp: now.toISOString(),
    level,
    module: redactSensitiveText(module).slice(0, 80),
    message: redactSensitiveText(message).slice(0, 1000),
  }

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue
    if (typeof value === "string") {
      event[key as keyof DiagnosticEvent] = redactSensitiveText(value).slice(0, 2000) as never
    } else {
      event[key as keyof DiagnosticEvent] = value as never
    }
  }

  return event
}

