import { describe, expect, it } from 'vitest'

import { MAX_RETRY_ATTEMPTS, MIN_RETRY_ATTEMPTS, isRetryableError, readRetryPolicy, retryDelayMs, withRetry } from './retry-policy'

describe('readRetryPolicy', () => {
  it('reads the three keys and clamps attempts to the source bounds', () => {
    expect(readRetryPolicy({ enabled: true, maxAttempts: 3, backoffEnabled: true }))
      .toEqual({ enabled: true, maxAttempts: 3, backoffEnabled: true })
    // The source clamps to [1, 10]; a value outside that is brought in, not rejected.
    expect(readRetryPolicy({ maxAttempts: 0 }).maxAttempts).toBe(MIN_RETRY_ATTEMPTS)
    expect(readRetryPolicy({ maxAttempts: 999 }).maxAttempts).toBe(MAX_RETRY_ATTEMPTS)
    expect(readRetryPolicy({ maxAttempts: 4.7 }).maxAttempts).toBe(4)
  })

  it('falls back to the minimum when the value is not a finite number', () => {
    // `Number(null)` is 0 — a blind coercion would clamp 0 to 1 anyway, so this asserts the
    // guard rather than the clamp: an absent preference must not be read as "configured 0".
    expect(readRetryPolicy({}).maxAttempts).toBe(MIN_RETRY_ATTEMPTS)
    expect(readRetryPolicy({ maxAttempts: null }).maxAttempts).toBe(MIN_RETRY_ATTEMPTS)
    expect(readRetryPolicy({ maxAttempts: 'abc' }).maxAttempts).toBe(MIN_RETRY_ATTEMPTS)
  })

  it('treats only an explicit true as enabled', () => {
    // The shim JSON-encodes values, so a string "true" or a 1 must not silently enable retry.
    expect(readRetryPolicy({ enabled: 'true' }).enabled).toBe(false)
    expect(readRetryPolicy({ enabled: 1 }).enabled).toBe(false)
    expect(readRetryPolicy({ enabled: true }).enabled).toBe(true)
  })
})

describe('retryDelayMs', () => {
  it('is zero when backoff is off', () => {
    expect(retryDelayMs({ enabled: true, maxAttempts: 3, backoffEnabled: false }, 1)).toBe(0)
    expect(retryDelayMs({ enabled: true, maxAttempts: 3, backoffEnabled: false }, 5)).toBe(0)
  })

  it('doubles from 500ms and is capped, so the last attempt cannot look like a hang', () => {
    const policy = { enabled: true, maxAttempts: 10, backoffEnabled: true }
    expect(retryDelayMs(policy, 1)).toBe(500)
    expect(retryDelayMs(policy, 2)).toBe(1000)
    expect(retryDelayMs(policy, 3)).toBe(2000)
    // Uncapped doubling at attempt 10 would be ~4 minutes; the cap is what keeps a retrying
    // turn from reading as frozen.
    expect(retryDelayMs(policy, 10)).toBe(8000)
    expect(retryDelayMs(policy, 99)).toBe(8000)
  })
})

describe('isRetryableError', () => {
  it('retries transport and server-side failures', () => {
    for (const message of [
      'fetch failed',
      'socket hang up',
      'ECONNRESET',
      'connect ECONNREFUSED 127.0.0.1:10100',
      'Request timed out',
      '429 Too Many Requests',
      'rate limit exceeded',
      '503 Service Unavailable',
      '502 Bad Gateway'
    ]) {
      expect(isRetryableError(new Error(message)), message).toBe(true)
    }
  })

  it('does NOT retry client errors a repeat cannot fix', () => {
    // Retrying these burns quota and delays the message the user needs to read.
    for (const message of [
      '401 Unauthorized',
      'Invalid API key provided',
      '403 Forbidden',
      '404 model not found',
      '400 Bad Request: invalid temperature',
      '422 Unprocessable Entity'
    ]) {
      expect(isRetryableError(new Error(message)), message).toBe(false)
    }
  })

  it('classifies by status before prose, because a 401 body can mention a timeout', () => {
    // The order matters: an explicit client status wins even when retryable-sounding words
    // appear in the same message.
    expect(isRetryableError(new Error('401 Unauthorized: request timed out waiting for upstream'))).toBe(false)
  })

  it('does not retry an empty or unknown error', () => {
    expect(isRetryableError(new Error(''))).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
    expect(isRetryableError(new Error('something unexpected'))).toBe(false)
  })
})

