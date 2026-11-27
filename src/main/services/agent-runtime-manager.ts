import fs from "fs"
import path from "path"
import crypto from "crypto"
import os from "os"
import net from "net"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { app } from "electron"
import { RuntimeLeasePool, type ManagedRuntimeResource } from './agent-runtime-lease.service'
import { runtimeWorkingDirectory, runtimeProcessEnvironment } from './agent-runtime-safety.service'
import type { AiRuntimeKind } from "../../shared/ai-types"
import type { RuntimeSelectionContract } from '../../shared/runtime-contract'
import { readRuntimeFeatureFlags } from '../ai/runtime/features'

export type AgentRuntimeDriver = 'provider-adapter' | 'pi-rpc' | 'pi-sdk' | 'opencode-unprepared' | 'codex-cli'

export type AgentRuntimeStatus = {
  kind: AiRuntimeKind
  available: boolean
  source: "embedded" | "system" | "missing"
  executable: string | null
  version: string | null
  message: string
  checkedAt: string
  /** Main-selected driver. A CLI presence check does not override the Pi SDK gate. */
  driver: AgentRuntimeDriver
  contract: RuntimeSelectionContract
}

/** Main-owned UI metadata; renderers never decide provider/model mode by runtime name. */
export function runtimeSelectionContract(kind: AiRuntimeKind): RuntimeSelectionContract {
  return kind === 'openai-compatible' || kind === 'anthropic' || kind === 'google'
    ? { provider: 'grimoire', model: 'catalog' }
    : { provider: 'runtime', model: 'freeform' }
}

export type ManagedOpenCodeRuntime = {
  endpoint: string
  port: number
  executable: string
  directory: string
  defaultModel?: string
  process: ChildProcessWithoutNullStreams
  configKey: string
  configDir?: string
  binaryVersion: string
  ownerKey: string
  leaseId: string
  /** Release this owner lease. Idempotent; does not stop another owner's process. */
  release: () => Promise<void>
  /** Compatibility alias for callers that own exactly one lease. */
  close: () => Promise<void>
}

type OpenCodeProviderBridge = {
  baseUrl?: string
  apiKey?: string
  model?: string
  directory?: string
  signal?: AbortSignal
  /** Main-owned local owner, normally the Grimoire session id. */
  owner?: string
}

export type OpenCodeRuntimeLease = ManagedOpenCodeRuntime

type ManagedOpenCodeResource = Omit<ManagedOpenCodeRuntime, 'ownerKey' | 'leaseId' | 'release'> & ManagedRuntimeResource

const managedOpenCodeLeases = new RuntimeLeasePool<ManagedOpenCodeResource>()

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "agent-runtimes")
    : path.join(app.getAppPath(), "resources", "agent-runtimes")
}
function candidates(kind: AiRuntimeKind) {
  if (kind === "pi") return ["pi.exe", "pi.cmd", "pi", path.join("bin", "pi.exe"), path.join("bin", "pi.cmd"), path.join("bin", "pi")]
  if (kind === "opencode") return ["opencode.exe", "opencode.cmd", "opencode", path.join("bin", "opencode.exe"), path.join("bin", "opencode.cmd"), path.join("bin", "opencode")]
  if (kind === "codex") return ["codex.exe", "codex.cmd", "codex"]
  return []
}
function systemPath(kind: AiRuntimeKind): string | null {
  const command = kind === "pi" ? "pi" : kind === "opencode" ? "opencode" : kind === "codex" ? "codex" : ""
  if (!command) return null
  try {
    const output = execFileSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8", windowsHide: true, timeout: 3000 })
    const paths = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean).filter(value => fs.existsSync(value))
    const rank = (value: string) => {
      const lower = value.toLowerCase()
      if (lower.endsWith('.exe')) return 0
      if (lower.endsWith('.cmd')) return 1
      if (lower.endsWith('.bat')) return 2
      if (lower.endsWith('.ps1')) return 4
      return 3
    }
    return paths.sort((a, b) => rank(a) - rank(b))[0] || null
  } catch { return null }
}
function version(executable: string): string | null {
  try {
    const output = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
    return output.trim().split(String.fromCharCode(10))[0] || null
  } catch { return null }
}

