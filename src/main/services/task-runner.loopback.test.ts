import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-task-loopback-'))
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./logger.service', () => ({ logEvent: () => undefined }))
vi.mock('./media.service', async importOriginal => ({ ...await importOriginal<typeof import('./media.service')>(), createImageDerivatives: async () => undefined }))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { createPersistedTask, getPersistedTask } from './task-repository'
import { importComfyWorkflow } from './comfy-workflow.service'

let server: http.Server
let endpoint = ''
let promptPosts = 0
let historyGets = 0
let imageGets = 0
const originalBase = process.env.COMFYUI_API_BASE
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
let runner: typeof import('./task-runner').taskRunner

async function waitForStatus(id: string, expected: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (getPersistedTask(id)?.status === expected) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('timed out waiting for ' + expected + '; actual=' + JSON.stringify(getPersistedTask(id)))
}

beforeAll(async () => {
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    for await (const _chunk of request) { /* drain the body */ }
    const send = (value: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (request.method === 'POST' && url.pathname === '/prompt') {
      promptPosts += 1
      return send({ prompt_id: 'prompt-loopback' })
    }
    if (request.method === 'GET' && url.pathname === '/history/prompt-loopback') {
      historyGets += 1
      if (historyGets === 1) return send({ error: 'busy' }, 503)
      return send({ 'prompt-loopback': { status: { status_str: 'success' }, outputs: { '1': { images: [{ filename: 'loopback.png', subfolder: '', type: 'output' }] } } } })
    }
    if (request.method === 'GET' && url.pathname === '/view') {
      imageGets += 1
      if (imageGets === 1) return send({ error: 'image not ready' }, 503)
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(png)
      return
    }
    return send({})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('loopback server did not bind')
  endpoint = 'http://127.0.0.1:' + address.port
  process.env.COMFYUI_API_BASE = endpoint
  await initDatabase()
  runner = (await import('./task-runner')).taskRunner
})

afterAll(async () => {
  await runner?.stopAndWait()
  await new Promise<void>(resolve => server.close(() => resolve()))
  closeDatabase()
  if (originalBase === undefined) delete process.env.COMFYUI_API_BASE
  else process.env.COMFYUI_API_BASE = originalBase
  fs.rmSync(root, { recursive: true, force: true })
})

describe('task runner real loopback ComfyUI transport', () => {
  it('keeps one actual POST across transient history and download failures while importing a real PNG', async () => {
    const workflowId = importComfyWorkflow('loopback fixture', { '1': { class_type: 'FixtureNode', inputs: { value: 'fixture' } } }).id
    const created = createPersistedTask({ kind: 'comfyui', input: { workflowId, prompt: 'loopback prompt' }, maxRetries: 2 })
    runner.start()
    await waitForStatus(created.id, 'succeeded')
    expect(promptPosts).toBe(1)
    expect(historyGets).toBeGreaterThanOrEqual(2)
    expect(imageGets).toBe(2)
    expect(getPersistedTask(created.id)).toMatchObject({ status: 'succeeded', retry_count: 2, execution: { phase: 'importing', promptId: 'prompt-loopback', endpoint } })
    const output = JSON.parse(getPersistedTask(created.id)!.output_json!) as { imageIds: number[] }
    expect(output.imageIds).toHaveLength(1)
    expect(getDatabase().exec('SELECT count(*) FROM task_image_refs WHERE task_id=?', [created.id])[0].values[0][0]).toBe(1)
  })
})
