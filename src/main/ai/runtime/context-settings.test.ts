import { describe, expect, it } from 'vitest'

import { MAX_MAX_MESSAGES, applyMessageLimit, readContextSettings } from './context-settings'

describe('readContextSettings', () => {
  it('treats null/absent maxMessages as UNLIMITED, not as zero', () => {
    // The source default is `maxMessages: null`. Coercing it to 0 would drop the entire
    // history for every user who never touched the setting — a silent, total failure.
    expect(readContextSettings({}).maxMessages).toBeNull()
    expect(readContextSettings({ maxMessages: null }).maxMessages).toBeNull()
    expect(readContextSettings({ maxMessages: '' }).maxMessages).toBeNull()
    expect(readContextSettings({ maxMessages: 'abc' }).maxMessages).toBeNull()
  })

  it('treats a non-positive limit as unlimited rather than as "send nothing"', () => {
    expect(readContextSettings({ maxMessages: 0 }).maxMessages).toBeNull()
    expect(readContextSettings({ maxMessages: -5 }).maxMessages).toBeNull()
  })

  it('clamps a positive limit into the supported range', () => {
    expect(readContextSettings({ maxMessages: 20 }).maxMessages).toBe(20)
    expect(readContextSettings({ maxMessages: 20.9 }).maxMessages).toBe(20)
    expect(readContextSettings({ maxMessages: 99999 }).maxMessages).toBe(MAX_MAX_MESSAGES)
  })

  it('requires an explicit true to enable trimming', () => {
    // Values arrive JSON-encoded through the compat shim; a stored "true" is a string.
    expect(readContextSettings({ enabled: 'true' }).enabled).toBe(false)
    expect(readContextSettings({ enabled: 1 }).enabled).toBe(false)
    expect(readContextSettings({ enabled: true }).enabled).toBe(true)
  })
})

describe('applyMessageLimit', () => {
  const messages = ['m1', 'm2', 'm3', 'm4', 'm5']

  it('returns the SAME reference when nothing needs trimming', () => {
    // Callers use identity to detect "unchanged"; a copy would defeat that and allocate on
    // every request.
    const settings = { enabled: true, maxMessages: 10 }
    expect(applyMessageLimit(messages, settings)).toBe(messages)
    expect(applyMessageLimit(messages, { enabled: false, maxMessages: 2 })).toBe(messages)
    expect(applyMessageLimit(messages, { enabled: true, maxMessages: null })).toBe(messages)
  })

  it('keeps the NEWEST messages when trimming', () => {
    // Recent turns are what the next reply depends on; dropping from the front loses the
    // least relevant context.
    const result = applyMessageLimit(messages, { enabled: true, maxMessages: 2 })
    expect(result).toEqual(['m4', 'm5'])
    expect(result).not.toBe(messages)
  })

  it('never returns an empty list for a non-empty conversation', () => {
    // Sending zero messages is not a truncation of a conversation, it is a different request.
    expect(applyMessageLimit(messages, { enabled: true, maxMessages: 1 })).toEqual(['m5'])
    // A limit below 1 is already normalised to null by the reader, but the applier defends
    // independently so a hand-built settings object cannot empty the list either.
    expect(applyMessageLimit(messages, { enabled: true, maxMessages: 0 })).toBe(messages)
  })

  it('handles an empty conversation and an exact-fit limit', () => {
    expect(applyMessageLimit([], { enabled: true, maxMessages: 3 })).toEqual([])
    expect(applyMessageLimit(messages, { enabled: true, maxMessages: 5 })).toBe(messages)
  })
})
