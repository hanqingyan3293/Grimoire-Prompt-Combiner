// 数据条目的悬停详情卡片。
//
// 只在需要时渲染（父组件 400ms 延迟后才挂载），position: fixed 跟随鼠标并按视口边界翻转：
// 面板本身可能只有 210px 宽，用 absolute 会被裁掉，用 fixed 才能浮在上层。
// 路径用 user-select: text 让用户能直接选中复制，比只给一个「复制」按钮更顺手。

import { useLayoutEffect, useRef, useState } from 'react'
import { formatStorageBytes, type StorageEntry } from '../../../shared/storage-types'

const CARD_WIDTH = 320
const MARGIN = 12

export function StorageEntryCard({ entry, x, y }: { entry: StorageEntry; x: number; y: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x + 14, top: y + 14 })

  // 翻转只做一次测量：卡片高度随内容变化，但顶部/底部越界判断用它自己的实际尺寸。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const left = Math.min(x + 14, window.innerWidth - rect.width - MARGIN)
    const top = y + 14 + rect.height > window.innerHeight - MARGIN ? y - rect.height - 14 : y + 14
    setPosition({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) })
  }, [x, y, entry.id])

  const capabilities = [
    entry.exportable ? '可导出' : null,
    entry.importable ? '可导入' : null,
    entry.migratable ? '可迁移' : null,
    entry.cleanable ? '可清理' : null,
  ].filter(Boolean) as string[]

  return (
    <div
      ref={ref}
      role="tooltip"
      data-ui="storage.entry-tooltip"
      className="ui-popover-surface fixed z-[80] p-3 text-[11px] leading-4"
      style={{ left: position.left, top: position.top, width: CARD_WIDTH, pointerEvents: 'none' }}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-text-primary)]" title={entry.label}>{entry.label}</span>
        <span className="shrink-0 text-xs tabular-nums text-[var(--color-accent-text)]">{formatStorageBytes(entry.bytes)}</span>
      </div>

      <div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
        {entry.kind === 'table' ? `数据库表 · ${entry.rows ?? '—'} 行`
          : entry.kind === 'package' ? `随包资源 · ${entry.files ?? '—'} 个文件`
            : entry.kind === 'file' ? '文件'
              : `目录 · ${entry.files ?? '—'} 个文件`}
      </div>

      <div className="mt-2 break-all rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] px-2 py-1.5 font-mono text-[10px] text-[var(--color-text-primary)]" style={{ userSelect: 'text' }}>
        {entry.location}
      </div>

      {entry.lastWrite && (
        <div className="mt-1.5 text-[10px] text-[var(--color-text-secondary)]">最近写入：{new Date(entry.lastWrite).toLocaleString()}</div>
      )}

      {capabilities.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {capabilities.map((label) => (
            <span key={label} className="rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">{label}</span>
          ))}
        </div>
      )}

      {entry.note && <div className="mt-1.5 text-[10px] leading-4 text-[var(--color-text-secondary)]">{entry.note}</div>}
    </div>
  )
}
