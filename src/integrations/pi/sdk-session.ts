/** Main-only Pi 1.0.1 DIRECT_REUSE boundary. No CLI, user profile or discovery. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  AgentSessionRuntime, AgentSessionServices, CreateAgentSessionRuntimeFactory,
  Extension, ModelRuntime, ResourceLoader, SessionManager, ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { PiProviderInjection } from './modelInjection'
import { loadPiAi, loadPiSdk } from './piSdk'

const PROVENANCE = 'grimoire.pi-sdk.execution.v1'
const CHECKPOINT = 'grimoire.pi-sdk.checkpoint.v1'
export const PI_SDK_VERSION = '1.0.1' as const

/** Execution-state reference, never a renderer-supplied path or a business store. */
export interface PiSdkSessionReference {
  schema: 1
  sdkVersion: typeof PI_SDK_VERSION
  ownerId: string
  localSessionId: string
  cwd: string
  configFingerprint: string
  nativeSessionId: string
  sessionFile: string
  checkpointId: string
  historyDigest: string
  nativeStateDigest: string
  parentSessionFile?: string
}

export interface PiSdkSessionOptions {
  ownerId: string
  localSessionId: string
  cwd: string
  configFingerprint: string
  injection: PiProviderInjection
  systemPrompt: string
  customTools: ToolDefinition[]
  /** Existing canonical main-owned root. No default ~/.pi storage is permitted. */
  executionStateDir?: string
  reference?: PiSdkSessionReference
  /** Exact public SessionManager.forkFrom: full source history, not an entry fork. */
  forkFrom?: PiSdkSessionReference
}

export interface PiSdkSessionHandle {
  runtime: AgentSessionRuntime
  checkpoint(historyDigest: string): PiSdkSessionReference | undefined
  dispose(): Promise<void>
}

export function piSdkDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function redactPiSdkValue<T>(value: T, secrets: readonly string[]): T {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'string') return item
    for (const secret of secrets) if (secret) item = (item as string).replaceAll(secret, '[REDACTED]')
    return item
  })) as T
}

/** Preserve the native stream's result/error semantics, sanitizing public values
 * before AgentSession or the source compactor can persist provider diagnostics. */
