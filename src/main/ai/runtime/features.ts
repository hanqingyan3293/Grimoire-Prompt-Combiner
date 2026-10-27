export type RuntimeFeatureFlags = Readonly<{
  piSdk: boolean
  openCodeReplay: boolean
  nativeSessionOperations: boolean
}>

/** Main-process opt-ins only. Renderer session data is never a feature authority. */
export function readRuntimeFeatureFlags(env: NodeJS.ProcessEnv = process.env): RuntimeFeatureFlags {
  return Object.freeze({
    piSdk: env.GRIMOIRE_PI_SDK_RUNTIME === '1',
    openCodeReplay: env.GRIMOIRE_OPENCODE_REPLAY === '1',
    nativeSessionOperations: env.GRIMOIRE_NATIVE_SESSION_OPERATIONS === '1',
  })
}

export class RuntimeCapabilityUnavailableError extends Error {
  readonly code = 'RUNTIME_CAPABILITY_UNAVAILABLE'
  constructor(readonly capability: string, reason: string) {
    super(reason)
    this.name = 'RuntimeCapabilityUnavailableError'
  }
}
