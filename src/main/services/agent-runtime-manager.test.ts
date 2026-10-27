import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

let root = ''
const spawnMock = vi.hoisted(() => vi.fn())
const execFileSyncMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => root,
    getPath: (name: string) => name === 'userData' ? root + '/profile' : root,
  },
}))
vi.mock('child_process', () => ({ spawn: spawnMock, execFileSync: execFileSyncMock }))

import { acquireOpenCodeRuntimeLease, shutdownAgentRuntimes, type OpenCodeRuntimeLease } from './agent-runtime-manager'

function child(): ChildProcessWithoutNullStreams {
  const value = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(value, {
    pid: 1234,
    exitCode: null,
    signalCode: null,
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(function (this: ChildProcessWithoutNullStreams) { Object.assign(this, { exitCode: 0 }); this.emit('exit', 0, null); return true }),
  })
  return value
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-runtime-manager-'))
  fs.mkdirSync(path.join(root, 'resources/agent-runtimes/opencode'), { recursive: true })
  fs.writeFileSync(path.join(root, 'resources/agent-runtimes/opencode/opencode.exe'), 'fixture')
  fs.mkdirSync(path.join(root, 'workspace'))
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ healthy: true })))
  execFileSyncMock.mockReturnValue('1.18.34\n')
  spawnMock.mockImplementation(() => child())
})
afterEach(async () => {
  await shutdownAgentRuntimes()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('OpenCode runtime leases', () => {
  it('shares a process only for the same owner-scoped configuration', async () => {
    const first = await acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', apiKey: 'secret-a', model: 'model', directory: root + '/workspace' })
    const second = await acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', apiKey: 'secret-a', model: 'model', directory: root + '/workspace' })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(first.endpoint).toBe(second.endpoint)
    expect(first.leaseId).not.toBe(second.leaseId)
    await first.release()
    expect(second.process.exitCode).toBeNull()
    await second.release()
    expect(second.process.exitCode).toBe(0)
  })

  it('isolates owners and never includes the API key in its fingerprint', async () => {
    const first = await acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', apiKey: 'secret-a', model: 'model', directory: root + '/workspace' })
    const second = await acquireOpenCodeRuntimeLease({ owner: 'agent:two', baseUrl: 'http://provider.test/v1', apiKey: 'secret-a', model: 'model', directory: root + '/workspace' })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(first.configKey).not.toContain('secret-a')
    expect(second.configKey).not.toContain('secret-a')
    await first.release()
    await second.release()
  })

  it('rejects a second config for an owner with an active lease', async () => {
    const first = await acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', apiKey: 'secret-a', model: 'model', directory: root + '/workspace' })
    await expect(acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', apiKey: 'secret-b', model: 'model', directory: root + '/workspace' })).rejects.toThrow('OPENCODE_OWNER_CONFIG_CONFLICT')
    expect(first.configKey).not.toContain('secret-a')
    await first.release()
  })

  it('makes release idempotent and only stops owned processes', async () => {
    const lease = await acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', model: 'model', directory: root + '/workspace' })
    await lease.release()
    await lease.release()
    expect(lease.process.kill).toHaveBeenCalledTimes(1)
  })

  it('rejects an asynchronous spawn error without leaking the temporary config', async () => {
    const broken = child()
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => broken.emit('error', new Error('ENOENT: spawn opencode.exe')))
      return broken
    })
    await expect(acquireOpenCodeRuntimeLease({ owner: 'ai:spawn-error', baseUrl: 'http://provider.test/v1', apiKey: 'secret-a', model: 'model', directory: root + '/workspace' })).rejects.toThrow('子进程启动失败')
    expect([...fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('grimoire-opencode-'))]).not.toContain('secret-a')
  })

  it('does not reuse a failed pending startup for another lease', async () => {
    const failedChild = child()
    Object.assign(failedChild, { exitCode: 1 })
    spawnMock.mockImplementationOnce(() => failedChild)
    await expect(acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', model: 'model', directory: root + '/workspace' })).rejects.toThrow('OpenCode Runtime 提前退出')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ healthy: true })))
    const lease = await acquireOpenCodeRuntimeLease({ owner: 'ai:one', baseUrl: 'http://provider.test/v1', model: 'model', directory: root + '/workspace' })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    await lease.release()
  }, 35_000)
})