export function inspectAgentRuntime(kind: AiRuntimeKind): AgentRuntimeStatus {
  const checkedAt = new Date().toISOString()
  const contract = runtimeSelectionContract(kind)
  if (["openai-compatible", "anthropic", "google"].includes(kind)) return { kind, available: true, source: "system", executable: null, version: "provider-adapter", message: "由 Grimoire Provider Adapter 提供", checkedAt, driver: 'provider-adapter', contract }
  // The SDK is an in-process ESM driver. Its availability must not be tied to
  // a `pi` CLI that the SDK path never launches.
  if (kind === 'pi' && readRuntimeFeatureFlags().piSdk) {
    return { kind, available: true, source: "embedded", executable: null, version: "1.0.1", message: "Pi SDK（进程内 ESM）已启用", checkedAt, driver: 'pi-sdk', contract }
  }
  const driver: AgentRuntimeDriver = kind === 'pi' ? 'pi-rpc' : kind === 'opencode' ? 'opencode-unprepared' : 'codex-cli'
  const root = path.join(runtimeRoot(), kind)
  for (const name of candidates(kind)) {
    const file = path.join(root, name)
    if (fs.existsSync(file)) return { kind, available: true, source: "embedded", executable: file, version: version(file), message: "已找到内置 Runtime", checkedAt, driver, contract }
  }
  const system = systemPath(kind)
  if (system) return { kind, available: true, source: "system", executable: system, version: version(system), message: "使用系统 PATH 中的 Runtime", checkedAt, driver, contract }
  return { kind, available: false, source: "missing", executable: null, version: null, message: "未找到 " + kind + " Runtime。请准备 resources/agent-runtimes/" + kind + " 或安装系统命令。", checkedAt, driver, contract }
}

export function inspectAgentRuntimes() {
  return (["openai-compatible", "anthropic", "google", "pi", "opencode", "codex"] as AiRuntimeKind[]).map(inspectAgentRuntime)
}
export function resolveAgentRuntimeCommand(kind: AiRuntimeKind) {
  const status = inspectAgentRuntime(kind)
  if (!status.available || !status.executable) throw new Error(status.message)
  return { command: status.executable, args: [], status }
}

/**
 * Return a Grimoire-owned native session directory for a runtime.
 * The directory is intentionally separate from the business database: it only
 * contains the runtime's execution state and is referenced from the session
 * namespace. Callers must still persist the mapping before claiming recovery.
 */
export function agentRuntimeSessionDirectory(kind: 'pi' | 'opencode'): string {
  const root = path.join(app.getPath('userData'), 'agent-runtime-sessions', kind)
  fs.mkdirSync(root, { recursive: true })
  return root
}

async function findFreeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForOpenCodeHealth(endpoint: string, child: ChildProcessWithoutNullStreams, signal?: AbortSignal, getSpawnError?: () => Error | undefined, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = '尚未收到 OpenCode 健康检查响应'
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    const spawnError = getSpawnError?.()
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('OpenCode Runtime 提前退出（code=' + String(child.exitCode) + ', signal=' + String(child.signalCode) + '）')
    }
    try {
      const response = await fetch(endpoint + '/api/health', { signal: AbortSignal.timeout(1500) })
      const value = await response.json().catch(() => ({})) as Record<string, unknown>
      if (response.ok && value.healthy === true) return
      lastError = 'HTTP ' + response.status
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('OpenCode Runtime 健康检查超时：' + lastError)
}

function runtimeConfigKey(provider?: OpenCodeProviderBridge): string {
  const keyFingerprint = provider?.apiKey ? crypto.createHash('sha256').update(provider.apiKey).digest('hex').slice(0, 16) : ''
  return JSON.stringify({ baseUrl: provider?.baseUrl || '', model: provider?.model || '', directory: provider?.directory || '', keyFingerprint })
}

function ownerKey(provider?: OpenCodeProviderBridge): string {
  return provider?.owner?.trim() || 'opencode:' + runtimeConfigKey(provider)
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('OpenCode Runtime 进程退出超时')) }, timeoutMs)
    const onExit = () => { cleanup(); resolve() }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const cleanup = () => { clearTimeout(timer); child.removeListener('exit', onExit); child.removeListener('error', onError) }
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function safeStartupError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('OpenCode Runtime')) return new Error(message)
  if (message.includes('aborted')) return new Error('OpenCode Runtime 启动已取消')
  if (/ENOENT|EACCES|spawn/i.test(message)) return new Error('OpenCode Runtime 子进程启动失败')
  return new Error('OpenCode Runtime 启动失败')
}

