import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ComfyUIClient } from './comfy-client'
const servers: http.Server[] = []
async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return 'http://127.0.0.1:' + address.port
}
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } })
type RemoteClient = ComfyUIClient & { remoteWorkflows(): Promise<string[]>; readRemoteWorkflow(handle: string): Promise<unknown> }
const client = (base: string) => new ComfyUIClient(base) as RemoteClient
const reply = (response: http.ServerResponse, value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }

describe('C3 remote workflow discovery and source path read', () => {
  it('lists the actual source directory, retains nested names and reads an encoded whole path', async () => {
    const requests: string[] = []
    const graph = { nodes: [{ id: 1, type: 'Text', widgets_values: ['saved'] }], links: [] }
    const base = await fixture((request, response) => {
      requests.push(request.url || '')
      if (request.url?.startsWith('/v2/userdata')) return reply(response, [
        { name: 'a.json', type: 'file', path: 'workflows/a.json' },
        { name: '嵌套.json', type: 'file', path: 'workflows/sub/嵌套.json' },
        { name: 'sub', type: 'directory', path: 'workflows/sub' },
        { name: 'note.txt', type: 'file', path: 'workflows/note.txt' },
      ])
      reply(response, graph)
    })
    await expect(client(base).remoteWorkflows()).resolves.toEqual(['a', 'sub/嵌套'])
    await expect(client(base).readRemoteWorkflow('sub/嵌套')).resolves.toEqual(graph)
    expect(requests).toEqual(['/v2/userdata?path=workflows', '/userdata/' + encodeURIComponent('workflows/sub/嵌套.json')])
  })
  it('preserves an unavailable directory as an HTTP failure instead of an empty list', async () => {
    const base = await fixture((_request, response) => reply(response, { error: 'offline directory' }, 503))
    await expect(client(base).remoteWorkflows()).rejects.toMatchObject({ code: 'COMFY_HTTP_503', retryable: true })
  })
  it.each([{}, [{ name: null, type: 'file' }], [{ name: 'bad.json', type: 'file', path: 'workflows/../bad.json' }], [{ name: 'bad.json', type: 'file', path: 'other/bad.json' }]])('refuses a malformed or traversing listing %j', async listing => {
    const base = await fixture((_request, response) => reply(response, listing))
    await expect(client(base).remoteWorkflows()).rejects.toMatchObject({ code: 'COMFY_BAD_RESPONSE', retryable: false })
  })
  it.each(['../escape', '/absolute', 'a/../../escape', 'a\\escape', 'a/%2e%2e/escape', 'a#frag', 'a?query', 'C:escape', 'a//b'])('rejects unsafe handle %s without any network read', async handle => {
    let requests = 0
    const base = await fixture((_request, response) => { requests++; reply(response, {}) })
    await expect(client(base).readRemoteWorkflow(handle)).rejects.toMatchObject({ code: 'COMFY_WORKFLOW_INVALID', retryable: false })
    expect(requests).toBe(0)
  })
  it('reads model names from the full live node catalog and surfaces a failed catalog', async () => {
    let status = 200
    const requests: string[] = []
    const base = await fixture((request, response) => {
      requests.push(request.url || '')
      reply(response, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['one.safetensors']] } } }, CustomGenerator: { input: {} } }, status)
    })
    await expect(client(base).models()).resolves.toMatchObject({ checkpoints: ['one.safetensors'] })
    expect(requests).toEqual(['/object_info'])
    status = 503
    await expect(client(base).models()).rejects.toMatchObject({ code: 'COMFY_HTTP_503', retryable: true })
  })
})
