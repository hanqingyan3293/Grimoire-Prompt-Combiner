import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime, registerBuiltInAgentRuntimes } from './registry'

describe('runtime registry native preparation flags', () => {
  beforeEach(() => registerBuiltInAgentRuntimes())

  it('forwards the main-owned OpenCode policy and session-operation gates', () => {
    const runtime = createAgentRuntime('opencode', {
      endpoint: 'http://127.0.0.1:4096',
      model: 'grimoire/model',
      nativeToolPolicy: 'ask',
      enableNativeSessionOperations: true,
    }) as unknown as { nativeToolPolicy: string; enableNativeSessionOperations: boolean }
    expect(runtime.nativeToolPolicy).toBe('ask')
    expect(runtime.enableNativeSessionOperations).toBe(true)
  })
})