async function createManagedOpenCode(provider: OpenCodeProviderBridge | undefined, configKey: string, owner: string, startupSignal: AbortSignal): Promise<ManagedOpenCodeResource> {
  let configDir: string | undefined
  let child: ChildProcessWithoutNullStreams | undefined
  let closePromise: Promise<void> | undefined
  const cleanupConfig = async () => {
    if (!configDir) return
    const directory = configDir
    configDir = undefined
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
  try {
    startupSignal.throwIfAborted()
    if (!provider?.baseUrl || !provider.model) throw new Error('OpenCode Runtime Provider/Model 配置缺失')
    const resolved = resolveAgentRuntimeCommand('opencode')
    if (resolved.status.version !== '1.18.34') throw new Error('OpenCode Runtime 协议版本不受支持')
    const port = await findFreeLoopbackPort()
    const endpoint = 'http://127.0.0.1:' + port
    const providerConfig = provider?.baseUrl && provider?.model
      ? {
          '$schema': 'https://opencode.ai/config.json',
          model: 'grimoire/' + provider.model,
          enabled_providers: ['grimoire'],
          permission: { '*': 'ask', external_directory: 'deny', question: 'deny', task: 'deny', skill: 'deny', plan_enter: 'deny', plan_exit: 'deny' },
          provider: {
            grimoire: {
              name: 'Grimoire temporary provider',
              npm: '@ai-sdk/openai-compatible',
              api: provider.baseUrl,
              options: { baseURL: provider.baseUrl, apiKey: provider.apiKey || '' },
              models: { [provider.model]: { id: provider.model, name: provider.model, tool_call: true } },
            },
          },
        }
      : undefined
    let configPath: string | undefined
    if (providerConfig) {
      configDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-opencode-'))
      configPath = path.join(configDir, 'opencode.json')
      await fs.promises.writeFile(configPath, JSON.stringify(providerConfig, null, 2), { encoding: 'utf8', mode: 0o600 })
    }
    startupSignal.throwIfAborted()
    const runtimeEnv = runtimeProcessEnvironment()
    delete runtimeEnv.OPENCODE_CONFIG_CONTENT
    if (configPath) runtimeEnv.OPENCODE_CONFIG = configPath
    if (configDir) runtimeEnv.OPENCODE_CONFIG_DIR = configDir
    const stateRoot = path.join(agentRuntimeSessionDirectory('opencode'), crypto.createHash('sha256').update(owner).digest('hex'))
    for (const [variable, folder] of Object.entries({ HOME: 'home', USERPROFILE: 'home', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', APPDATA: 'appdata', LOCALAPPDATA: 'localappdata' })) {
      const value = path.join(stateRoot, folder)
      await fs.promises.mkdir(value, { recursive: true })
      runtimeEnv[variable] = value
    }
    const directory = runtimeWorkingDirectory(owner, provider?.directory)
    child = spawn(resolved.command, ['serve', '--pure', '--hostname=127.0.0.1', '--port=' + port], {
      cwd: directory,
      stdio: 'pipe',
      windowsHide: true,
      shell: false,
      env: {
        ...runtimeEnv,
        OPENCODE_CHANNEL: 'dev',
        OPENCODE_VERSION: '1.18.34',
        OPENCODE_DISABLE_MODELS_FETCH: 'true',
        OPENCODE_DISABLE_AUTOUPDATE: 'true',
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
        OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
        OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
      },
    })
    let spawnError: Error | undefined
    child.on('error', error => { spawnError = error })
    const childProcess = child
    const close = async () => {
      if (closePromise) return closePromise
      closePromise = (async () => {
        if (childProcess.exitCode === null && childProcess.signalCode === null) {
          try { childProcess.stdin.end() } catch {}
          try { await waitForChildExit(childProcess, 2_000) }
          catch {
            let killed = false
            try { killed = childProcess.kill() } catch {}
            if (!killed) throw new Error('OpenCode Runtime 无法终止')
            await waitForChildExit(childProcess, 5_000)
          }
        }
        await cleanupConfig()
      })()
      return closePromise
    }
    await waitForOpenCodeHealth(endpoint, childProcess, startupSignal, () => spawnError)
    if (spawnError) throw spawnError
    const resource: ManagedOpenCodeResource = {
      endpoint,
      port,
      executable: resolved.command,
      directory,
      defaultModel: provider?.model ? 'grimoire/' + provider.model : undefined,
      process: childProcess,
      configKey,
      configDir,
      binaryVersion: resolved.status.version || 'unknown',
      close,
      isAlive: () => childProcess.exitCode === null && childProcess.signalCode === null && !spawnError,
    }
    childProcess.once('exit', () => { void cleanupConfig(); void managedOpenCodeLeases.invalidate(owner).catch(() => {}) })
    return resource
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill() } catch {}
      await waitForChildExit(child, 5_000).catch(() => {})
    }
    await cleanupConfig()
    throw safeStartupError(error)
  }
}

export async function acquireOpenCodeRuntimeLease(provider?: OpenCodeProviderBridge): Promise<OpenCodeRuntimeLease> {
  const configKey = runtimeConfigKey(provider)
  const owner = ownerKey(provider)
  const lease = await managedOpenCodeLeases.acquire(owner, configKey, signal => createManagedOpenCode(provider, configKey, owner, signal), provider?.signal)
  return { ...lease.resource, ownerKey: owner, leaseId: lease.id, release: lease.release, close: lease.release }
}

export async function startOpenCodeRuntime(provider?: OpenCodeProviderBridge): Promise<ManagedOpenCodeRuntime> {
  return acquireOpenCodeRuntimeLease(provider)
}

export async function shutdownAgentRuntimes(): Promise<void> {
  await managedOpenCodeLeases.shutdown()
}
