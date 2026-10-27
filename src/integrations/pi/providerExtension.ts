/**
 * Adapted from Cherry src/main/ai/runtime/pi/providerExtension.ts (AGPL-3.0).
 * Registration factory only. A future approved main session driver must register
 * the same config directly before model selection and bind this on reload.
 * Nothing here discovers, loads, or executes external extensions.
 */
import type { ExtensionAPI, ExtensionFactory, ProviderConfig } from '@earendil-works/pi-coding-agent'

export function createPiProviderExtension(providerName: string, providerConfig: ProviderConfig): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerProvider(providerName, providerConfig)
  }
}