describe('withRetry', () => {
  const policy = (overrides: Partial<{ enabled: boolean; maxAttempts: number; backoffEnabled: boolean }> = {}) => ({
    enabled: true, maxAttempts: 3, backoffEnabled: false, ...overrides
  })
  const noSleep = async () => {}

  async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of gen) out.push(item)
    return out
  }

  it('retries a retryable failure that produced no output, and succeeds on a later attempt', async () => {
    let calls = 0
    const run = async function* () {
      calls += 1
      if (calls < 3) { yield { type: 'failed', error: 'fetch failed' }; return }
      yield { type: 'text-delta', text: 'ok' }
      yield { type: 'completed', text: 'ok' }
    }
    const events = await collect(withRetry(policy(), run, noSleep))
    expect(calls).toBe(3)
    expect(events).toEqual([{ type: 'text-delta', text: 'ok' }, { type: 'completed', text: 'ok' }])
  })

  it('does NOT retry once anything has been emitted — a replay would duplicate content', async () => {
    let calls = 0
    const run = async function* () {
      calls += 1
      yield { type: 'text-delta', text: 'partial' }
      yield { type: 'failed', error: 'fetch failed' }
    }
    const events = await collect(withRetry(policy(), run, noSleep))
    // One call, and the partial text appears exactly once.
    expect(calls).toBe(1)
    expect(events).toEqual([{ type: 'text-delta', text: 'partial' }, { type: 'failed', error: 'fetch failed' }])
  })

  it('streams as it goes rather than buffering the turn', async () => {
    // The rejected first implementation buffered the whole turn and flushed at the end. This
    // asserts the consumer sees the first event BEFORE the generator has produced the second.
    const seen: string[] = []
    const run = async function* () {
      seen.push('produced:first')
      yield { type: 'text-delta', text: 'a' }
      seen.push('produced:second')
      yield { type: 'text-delta', text: 'b' }
    }
    for await (const event of withRetry(policy(), run, noSleep)) {
      seen.push('consumed:' + (event as { text?: string }).text)
    }
    expect(seen).toEqual(['produced:first', 'consumed:a', 'produced:second', 'consumed:b'])
  })

  it('does not retry a non-retryable failure', async () => {
    let calls = 0
    const run = async function* () {
      calls += 1
      yield { type: 'failed', error: '401 Unauthorized' }
    }
    const events = await collect(withRetry(policy(), run, noSleep))
    expect(calls).toBe(1)
    expect(events).toEqual([{ type: 'failed', error: '401 Unauthorized' }])
  })

  it('gives up after maxAttempts and reports the last failure', async () => {
    let calls = 0
    const run = async function* () {
      calls += 1
      yield { type: 'failed', error: 'connect ECONNREFUSED' }
    }
    const events = await collect(withRetry(policy({ maxAttempts: 3 }), run, noSleep))
    expect(calls).toBe(3)
    expect(events).toEqual([{ type: 'failed', error: 'connect ECONNREFUSED' }])
  })

  it('makes exactly one attempt when the policy is disabled', async () => {
    let calls = 0
    const run = async function* () {
      calls += 1
      yield { type: 'failed', error: 'fetch failed' }
    }
    await collect(withRetry(policy({ enabled: false }), run, noSleep))
    expect(calls).toBe(1)
  })

  it('retries a THROWN error, since some adapters crash instead of yielding failed', async () => {
    let calls = 0
    const run = async function* () {
      calls += 1
      if (calls === 1) throw new Error('socket hang up')
      yield { type: 'completed', text: 'ok' }
    }
    const events = await collect(withRetry(policy(), run, noSleep))
    expect(calls).toBe(2)
    expect(events).toEqual([{ type: 'completed', text: 'ok' }])
  })

  it('waits between attempts using the backoff schedule', async () => {
    const waits: number[] = []
    const run = async function* () { yield { type: 'failed', error: 'fetch failed' } }
    await collect(withRetry(policy({ maxAttempts: 3, backoffEnabled: true }), run, async ms => { waits.push(ms) }))
    // Two waits for three attempts, following the schedule rather than a fixed delay.
    expect(waits).toEqual([500, 1000])
  })
})
