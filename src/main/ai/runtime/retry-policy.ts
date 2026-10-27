/**
 * Retry policy for model calls, driven by the `chat.retry.*` preferences.
 *
 * Grimoire had no retry at all: a transport error yielded `failed` and the turn ended. The
 * source reads these same keys in `aiSdk/retry/retryPolicy.ts`; the clamping below is that
 * file's, and the bounds are exported so a caller cannot silently drift from them.
 *
 * Only the three policy inputs this app can honour are read. The source's fourth,
 * `fallbackModelIds`, names alternative models to try on failure — Grimoire's preferences do
 * not carry that key and the UI that sets it is not mounted, so it is absent rather than
 * defaulted to an empty list that would look like "no fallbacks configured" when the feature
 * does not exist.
 */

/** The source's `MIN_RETRY_ATTEMPTS` / `MAX_RETRY_ATTEMPTS`. */
export const MIN_RETRY_ATTEMPTS = 1
export const MAX_RETRY_ATTEMPTS = 10

export type RetryPolicy = {
  enabled: boolean
  maxAttempts: number
  backoffEnabled: boolean
}

/**
 * Reads the policy from already-resolved preference values.
 *
 * Takes the values rather than reaching for a preference service so the caller decides where
 * they come from — the compat shim stores them under `cherry_pref.*`, and a direct service
 * lookup here would couple this module to that storage layout.
 */
export function readRetryPolicy(values: { enabled?: unknown; maxAttempts?: unknown; backoffEnabled?: unknown }): RetryPolicy {
  const configured = Number(values.maxAttempts)
  // `Number.isFinite` first: `Number(null)` is 0, which would clamp to 1 and silently discard
  // a configured value. The source applies the same guard.
  const finite = Number.isFinite(configured) ? configured : MIN_RETRY_ATTEMPTS
  return {
    enabled: values.enabled === true,
    maxAttempts: Math.min(MAX_RETRY_ATTEMPTS, Math.max(MIN_RETRY_ATTEMPTS, Math.trunc(finite))),
    backoffEnabled: values.backoffEnabled === true
  }
}

/** Delay before attempt `attempt` (1-based). Zero when backoff is off. */
export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  if (!policy.backoffEnabled) return 0
  // Exponential from 500ms, capped at 8s. The cap matters: with `maxAttempts` up to 10 an
  // uncapped doubling would sleep for over 4 minutes on the last attempt, which reads as a
  // hang rather than a retry.
  return Math.min(8000, 500 * 2 ** Math.max(0, attempt - 1))
}

/**
 * True when an error is worth retrying.
 *
 * A provider rejecting the request (400/401/403/404) will reject it again — retrying those
 * burns quota and delays the error the user needs to see. Timeouts, connection failures, rate
 * limits and 5xx are the retryable class.
 */
export function isRetryableError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase()
  if (!message) return false
  // Explicit non-retryable signals first: a 401 body often also contains "timeout" in prose,
  // and the classification must key on the status the provider actually returned.
  if (/\b(400|401|403|404|422)\b/.test(message)) return false
  if (/invalid[_ ]?api[_ ]?key|unauthor|forbidden|not found|bad request/.test(message)) return false
  return /\b(429|500|502|503|504)\b/.test(message)
    || /timeout|timed out|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|rate limit|overloaded/.test(message)
}

/**
 * Wraps a runtime event stream with retry-on-failure.
 *
 * Events are yielded AS THEY ARRIVE — streaming is preserved. An implementation that buffered
 * the whole turn and flushed it at the end was written first and rejected: it would have made
 * every response arrive in one lump, breaking the streaming the UI is built around. The
 * buffer existed to decide whether a retry was safe, but that question has a cheaper answer.
 *
 * RETRY ONLY HAPPENS BEFORE ANYTHING IS EMITTED. Once one event has been yielded the consumer
 * has seen it, so restarting would replay content and the user would read it twice. This is
 * the difference between a retry and a duplicate: `emitted` flips on the first yield and
 * disables retrying for the rest of the call.
 *
 * A `failed` event is not thrown — it is the runtime's normal terminal signal — so it is
 * detected in the stream, not in a `catch`. A THROWN error is caught too, so an adapter that
 * crashes outright is retryable on the same terms.
 */
export async function* withRetry<TEvent extends { type: string }>(
  policy: RetryPolicy,
  run: (attempt: number) => AsyncGenerator<TEvent, void, unknown>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): AsyncGenerator<TEvent, void, unknown> {
  const attempts = policy.enabled ? policy.maxAttempts : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let emitted = false
    let failed: string | null = null
    try {
      for await (const event of run(attempt)) {
        if (event.type === 'failed') {
          failed = String((event as { error?: unknown }).error ?? '')
          break
        }
        emitted = true
        yield event
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error)
    }

    if (failed === null) return
    const lastAttempt = attempt >= attempts
    if (!lastAttempt && !emitted && isRetryableError(new Error(failed))) {
      await sleep(retryDelayMs(policy, attempt))
      continue
    }
    yield { type: 'failed', error: failed } as unknown as TEvent
    return
  }
}
