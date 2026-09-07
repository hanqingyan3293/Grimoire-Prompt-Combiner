import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database'
import type { TaskCreateInput, TaskRecord, TaskStatus } from '../../shared/task-types'
import { createTask, retryTask, transitionTask } from './task-state'

function rowToTask(row: unknown[]): TaskRecord {
  return {
    id: String(row[0]),
    kind: row[1] as TaskRecord['kind'],
    status: row[2] as TaskStatus,
    input_json: String(row[3]),
    output_json: row[4] == null ? null : String(row[4]),
    error_code: row[5] == null ? null : String(row[5]),
    error_message: row[6] == null ? null : String(row[6]),
    progress: Number(row[7]),
    retry_count: Number(row[8]),
    max_retries: Number(row[9]),
    created_at: String(row[10]),
    started_at: row[11] == null ? null : String(row[11]),
    finished_at: row[12] == null ? null : String(row[12]),
    updated_at: String(row[13]),
  }
}

export function createPersistedTask(input: TaskCreateInput): TaskRecord {
  const db = getDatabase()
  const task = createTask(input)
  db.run(`INSERT INTO task_jobs (id, kind, status, input_json, output_json, error_code, error_message, progress, retry_count, max_retries, created_at, started_at, finished_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    task.id, task.kind, task.status, task.input_json, task.output_json, task.error_code, task.error_message, task.progress, task.retry_count, task.max_retries, task.created_at, task.started_at, task.finished_at, task.updated_at,
  ])
  saveDatabase()
  return task
}

export function listPersistedTasks(status?: TaskStatus): TaskRecord[] {
  const db = getDatabase()
  const result = status
    ? db.exec('SELECT * FROM task_jobs WHERE status=? ORDER BY created_at ASC', [status])
    : db.exec('SELECT * FROM task_jobs ORDER BY created_at DESC')
  return (result[0]?.values || []).map(rowToTask)
}

export function getPersistedTask(id: string): TaskRecord | null {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM task_jobs WHERE id=?', [id])
  return result[0]?.values?.[0] ? rowToTask(result[0].values[0]) : null
}

export function updatePersistedTask(id: string, next: TaskRecord): TaskRecord {
  const db = getDatabase()
  db.run(`UPDATE task_jobs SET status=?, output_json=?, error_code=?, error_message=?, progress=?, retry_count=?, max_retries=?, started_at=?, finished_at=?, updated_at=? WHERE id=?`, [
    next.status, next.output_json, next.error_code, next.error_message, next.progress, next.retry_count, next.max_retries, next.started_at, next.finished_at, next.updated_at, id,
  ])
  saveDatabase()
  return next
}

export function cancelPersistedTask(id: string): TaskRecord {
  const task = getPersistedTask(id)
  if (!task) throw new Error('任务不存在')
  if (task.status === 'queued') return updatePersistedTask(id, transitionTask(task, 'cancelled'))
  if (task.status === 'running') return updatePersistedTask(id, transitionTask(task, 'cancelling'))
  if (task.status === 'paused') return updatePersistedTask(id, transitionTask(task, 'cancelling'))
  throw new Error('当前任务状态不可取消')
}

export function retryPersistedTask(id: string): TaskRecord {
  const task = getPersistedTask(id)
  if (!task) throw new Error('任务不存在')
  return updatePersistedTask(id, retryTask(task))
}

export function markInterruptedTasks(): number {
  const db = getDatabase()
  const result = db.run("UPDATE task_jobs SET status='failed', error_code='APP_RESTARTED', error_message='应用重启时任务未完成', finished_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE status IN ('running','cancelling')")
  saveDatabase()
  return Number(result.changes)
}

export function createTaskId(): string {
  return 'task_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
}
