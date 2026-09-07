import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createPersistedTask, getPersistedTask } from '../services/task-repository'
import { taskRunner } from '../services/task-runner'
import { configureWD14ModelDirectory, configureWD14PythonPath, wd14Worker } from '../services/wd14-worker'

export async function runWD14TaskIntegration(): Promise<void> {
  const userData = requireEnv('GRIMOIRE_INTEGRATION_USER_DATA')
  const imagePath = requireEnv('GRIMOIRE_INTEGRATION_IMAGE')
  const pythonPath = requireEnv('GRIMOIRE_INTEGRATION_PYTHON')
  const modelDirectory = requireEnv('GRIMOIRE_INTEGRATION_WD14_MODELS')
  let exitCode = 1
  try {
    fs.mkdirSync(userData, { recursive: true })
    await initDatabase()
    configureWD14PythonPath(pythonPath)
    configureWD14ModelDirectory(modelDirectory)

    const imageInsert = getDatabase().run(
      'INSERT INTO image_refs (file_path, storage_mode, original_name, available) VALUES (?,?,?,?)',
      [path.resolve(imagePath), 'external', path.basename(imagePath), 1],
    )
    const task = createPersistedTask({
      id: 'task_wd14_integration',
      kind: 'wd14',
      input: { imageId: Number(imageInsert.lastInsertRowid), threshold: 0.35, modelId: 'wd-vit-large-tagger-v3' },
      maxRetries: 0,
    })

    taskRunner.start()
    const finished = await waitForTask(task.id, 120_000)
    process.stdout.write(JSON.stringify({
      id: finished.id,
      status: finished.status,
      progress: finished.progress,
      errorCode: finished.error_code,
      errorMessage: finished.error_message,
      output: finished.output_json ? JSON.parse(finished.output_json) : null,
    }) + '\n')
    exitCode = finished.status === 'succeeded' ? 0 : 1
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.stack || error.message : String(error)) + '\n')
  } finally {
    taskRunner.stop()
    await wd14Worker.stop()
    closeDatabase()
    app.exit(exitCode)
  }
}

async function waitForTask(id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = getPersistedTask(id)
    if (task && ['succeeded', 'failed', 'cancelled'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('WD14 integration task timed out')
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(name + ' is required')
  return value
}
