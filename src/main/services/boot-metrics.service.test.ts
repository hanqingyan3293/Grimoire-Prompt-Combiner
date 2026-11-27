// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { afterFirstPaint, getBootMetrics, markBootPhase, recordRendererPaint } from './boot-metrics.service'

describe('boot metrics', () => {
  it('records a phase once and keeps the first timestamp', () => {
    const first = markBootPhase('test-phase-a')
    const second = markBootPhase('test-phase-a')
    expect(second).toBeGreaterThanOrEqual(first)
    const marks = getBootMetrics().marks.filter((mark) => mark.name === 'test-phase-a')
    expect(marks).toHaveLength(1)
  })

  it('derives the paint time from timeOrigin instead of trusting a late callback', () => {
    // 场景：窗口被遮挡，rAF 晚跑 30s。真实首帧仍应按 timeOrigin + FCP 还原。
    const startedAt = Date.parse(getBootMetrics().startedAt)
    recordRendererPaint({ timeOrigin: startedAt + 200, paintMs: 500 })
    const mark = getBootMetrics().marks.find((entry) => entry.name === 'renderer-paint')
    expect(mark).toBeDefined()
    // 700ms 上下（允许 300ms 抖动：startedAt 是模块加载时刻）
    expect(mark!.ms).toBeGreaterThan(400)
    expect(mark!.ms).toBeLessThan(1200)
  })

  it('never reports a total that grows with query time', () => {
    const first = getBootMetrics().totalMs
    const second = getBootMetrics().totalMs
    expect(second).toBe(first)
  })

  it('runs the deferred callback after the first paint signal, exactly once', async () => {
    let calls = 0
    afterFirstPaint(() => { calls += 1 }, 5000)
    recordRendererPaint({ timeOrigin: Date.now(), paintMs: 10 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls).toBe(1)
  })
})
