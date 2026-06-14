// 魔导书 Grimoire v7 — 日志服务
import { getDatabase, saveDatabase } from '../database'

export function logError(message: string, stack = '', context = ''): void {
  try {
    const db = getDatabase()
    db.run(
      'INSERT INTO error_logs (message, stack, context) VALUES (?,?,?)',
      [message.slice(0, 500), stack.slice(0, 2000), context.slice(0, 500)]
    )
    saveDatabase()
  } catch {
    // 日志记录失败不应导致程序崩溃
    console.error('[ErrorLogger] Failed to log:', message)
  }
}

export function getErrorLogs(limit = 50) {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?', [limit])
  return (result[0]?.values || []).map(r => ({
    id: r[0], message: r[1], stack: r[2], context: r[3], created_at: r[4],
  }))
}