function redactStream<T extends AsyncIterable<unknown> & { result(): Promise<unknown> }>(stream: T, secrets: readonly string[]): T {
  return new Proxy(stream, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return async function* () {
        for await (const event of target) yield redactPiSdkValue(event, secrets)
      }
      if (property === 'result') return async () => redactPiSdkValue(await target.result(), secrets)
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * DefaultResourceLoader.reload still resolves packages and explicit extension paths
 * in 1.0.1. Implement its public ResourceLoader port instead: only an empty source
 * extension runtime and a main-owned literal system prompt can enter the session.
 */
export async function createPiSdkResourceLoader(systemPrompt: string, secrets: readonly string[] = []): Promise<ResourceLoader> {
  const sdk = await loadPiSdk()
  const scrub = (value: unknown): unknown => redactPiSdkValue(value, secrets)
  // Trusted in-memory host hook, not discovered extension code. 1.0.1's public
  // message_end replacement runs before canonical SessionManager persistence.
  const boundary: Extension = {
    path: '<grimoire:pi-sdk-boundary>', resolvedPath: '<grimoire:pi-sdk-boundary>',
    sourceInfo: sdk.createSyntheticSourceInfo('<grimoire:pi-sdk-boundary>', { source: 'grimoire' }),
    handlers: new Map([['message_end', [async (event: unknown) => ({ message: scrub((event as { message: unknown }).message) })]]]),
    tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map(),
  }
  const extensions = { extensions: [boundary], errors: [], runtime: sdk.createExtensionRuntime() }
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => { throw new Error('Pi SDK external resources are disabled') },
    reload: async () => { throw new Error('Pi SDK resource reload is disabled') },
  }
}

function canonicalDirectory(path: string): string {
  if (!isAbsolute(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
    throw new Error('Pi SDK requires an existing main-owned canonical directory')
  }
  const canonical = realpathSync(path)
  if (resolve(path) !== canonical) throw new Error('Pi SDK directory aliases are not permitted')
  return canonical
}

function sessionDirectory(root: string, ownerId: string, localSessionId: string): string {
  let path = canonicalDirectory(root)
  for (const part of ['pi-sdk', piSdkDigest(ownerId), piSdkDigest(localSessionId)]) {
    path = join(path, part)
    if (!existsSync(path)) mkdirSync(path)
    canonicalDirectory(path)
  }
  return path
}

export async function createPiSdkSession(options: PiSdkSessionOptions): Promise<PiSdkSessionHandle> {
  const { ownerId, localSessionId, configFingerprint, systemPrompt, customTools, injection } = options
  if (!ownerId || !localSessionId || !/^[a-f0-9]{64}$/.test(configFingerprint)) {
    throw new Error('Pi SDK execution identity is required')
  }
  if (injection.api === 'azure-openai-responses' || Object.keys(injection.requestEnvironment ?? {}).length) {
    // ModelRuntime has no per-session environment injection port. Never mutate process.env.
    throw new Error('Pi SDK requestEnvironment/Azure injection is not supported')
  }
  const cwd = canonicalDirectory(options.cwd)
  const sdk = await loadPiSdk()
  if (sdk.VERSION !== PI_SDK_VERSION) throw new Error('Pi SDK adapter requires installed version 1.0.1')
  const ai = await loadPiAi()
  const credentials = new ai.InMemoryCredentialStore()
  const modelRuntime: ModelRuntime = await sdk.ModelRuntime.create({
    credentials, modelsStore: new ai.InMemoryModelsStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  })
  // These public instance methods are the sole provider paths used by both
  // AgentSession and its native compactor. Wrapping does not replace the loop,
  // provider, routing, compaction or session semantics.
  const secrets = [injection.apiKey, ...Object.values(injection.providerConfig.headers ?? {})]
  const streamSimple = modelRuntime.streamSimple.bind(modelRuntime)
  modelRuntime.streamSimple = (...args: Parameters<ModelRuntime['streamSimple']>) => redactStream(streamSimple(...args), secrets)
  const stream = modelRuntime.stream.bind(modelRuntime)
  modelRuntime.stream = (model, context, requestOptions) => redactStream(stream(model, context, requestOptions), secrets)
  let runtime: AgentSessionRuntime | undefined
  const providerName = injection.providerName
  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => disposePromise ??= (async () => {
    try {
      if (runtime) {
        await runtime.session.abort()
        await runtime.dispose()
      }
    } finally {
      try {
        await modelRuntime.removeRuntimeApiKey(providerName)
      } finally {
        modelRuntime.unregisterProvider(providerName)
        await credentials.delete(providerName)
        secrets.splice(0)
      }
    }
  })()
  try {
    // Same registration config as providerExtension.ts. Register directly before
    // selecting a model; loading even an inline extension is unnecessary here.
    modelRuntime.registerProvider(providerName, injection.providerConfig)
    await modelRuntime.setRuntimeApiKey(providerName, injection.apiKey)
    const model = modelRuntime.getModel(providerName, injection.modelId)
    if (!model || model.provider !== providerName || model.id !== injection.modelId) {
      throw new Error('Pi SDK selected model is unavailable')
    }
    const directory = options.executionStateDir
      ? sessionDirectory(options.executionStateDir, ownerId, localSessionId) : undefined
    const provenance = { sdkVersion: PI_SDK_VERSION, ownerId, localSessionId, cwd, configFingerprint }
    const openReference = (ref: PiSdkSessionReference, expectedLocalId: string) => {
      const expectedDirectory = options.executionStateDir
        ? sessionDirectory(options.executionStateDir, ownerId, expectedLocalId) : undefined
      if (!expectedDirectory || ref.schema !== 1 || ref.sdkVersion !== PI_SDK_VERSION ||
        ref.ownerId !== ownerId || ref.localSessionId !== expectedLocalId || ref.cwd !== cwd ||
        ref.configFingerprint !== configFingerprint || !/^[a-f0-9]{64}$/.test(ref.historyDigest) ||
        !isAbsolute(ref.sessionFile) || dirname(ref.sessionFile) !== expectedDirectory ||
        basename(ref.sessionFile) !== ref.sessionFile.slice(expectedDirectory.length + 1) ||
        !lstatSync(ref.sessionFile).isFile() || lstatSync(ref.sessionFile).size > 32 * 1024 * 1024 || lstatSync(ref.sessionFile).isSymbolicLink() ||
        realpathSync(ref.sessionFile) !== ref.sessionFile ||
        createHash('sha256').update(readFileSync(ref.sessionFile)).digest('hex') !== ref.nativeStateDigest) {
        throw new Error('Pi SDK native session provenance mismatch')
      }
      // Exact public source resume semantics; never continueRecent or an ID search.
      const opened = sdk.SessionManager.open(ref.sessionFile, expectedDirectory)
      const header = opened.getHeader()
      const stored = [...opened.getEntries()].reverse().find(entry => entry.type === 'custom' && entry.customType === PROVENANCE)
      const leaf = opened.getLeafEntry()
      const expectedProvenance = { ...provenance, localSessionId: expectedLocalId }
      if (!header || header.id !== ref.nativeSessionId || header.cwd !== cwd ||
        header.version !== sdk.CURRENT_SESSION_VERSION || header.parentSession !== ref.parentSessionFile ||
        !stored || stored.type !== 'custom' || JSON.stringify(stored.data) !== JSON.stringify(expectedProvenance) ||
        !leaf || leaf.id !== ref.checkpointId || leaf.type !== 'custom' || leaf.customType !== CHECKPOINT ||
        (leaf.data as { historyDigest?: string } | undefined)?.historyDigest !== ref.historyDigest) {
        throw new Error('Pi SDK native session header/checkpoint mismatch')
      }
      return opened
    }
    let manager: SessionManager
    if (options.reference && options.forkFrom) throw new Error('Pi SDK resume and fork are mutually exclusive')
    if (options.reference) {
      manager = openReference(options.reference, localSessionId)
    } else if (options.forkFrom) {
      if (!directory || options.forkFrom.localSessionId === localSessionId) throw new Error('Pi SDK fork requires a new local identity')
      openReference(options.forkFrom, options.forkFrom.localSessionId)
      // Full-history fork is exactly the public source operation. It writes a
      // new native ID/file/parent header and never changes the parent's leaf.
      manager = sdk.SessionManager.forkFrom(options.forkFrom.sessionFile, cwd, directory)
      manager.appendCustomEntry(PROVENANCE, provenance)
    } else {
      manager = directory ? sdk.SessionManager.create(cwd, directory) : sdk.SessionManager.inMemory(cwd)
      manager.appendCustomEntry(PROVENANCE, provenance)
    }
    const factory: CreateAgentSessionRuntimeFactory = async target => {
      // AgentSessionServices' default constructor always creates a discovering
      // loader. Compose the public services port with the restricted loader instead.
      if (target.cwd !== cwd || target.sessionManager !== manager) {
        throw new Error('Pi SDK session replacement requires a separate host-owned runtime')
      }
      const services: AgentSessionServices = {
        cwd, agentDir: directory ?? cwd, modelRuntime,
        settingsManager: sdk.SettingsManager.inMemory({
          packages: [], extensions: [], skills: [], prompts: [], themes: [],
          enableSkillCommands: false, defaultTools: [], cacheWarming: 'off',
          compaction: { enabled: false }, retry: { enabled: false },
          httpIdleTimeoutMs: 30_000, enableAnalytics: false, enableInstallTelemetry: false,
          transport: 'sse',
        }),
        resourceLoader: await createPiSdkResourceLoader(systemPrompt, [injection.apiKey, ...Object.values(injection.providerConfig.headers ?? {})]), diagnostics: [],
      }
      const result = await sdk.createAgentSessionFromServices({
        services, sessionManager: manager, model, thinkingLevel: 'off',
        noTools: 'all', tools: customTools.map(tool => tool.name), customTools,
      })
      return { ...result, services, diagnostics: [] }
    }
    runtime = await sdk.createAgentSessionRuntime(factory, {
      cwd, agentDir: directory ?? cwd, sessionManager: manager,
    })
    // Neither native tools nor externally restored tool-loadout entries may escape
    // the constructor allowlist. Check the actual source session, not config alone.
    const actualTools = [...runtime.session.getActiveToolNames(), ...runtime.session.getCallableToolNames()]
    if (actualTools.some(name => !customTools.some(tool => tool.name === name))) {
      throw new Error('Pi SDK restored an unapproved tool')
    }
    const result: PiSdkSessionHandle = {
      runtime,
      checkpoint(historyDigest) {
        if (disposePromise || !runtime?.session.isIdle) throw new Error('Pi SDK checkpoint requires an idle live session')
        if (!directory) return undefined
        const checkpointId = manager.appendCustomEntry(CHECKPOINT, { historyDigest })
        const sessionFile = manager.getSessionFile()
        if (!sessionFile || !existsSync(sessionFile)) throw new Error('Pi SDK did not persist native execution state')
        return {
          schema: 1, ...provenance, nativeSessionId: manager.getSessionId(),
          sessionFile, checkpointId, historyDigest,
          nativeStateDigest: createHash('sha256').update(readFileSync(sessionFile)).digest('hex'),
          ...(manager.getHeader()?.parentSession ? { parentSessionFile: manager.getHeader()!.parentSession } : {}),
        }
      },
      dispose,
    }
    return result
  } catch {
    await dispose().catch(() => undefined)
    // Provider and filesystem exceptions can contain request headers or profile
    // contents. Do not let opaque third-party diagnostics cross the host boundary.
    throw new Error('Pi SDK session setup failed (version, model or native provenance gate)')
  }
}
