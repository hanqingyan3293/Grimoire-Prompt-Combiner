import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false } }))
import { cancelComfyExecution, loadComfySource, waitForComfyPoll } from './comfy-source-adapter'

const promptId = '11111111-1111-4111-8111-111111111111'

interface RecordedRequest { method: string; path: string; body: unknown }
interface FixtureServer {
  endpoint: string
  requests: RecordedRequest[]
  close(): Promise<void>
}

async function serve(handler: (request: RecordedRequest, response: http.ServerResponse) => void | Promise<void>): Promise<FixtureServer> {
  const requests: RecordedRequest[] = []
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString('utf8')
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    const recorded = { method: request.method || 'GET', path: new URL(request.url || '/', 'http://127.0.0.1').pathname, body }
    requests.push(recorded)
    await handler(recorded, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
  return {
    endpoint: 'http://127.0.0.1:' + address.port,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function json(response: http.ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function stats(response: http.ServerResponse, version: string): void {
  json(response, { system: { comfyui_version: version } })
}

function interrupted(response: http.ServerResponse): void {
  json(response, { [promptId]: { status: { status_str: 'error', messages: [['execution_interrupted', { prompt_id: promptId }]] } } })
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-comfy-source-'))
  execFileSync(process.execPath, ['scripts/build-comfy-source.mjs'], { cwd: process.cwd(), stdio: 'pipe' })
})
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('Cherry ComfyUI source bundle provenance', () => {
  it('builds the read-only source artifact with the recorded source hash', () => {
    const provenance = JSON.parse(fs.readFileSync('dist/main/integrations/cherry/comfy-source.provenance.json', 'utf8')) as Record<string, unknown>
    const output = fs.readFileSync('dist/main/integrations/cherry/comfy-source.cjs')
    expect(provenance.source).toBe('src/vendor/cherry/source/src/main/ai/provider/custom/comfyui/comfyuiTransport.ts')
    expect(provenance.sourceSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(String(provenance.source))).digest('hex'))
    expect(provenance.outputSha256).toBe(crypto.createHash('sha256').update(output).digest('hex'))
    expect(provenance.license).toBe('AGPL-3.0-only')
    expect(output.toString('utf8')).toContain('AGPL-3.0-only')
  })
})

describe('Cherry ComfyUI original abort-aware wait boundary (C1 R6)', () => {
  it('records the build entry separately while preserving the original vendor source hashes', () => {
    const provenance = JSON.parse(fs.readFileSync('dist/main/integrations/cherry/comfy-source.provenance.json', 'utf8'))
    expect(provenance.sourceSha256).toBe('0827ebc2cae3c6b29b7abdab1423efd5a1be2f69d7066339f3df085c1ed60849')
    expect(provenance.buildEntry?.path).toBe('scripts/entries/comfy-source.ts')
    expect(provenance.buildEntry.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(provenance.buildEntry.path)).digest('hex'))
    expect(crypto.createHash('sha256').update(fs.readFileSync('src/vendor/cherry/source/src/main/ai/provider/custom/transportUtils.ts')).digest('hex')).toBe('1150915e2a72cedcb859e62d66af0dc203281938046b070dded9d39ed2f35799')
  })

  it('exports the original wait and wakes an outstanding polling sleep immediately on abort', async () => {
    const source = loadComfySource()
    expect(source.waitWithSignal).toBeTypeOf('function')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const controller = new AbortController()
      const waiting = waitForComfyPoll(1000, controller.signal)
      const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError', message: 'Task polling aborted' })
      expect(vi.getTimerCount()).toBe(1)
      controller.abort()
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('does not allocate a timer for an already-aborted execution read', async () => {
    expect(loadComfySource().waitWithSignal).toBeTypeOf('function')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const controller = new AbortController(); controller.abort()
      await expect(waitForComfyPoll(1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('Cherry ComfyUI cancellation wrapper', () => {
  it('confirms only a targeted interrupt backed by execution_interrupted history', async () => {
    const server = await serve((request, response) => {
      if (request.method === 'GET' && request.path === '/system_stats') return stats(response, '0.3.57')
      if (request.method === 'POST' && request.path === '/queue') return json(response, {})
      if (request.method === 'POST' && request.path === '/interrupt') return json(response, {})
      if (request.method === 'GET' && request.path === '/queue') return json(response, { queue_pending: [], queue_running: [] })
      if (request.method === 'GET' && request.path === '/history/' + promptId) return interrupted(response)
      return json(response, {}, 404)
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('remote-confirmed')
      expect(result.targetedInterrupt).toBe(true)
      expect(result.version).toBe('0.3.57')
      expect(result.writes).toEqual([
        expect.objectContaining({ path: '/queue', method: 'POST', ok: true }),
        expect.objectContaining({ path: '/interrupt', method: 'POST', ok: true, promptId }),
      ])
      // The source's targeted gate is preserved: the version probe and the
      // id-scoped dequeue both precede the interrupt; the queue snapshot never
      // gates it. Network arrival order between the two writes is not asserted.
      const paths = server.requests.map(request => request.method + ' ' + request.path)
      expect(paths).toEqual(expect.arrayContaining(['POST /queue', 'GET /system_stats', 'POST /interrupt', 'GET /queue']))
      expect(paths.indexOf('GET /system_stats')).toBeLessThan(paths.indexOf('POST /interrupt'))
      const dequeue = server.requests.find(request => request.method === 'POST' && request.path === '/queue')!.body as { delete?: string[] }
      expect(dequeue.delete).toEqual([promptId])
      expect((server.requests.find(request => request.method === 'POST' && request.path === '/interrupt')!.body as { prompt_id?: string }).prompt_id).toBe(promptId)
    } finally { await server.close() }
  })

  it.each(['0.3.40', '0.3.57-rc1', 'v0.3.57', '0.3.56+local', 'unknown'])('never interrupts on version %s', async version => {
    const server = await serve((request, response) => {
      if (request.method === 'GET' && request.path === '/system_stats') return stats(response, version)
      if (request.method === 'POST' && request.path === '/queue') return json(response, {})
      if (request.method === 'GET' && request.path === '/queue') return json(response, { queue_pending: [], queue_running: [] })
      if (request.method === 'GET' && request.path === '/history/' + promptId) return json(response, {})
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('local-only')
      expect(result.targetedInterrupt).toBe(false)
      expect(server.requests.some(request => request.path === '/interrupt')).toBe(false)
    } finally { await server.close() }
    })

  it.each([
    { status_str: 'error', messages: [['execution_interrupted', { prompt_id: 'other-prompt' }]] },
    { status_str: 'error', note: 'not_execution_interrupted' },
    { status_str: 'error', messages: [['not_execution_interrupted', { prompt_id: promptId }]] },
    { status_str: 'success', messages: [['execution_interrupted', { prompt_id: promptId }]] },
    { status_str: 'error', messages: [['execution_interrupted', {}]] },
  ])('does not confirm cancellation from unrelated or malformed history evidence %j', async status => {
    const server = await serve((request, response) => {
      if (request.path === '/system_stats') return stats(response, '0.3.57')
      if (request.path === '/history/' + promptId) return json(response, { [promptId]: { status } })
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('local-only')
      expect(result.evidence).toBe('none')
    } finally { await server.close() }
  })

  it.each([
    ['0.3.40', '0.3.57', false],
    ['0.3.57', '0.3.40', true],
  ] as const)('reports the same %s version that gated the source interrupt', async (first, second, targeted) => {
    let probes = 0
    const server = await serve((request, response) => {
      if (request.path === '/system_stats') return stats(response, probes++ === 0 ? first : second)
      if (request.path === '/history/' + promptId) return interrupted(response)
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.version).toBe(first)
      expect(result.targetedInterrupt).toBe(targeted)
      expect(probes).toBe(1)
      expect(server.requests.filter(request => request.path === '/interrupt')).toHaveLength(targeted ? 1 : 0)
    } finally { await server.close() }
  })

  it('preserves confirmed same-id interruption even when the preceding dequeue failed', async () => {
    const server = await serve((request, response) => {
      if (request.path === '/system_stats') return stats(response, '0.3.57')
      if (request.method === 'POST' && request.path === '/queue') return json(response, { error: 'dequeue failed' }, 500)
      if (request.path === '/history/' + promptId) return interrupted(response)
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('remote-confirmed')
      expect(result.writes).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/queue', status: 500, ok: false })]))
    } finally { await server.close() }
  })

  it('observes the source version and targeted writes under a configured endpoint prefix', async () => {
    const server = await serve((request, response) => {
      if (request.path === '/comfy/system_stats') return stats(response, '0.3.57')
      if (request.path === '/comfy/history/' + promptId) return interrupted(response)
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint + '/comfy', promptId })
      expect(result).toMatchObject({ outcome: 'remote-confirmed', version: '0.3.57', targetedInterrupt: true })
      expect(result.writes.map(write => write.path)).toEqual(['/comfy/queue', '/comfy/interrupt'])
    } finally { await server.close() }
  })

  it('detects a failed source dequeue under a configured endpoint prefix', async () => {
    const server = await serve((request, response) => {
      if (request.path === '/comfy/system_stats') return stats(response, '0.3.40')
      if (request.method === 'POST' && request.path === '/comfy/queue') return json(response, {}, 500)
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint + '/comfy', promptId })
      expect(result.outcome).toBe('failed')
      expect(result.writes).toEqual([expect.objectContaining({ path: '/comfy/queue', ok: false, status: 500 })])
    } finally { await server.close() }
  })

  it('reports a rejected interrupt as an observed failure', async () => {
    const server = await serve((request, response) => {
      if (request.method === 'GET' && request.path === '/system_stats') return stats(response, '0.3.57')
      if (request.method === 'POST' && request.path === '/queue') return json(response, {})
      if (request.method === 'POST' && request.path === '/interrupt') return json(response, { error: 'no' }, 500)
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('failed')
      expect(result.writes).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/interrupt', ok: false, status: 500 })]))
    } finally { await server.close() }
  })

  it('does not confirm a 200 interrupt or a missing queue entry without service evidence', async () => {
    const server = await serve((request, response) => {
      if (request.method === 'GET' && request.path === '/system_stats') return stats(response, '0.3.57')
      if (request.method === 'POST' && request.path === '/queue') return json(response, {})
      if (request.method === 'POST' && request.path === '/interrupt') return json(response, {})
      if (request.method === 'GET' && request.path === '/queue') return json(response, { queue_pending: [], queue_running: [] })
      if (request.method === 'GET' && request.path === '/history/' + promptId) return json(response, {})
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('local-only')
      expect(result.evidence).toBe('none')
      expect(result.writes).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/interrupt', ok: true })]))
    } finally { await server.close() }
  })

  it('does not let a hanging queue snapshot block the targeted write', async () => {
    const server = await serve(async (request, response) => {
      if (request.method === 'GET' && request.path === '/system_stats') return stats(response, '0.3.57')
      if (request.method === 'POST' && request.path === '/queue') return json(response, {})
      if (request.method === 'POST' && request.path === '/interrupt') return json(response, {})
      if (request.method === 'GET' && request.path === '/queue') { await new Promise(resolve => setTimeout(resolve, 900)); return json(response, { queue_pending: [], queue_running: [] }) }
      if (request.method === 'GET' && request.path === '/history/' + promptId) return interrupted(response)
      return json(response, {})
    })
    try {
      const started = Date.now()
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(Date.now() - started).toBeLessThan(800)
      expect(result.outcome).toBe('remote-confirmed')
      expect(server.requests.some(request => request.method === 'POST' && request.path === '/interrupt')).toBe(true)
    } finally { await server.close() }
  })

  it('treats a failed dequeue as an observed failure even though the source swallows it', async () => {
    const server = await serve((request, response) => {
      if (request.method === 'GET' && request.path === '/system_stats') return stats(response, '0.3.40')
      if (request.method === 'POST' && request.path === '/queue') return json(response, { error: 'no' }, 500)
      return json(response, {})
    })
    try {
      const result = await cancelComfyExecution({ endpoint: server.endpoint, promptId })
      expect(result.outcome).toBe('failed')
      expect(result.writes).toEqual([expect.objectContaining({ path: '/queue', ok: false, status: 500 })])
    } finally { await server.close() }
  })
})
