// 启动打点的 IPC：渲染层上报首帧、设置页读取上次结果。
//
// 只做两件事，且都不写业务表：paint 上报走内存 + settings 单行；metrics 读取走内存快照。

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getBootMetrics, recordRendererPaint } from '../services/boot-metrics.service'

export function registerBootIPC(): void {
  ipcMain.handle(IPC_CHANNELS.BOOT_RENDERER_PAINTED, async (_event, payload: unknown) => {
    if (typeof payload === 'number') return recordRendererPaint(payload)
    const record = (payload ?? {}) as { timeOrigin?: unknown; paintMs?: unknown }
    return recordRendererPaint({ timeOrigin: Number(record.timeOrigin), paintMs: Number(record.paintMs) })
  })

  ipcMain.handle(IPC_CHANNELS.BOOT_METRICS, async () => getBootMetrics())
}
