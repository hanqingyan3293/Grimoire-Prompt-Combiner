import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'D:/runtime-safety-test' } }))
import { runtimeProcessEnvironment } from './agent-runtime-safety.service'

describe('native runtime process environment', () => {
  it('passes required OS variables and excludes unrelated credentials and runtime overrides', () => {
    const source = {
      PATH: 'C:/Windows/System32',
      SystemRoot: 'C:/Windows',
      TEMP: 'C:/Temp',
      OPENAI_API_KEY: 'must-not-inherit',
      ANTHROPIC_API_KEY: 'must-not-inherit',
      PI_CODING_AGENT_DIR: 'user-controlled',
      OPENCODE_CONFIG: 'user-controlled',
      HOME: 'user-profile',
    }
    expect(runtimeProcessEnvironment(source)).toEqual({ PATH: 'C:/Windows/System32', SystemRoot: 'C:/Windows', TEMP: 'C:/Temp' })
  })
})
