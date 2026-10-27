/**
 * Adapted from Cherry src/main/ai/runtime/pi/piSdk.ts (AGPL-3.0).
 * Pi itself is MIT; see src/vendor/pi/source/LICENSE.
 *
 * Grimoire's tsc MAIN target is CommonJS, unlike Cherry's bundler: a normal
 * dynamic import is rewritten to require(). Keep the fixed imports inside
 * native JavaScript functions so the emitted module honors Pi's import-only
 * exports. No caller-controlled specifier, CLI, session, or extension loading.
 * Import success is a dependency gate, NOT runtime execution approval.
 */
import type * as PiSdk from '@earendil-works/pi-coding-agent'
import type * as PiAi from '@earendil-works/pi-ai'

const importSdk = new Function('return import("@earendil-works/pi-coding-agent")') as () => Promise<typeof PiSdk>
const importAi = new Function('return import("@earendil-works/pi-ai")') as () => Promise<typeof PiAi>

export function loadPiSdk(): Promise<typeof PiSdk> {
  return importSdk()
}

export function loadPiAi(): Promise<typeof PiAi> {
  return importAi()
}

export type PiSdkSurfaceReport = {
  loaded: boolean
  esmOnly: true
  hasCreateAgentSession: boolean
  hasCreateAgentSessionServices: boolean
  hasAgentSessionRuntime: boolean
  hasSessionManager: boolean
  hasDefaultResourceLoader: boolean
  hasModelRuntime: boolean
  typeContracts: 'compile-time-only'
  notes: string[]
  error?: string
}

/**
 * Main-only dependency gate. This deliberately does not create a session,
 * read auth/models files, load extensions, or contact a provider. Export
 * presence is evidence for the next gate only, never production parity.
 */
export async function inspectPiSdkSurface(): Promise<PiSdkSurfaceReport> {
  try {
    const sdk = await loadPiSdk() as Record<string, unknown>
    const ai = await loadPiAi() as Record<string, unknown>
    return {
      loaded: true,
      esmOnly: true,
      hasCreateAgentSession: typeof sdk.createAgentSession === 'function',
      hasCreateAgentSessionServices: typeof sdk.createAgentSessionServices === 'function',
      hasAgentSessionRuntime: typeof sdk.createAgentSessionRuntime === 'function',
      hasSessionManager: typeof sdk.SessionManager === 'object' || typeof sdk.SessionManager === 'function',
      hasDefaultResourceLoader: typeof sdk.DefaultResourceLoader === 'function',
      hasModelRuntime: typeof sdk.ModelRuntime === 'object' || typeof sdk.ModelRuntime === 'function' || typeof ai.ModelRuntime === 'object' || typeof ai.ModelRuntime === 'function',
      typeContracts: 'compile-time-only',
      notes: [
        'No production SDK consumer is enabled by this probe.',
        'Credential/profile/resource/tool/permission lifecycle remains unverified until a feature-gated fake-provider adapter passes.',
      ],
    }
  } catch (error) {
    return {
      loaded: false,
      esmOnly: true,
      hasCreateAgentSession: false,
      hasCreateAgentSessionServices: false,
      hasAgentSessionRuntime: false,
      hasSessionManager: false,
      hasDefaultResourceLoader: false,
      hasModelRuntime: false,
      typeContracts: 'compile-time-only',
      notes: ['Pi SDK DIRECT_REUSE remains blocked until the ESM dependency gate loads.'],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
