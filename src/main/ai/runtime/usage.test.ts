import { describe, expect, it } from 'vitest'

import { __usageTest } from './openai-compatible.runtime'

const { chatCompletionUsage, responseApiUsage } = __usageTest

/**
 * Both wire shapes must normalize to the SAME event, because the usage UI must not branch on
 * which protocol produced a number — that is the project's rule that behaviour is not decided
 * by runtime/provider name.
 */
describe('usage normalization', () => {
  it('normalizes a Chat Completions usage object', () => {
    expect(chatCompletionUsage({
      prompt_tokens: 1200,
      completion_tokens: 340,
      total_tokens: 1540,
      prompt_tokens_details: { cached_tokens: 900 }
    })).toEqual({ type: 'usage', inputTokens: 1200, outputTokens: 340, cachedTokens: 900 })
  })

  it('normalizes a Responses API usage object to the same shape', () => {
    expect(responseApiUsage({
      input_tokens: 1200,
      output_tokens: 340,
      total_tokens: 1540,
      input_tokens_details: { cached_tokens: 900 }
    })).toEqual({ type: 'usage', inputTokens: 1200, outputTokens: 340, cachedTokens: 900 })
  })

  it('answers null — not zeros — when a provider reports no usage', () => {
    // A provider that reports nothing must not look like one that reported zero tokens: the
    // UI distinguishes "no data" from "0", and a fabricated 0 would render as a real reading.
    expect(chatCompletionUsage(undefined)).toBeNull()
    expect(chatCompletionUsage(null)).toBeNull()
    expect(chatCompletionUsage({})).toBeNull()
    expect(responseApiUsage(undefined)).toBeNull()
    expect(responseApiUsage({})).toBeNull()
  })

  it('omits cachedTokens when the provider has no cache details', () => {
    // Absent, not 0 — a 0 would read as "cache never used", which is a different claim.
    expect(chatCompletionUsage({ prompt_tokens: 10, completion_tokens: 5 }))
      .toEqual({ type: 'usage', inputTokens: 10, outputTokens: 5 })
    expect(responseApiUsage({ input_tokens: 10, output_tokens: 5 }))
      .toEqual({ type: 'usage', inputTokens: 10, outputTokens: 5 })
  })

  it('keeps partial usage rather than discarding the whole object', () => {
    // Some providers report only one side; dropping the event would lose the number they did send.
    expect(chatCompletionUsage({ prompt_tokens: 42 })).toEqual({ type: 'usage', inputTokens: 42 })
    expect(responseApiUsage({ output_tokens: 7 })).toEqual({ type: 'usage', outputTokens: 7 })
  })

  it('ignores non-numeric and malformed values instead of coercing them', () => {
    // `Number('abc')` is NaN; coercing through would store a value the provider never sent.
    expect(chatCompletionUsage({ prompt_tokens: 'abc', completion_tokens: null })).toBeNull()
    expect(chatCompletionUsage({ prompt_tokens_details: 'nope', prompt_tokens: 5 }))
      .toEqual({ type: 'usage', inputTokens: 5 })
  })

  it('treats a zero reading as a real reading, not as absent', () => {
    // 0 is a legitimate count; only `undefined`/unparseable means "no data".
    expect(chatCompletionUsage({ prompt_tokens: 0, completion_tokens: 0 }))
      .toEqual({ type: 'usage', inputTokens: 0, outputTokens: 0 })
  })
})
