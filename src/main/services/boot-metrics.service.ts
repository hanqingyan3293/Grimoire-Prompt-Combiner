// 启动打点：把「启动慢」从感觉变成六个数。
//
// 为什么先做这个：实测显示温启动 spawn→首屏 0.78s（Electron 自身 0.44s），而首次运行 22s。
// 不区分阶段就优化，会把力气花在已经够快的地方。这里记录：
//   t0 模块加载 → t1 app.ready → t2 数据库就绪 → t3 迁移/种子完成 → t4 IPC 就绪
//   → t5 窗口创建 → t6 渲染层首帧（由渲染进程通过 IPC 上报，只有它能测到 paint）
//
// 记账方式：内存里保留最近 10 次，最近一次同时写 `settings['boot.metrics.last']`，
// 这样用户重启后仍能在设置里看到「上次启动耗时」，不依赖日志文件。

import { logEvent } from './logger.service'

export interface BootMark {
  readonly name: string
  readonly at: number
  /** 相对 t0 的毫秒数。 */
  readonly ms: number
}

export interface BootMetrics {
  readonly startedAt: string
  readonly totalMs: number
  readonly marks: readonly BootMark[]
}

// 模块加载即计时：比 app.whenReady 更早，能覆盖 Electron 主进程初始化的空档。
const startedAt = Date.now()
const marks: { name: string; at: number; ms: number }[] = []
const history: BootMetrics[] = []
const HOLD = 10

let resolveFirstPaint: (() => void) | null = null
const firstPaint = new Promise<void>((resolve) => { resolveFirstPaint = resolve })

/**
 * 首帧之后（或 `fallbackMs` 到点）执行一次。用于把「写库重活」挪出首屏路径：
 * 渲染层不上报（无头/测试环境）时也必须执行，否则内置数据永远不导入。
 */
export function afterFirstPaint(callback: () => void, fallbackMs = 4000): void {
  let done = false
  const run = () => {
    if (done) return
    done = true
    callback()
  }
  void firstPaint.then(run)
  const timer = setTimeout(run, fallbackMs)
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref()
}

export function markBootPhase(name: string): number {
  const now = Date.now()
  const ms = now - startedAt
  // 同名只记第一次，避免热重载/重试把阶段重复写乱。
  if (!marks.some((mark) => mark.name === name)) marks.push({ name, at: now, ms })
  return ms
}

export function getBootMetrics(): BootMetrics {
  const last = history[history.length - 1]
  if (last) return last
  return { startedAt: new Date(startedAt).toISOString(), totalMs: marks.reduce((max, mark) => Math.max(max, mark.ms), 0), marks: [...marks] }
}

export function getBootHistory(): readonly BootMetrics[] {
  return history
}

/**
 * 渲染层首帧上报。口径必须用 `timeOrigin + first-contentful-paint`：
 * 只看 `performance.now()` 的话，窗口被遮挡时 rAF 会被节流，回调晚跑多少就把首帧记成多少
 * （2026-11-27 实测：真实首帧 ~0.5s，被记成 36s）。
 */
export function recordRendererPaint(input: { timeOrigin?: number; paintMs?: number } | number): BootMetrics {
  const payload = typeof input === 'number' ? { paintMs: input } : input ?? {}
  const rawPaint = Number(payload.paintMs)
  const paintMs = Number.isFinite(rawPaint) && rawPaint >= 0 ? Math.round(rawPaint) : 0
  const origin = Number(payload.timeOrigin)
  // 渲染进程给了 timeOrigin 就能还原成绝对时刻；没给就退回「收到上报的时刻」。
  const paintEpoch = Number.isFinite(origin) && origin > 0 ? origin + paintMs : Date.now()
  const processMs = Math.max(0, Math.round(paintEpoch - startedAt))
  const existing = marks.find((mark) => mark.name === 'renderer-paint')
  if (existing) existing.ms = processMs
  else marks.push({ name: 'renderer-paint', at: Math.round(paintEpoch), ms: processMs })
  const snapshot: BootMetrics = {
    startedAt: new Date(startedAt).toISOString(),
    totalMs: marks.reduce((max, mark) => Math.max(max, mark.ms), 0),
    marks: [...marks],
  }
  resolveFirstPaint?.()
  resolveFirstPaint = null
  history.push(snapshot)
  if (history.length > HOLD) history.shift()
  logEvent('info', 'boot', 'Boot phases measured', {
    context: snapshot.marks.map((mark) => `${mark.name}=${mark.ms}ms`).join(' ') + ` rendererPaint=${paintMs}ms`,
  })
  return snapshot
}

/** 把最近一次写进 settings 表；数据库没就绪时静默跳过。 */
export function persistBootMetrics(write: (metrics: BootMetrics) => void): void {
  try {
    write(getBootMetrics())
  } catch {
    // 打点失败不能影响启动
  }
}
