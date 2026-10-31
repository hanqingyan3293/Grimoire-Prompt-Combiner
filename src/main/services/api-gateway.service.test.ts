import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testRoot = ''

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'exe' ? path.join(testRoot, 'Grimoire.exe') : testRoot) },
  // providers.ipc decrypts the stored key at import time; without this the module throws and every
  // request hangs waiting for a server that was never created.
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
}))

import { closeDatabase, getDatabase, initDatabase } from '../database'
import { getGatewayStatus, restartGateway, startGateway, stopGateway } from './api-gateway.service'

let upstream: http.Server | null = null
let upstreamPort = 0

async function startUpstream(): Promise<void> {
  upstream = http.createServer((req, res) => {
    // The OpenAI SDK appends `/chat/completions` to the configured base URL, which already ends in
    // `/v1` here — matching the suffix keeps the fake upstream honest about what it answers.
    if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: parsed.model, choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }] }) + '\n\n')
        res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: parsed.model, choices: [{ index: 0, delta: { content: '好' }, finish_reason: null }] }) + '\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', model: parsed.model, choices: [{ index: 0, message: { role: 'assistant', content: '你好，世界' }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', () => resolve()))
  const address = upstream.address()
  upstreamPort = typeof address === 'object' && address ? address.port : 0
}

function seedProvider(): void {
  getDatabase().run(
    'INSERT INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,context_size,models,config_toml,auth_json,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)',
    ['p1', 'fake', 'api', 'chat_completions', 'http://127.0.0.1:' + upstreamPort + '/v1', 'sk-test', 'fake-model', '', null, JSON.stringify(['fake-model']), '', ''],
  )
}

async function post(pathname: string, body: unknown, token: string) {
  const port = getGatewayStatus().port
  const response = await fetch('http://127.0.0.1:' + port + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  })
  return { status: response.status, text: await response.text() }
}

beforeEach(async () => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-gateway-'))
  await initDatabase()
  await startUpstream()
  seedProvider()
})

afterEach(async () => {
  await stopGateway()
  await new Promise<void>(resolve => upstream ? upstream.close(() => resolve()) : resolve())
  upstream = null
  closeDatabase()
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('local OpenAI gateway (M3)', () => {
  it('serves models and a non-streaming completion through the active provider', async () => {
    const status = await startGateway({ apiKey: 'gw-key' })
    expect(status.running).toBe(true)
    expect(status.port).toBeGreaterThan(0)
    const models = await fetch('http://127.0.0.1:' + status.port + '/v1/models', { headers: { authorization: 'Bearer gw-key' } })
    expect(models.status).toBe(200)
    expect((await models.json()).data[0].id).toBe('fake-model')
    const result = await post('/v1/chat/completions', { model: 'fake-model', messages: [{ role: 'user', content: 'hi' }] }, 'gw-key')
    expect(result.status).toBe(200)
    expect(result.text).toContain('你好，世界')
  })

  it('streams SSE chunks for stream=true', async () => {
    const status = await startGateway({ apiKey: 'gw-key' })
    const result = await post('/v1/chat/completions', { model: 'fake-model', stream: true, messages: [{ role: 'user', content: 'hi' }] }, 'gw-key')
    expect(result.status).toBe(200)
    expect(result.text).toContain('你')
    expect(result.text).toContain('好')
    expect(result.text).toContain('[DONE]')
    expect(status.running).toBe(true)
  })

  it('rejects a missing or wrong bearer token', async () => {
    await startGateway({ apiKey: 'gw-key' })
    expect((await post('/v1/chat/completions', { model: 'm', messages: [] }, '')).status).toBe(401)
    expect((await post('/v1/chat/completions', { model: 'm', messages: [] }, 'wrong')).status).toBe(401)
  })

  it('can restart on the same instance without leaking the old listener', async () => {
    const first = await startGateway({ apiKey: 'a' })
    const second = await restartGateway({ apiKey: 'b' })
    expect(second.running).toBe(true)
    expect(first.port).toBeGreaterThan(0)
    expect((await post('/v1/chat/completions', { model: 'fake-model', messages: [] }, 'b')).status).toBe(200)
  })
  it('is idempotent while running, and rejects a port already taken by another listener', async () => {
    const first = await startGateway({ apiKey: 'a' })
    // Starting twice must NOT bind a second listener: the published endpoint stays the first one.
    const again = await startGateway({ apiKey: 'b', port: first.port })
    expect(again.port).toBe(first.port)
    expect(again.apiKeyConfigured).toBe(first.apiKeyConfigured)
    await stopGateway()
    expect(getGatewayStatus().running).toBe(false)
    // Now hold the port with a foreign listener: the gateway must fail loudly rather than bind elsewhere,
    // because a silently different port would make the configured endpoint wrong.
    const squatter = http.createServer((_request, response) => response.end('x'))
    await new Promise<void>(resolve => squatter.listen(0, '127.0.0.1', () => resolve()))
    const address = squatter.address()
    const busyPort = typeof address === 'object' && address ? address.port : 0
    const conflict = await startGateway({ apiKey: 'c', port: busyPort }).then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }))
    expect(conflict.ok).toBe(false)
    expect(String((conflict as { error?: string }).error)).toMatch(/EADDRINUSE|EACCES/i)
    expect(getGatewayStatus().running).toBe(false)
    await new Promise<void>(resolve => squatter.close(() => resolve()))
    // Stopping an idle gateway must not throw: the settings page can call stop after a failed start.
    await expect(stopGateway()).resolves.not.toThrow()
  })
})
