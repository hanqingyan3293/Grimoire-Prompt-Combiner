/**
 * Message-count truncation for the `chat.context_settings.*` preferences.
 *
 * Grimoire previously sent the entire history on every request — the model catalog carries a
 * `contextWindow` per model but nothing consulted it, and nothing bounded the message list.
 * This implements the half the preferences actually describe with the data Grimoire has.
 *
 * IMPLEMENTED: `enabled` and `maxMessages`. When enabled with a finite `maxMessages`, the
 * oldest messages are dropped so the newest `maxMessages` survive.
 *
 * NOT IMPLEMENTED, and deliberately not approximated:
 *  - `truncate_threshold` — the source measures it against the model's context window in
 *    tokens. Grimoire has no tokenizer, and estimating tokens from character counts would
 *    drop the wrong amount while looking precise. The message-count limit achieves the same
 *    user-visible effect with a bound this app can actually honour.
 *  - `compress.*` — the source's compression asks a separate model to summarize the dropped
 *    history and persists the summary. That is a whole subsystem (compression-model
 *    resolution, compaction events, persisted summaries); a half-built version would either
 *    lose conversation content silently or claim a summary it never produced.
 */

export type ContextSettings = {
  enabled: boolean
  maxMessages: number | null
}

/**
 * Canonical bounds for `maxMessages`.
 *
 * A limit of 0 or negative would send a conversation with no history at all — a silent,
 * confusing failure — so the floor is 1. The ceiling keeps a hand-edited preference from
 * producing a limit so large it is indistinguishable from "unlimited" while claiming to be a
 * limit.
 */
export const MIN_MAX_MESSAGES = 1
export const MAX_MAX_MESSAGES = 1000

/**
 * Reads the settings from already-resolved preference values.
 *
 * `null`/absent `maxMessages` means "no limit" — that is the source's own default
 * (`chat.context_settings.max_messages: null`), and it is NOT the same as 0. Coercing null to
 * 0 here would silently drop the entire history for every user who never touched the setting.
 */
export function readContextSettings(values: { enabled?: unknown; maxMessages?: unknown }): ContextSettings {
  // Only an explicit `true` enables trimming. The shim JSON-encodes values, so a stored
  // `"true"` or `1` must not switch it on.
  const enabled = values.enabled === true
  if (values.maxMessages === null || values.maxMessages === undefined || values.maxMessages === '') {
    return { enabled, maxMessages: null }
  }
  const parsed = typeof values.maxMessages === 'number' ? values.maxMessages : Number(values.maxMessages)
  if (!Number.isFinite(parsed)) return { enabled, maxMessages: null }
  const truncated = Math.trunc(parsed)
  if (truncated <= 0) return { enabled, maxMessages: null }
  return { enabled, maxMessages: Math.min(MAX_MAX_MESSAGES, Math.max(MIN_MAX_MESSAGES, truncated)) }
}

/**
 * Applies the limit to a message list, keeping the NEWEST messages.
 *
 * The newest are kept because a conversation's recent turns are what the next reply depends
 * on; dropping from the front loses the least relevant context.
 *
 * Two properties this must preserve, and does:
 *  - an unmodified list is returned BY REFERENCE when no trimming is needed, so callers can
 *    cheaply detect "nothing changed" and tests can assert it;
 *  - the newest message is never dropped. A limit that would empty the list is treated as
 *    "not applied", because sending a request with no messages at all is not a valid
 *    truncation of a conversation — it is a different request.
 */
export function applyMessageLimit<T>(messages: readonly T[], settings: ContextSettings): readonly T[] {
  const { enabled, maxMessages } = settings
  if (!enabled || maxMessages === null) return messages
  if (messages.length <= maxMessages) return messages
  if (maxMessages < 1) return messages
  return messages.slice(messages.length - maxMessages)
}
