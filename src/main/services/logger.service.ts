// 魔导书 Grimoire v7 — 日志服务
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { getDatabase, saveDatabase } from '../database'
import { createDiagnosticEvent, redactSensitiveText, type DiagnosticEvent, type DiagnosticLevel } from './diagnostics.core'

const LOG_FILE_NAME = 'grimoire.log.jsonl'
const MAX_LOG_BYTES = 5 * 1024 * 1024

function getLogPath(): string {
  const configuredDirectory = process.env.GRIMOIRE_LOG_DIR
  const directory = configuredDirectory || (app.isReady() ? app.getPath('userData') : path.join(os.tmpdir(), 'grimoire-logs'))
  fs.mkdirSync(directory, { recursive: true })
  return path.join(directory, LOG_FILE_NAME)
}

function rotateLogIfNeeded(logPath: string): void {
  try {
    if (fs.statSync(logPath).size < MAX_LOG_BYTES) return
    const rotatedPath = logPath + '.1'
    if (fs.existsSync(rotatedPath)) fs.rmSync(rotatedPath)
    fs.renameSync(logPath, rotatedPath)
  } catch {
    // Logging must never prevent the application from starting or closing.
  }
}

function writeStructuredEvent(event: DiagnosticEvent): void {
  try {
    const logPath = getLogPath()
    rotateLogIfNeeded(logPath)
    fs.appendFileSync(logPath, JSON.stringify(event) + os.EOL, 'utf-8')
  } catch {
    // Logging must never prevent the application from starting or closing.
  }
}

export function logEvent(
  level: DiagnosticLevel,
  module: string,
  message: string,
  details: Omit<DiagnosticEvent, 'timestamp' | 'level' | 'module' | 'message'> = {},
): void {
  writeStructuredEvent(createDiagnosticEvent(level, module, message, details))
}

export function logError(message: string, stack = '', context = ''): void {
  const safeMessage = redactSensitiveText(message)
  const safeStack = redactSensitiveText(stack)
  const safeContext = redactSensitiveText(context)
  logEvent('error', 'application', safeMessage, { stack: safeStack, context: safeContext })

  try {
    const db = getDatabase()
    db.run(
      'INSERT INTO error_logs (message, stack, context) VALUES (?,?,?)',
      [safeMessage.slice(0, 500), safeStack.slice(0, 2000), safeContext.slice(0, 500)]
    )
    saveDatabase()
  } catch {
    // 日志记录失败不应导致程序崩溃
    console.error('[ErrorLogger] Failed to log:', safeMessage)
  }
}

export function getErrorLogs(limit = 50) {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?', [limit])
  return (result[0]?.values || []).map(r => ({
    id: r[0], message: r[1], stack: r[2], context: r[3], created_at: r[4],
  }))
}
