// 魔导书 Grimoire v7 — 虚拟网格布局（纯函数）
// SDIS-style gallery grid math: fixed row height derived from a minimum item
// width plus an aspect ratio, windowed by scroll position with row overscan.
// Kept dependency-free so it is trivially testable and reusable by any panel.

export interface VirtualGridInput {
  containerWidth: number
  containerHeight: number
  itemCount: number
  scrollTop: number
  /** Minimum column width in px before adding columns (SDIS uses ~200). */
  minItemWidth?: number
  /** Gap between tiles in px. */
  gap?: number
  /** width / height of one tile; 1 = square. */
  aspectRatio?: number
  /** Extra rows rendered above and below the viewport. */
  overscanRows?: number
}

export interface VirtualGridMetrics {
  columns: number
  rows: number
  itemWidth: number
  itemHeight: number
  totalHeight: number
  startRow: number
  endRow: number
  /** Inclusive item index range for the rendered window (empty when itemCount = 0). */
  visibleStart: number
  visibleEnd: number
}

export function computeGridLayout(input: VirtualGridInput): VirtualGridMetrics {
  const gap = Math.max(0, input.gap ?? 8)
  const minItemWidth = Math.max(40, input.minItemWidth ?? 200)
  const aspectRatio = input.aspectRatio && input.aspectRatio > 0 ? input.aspectRatio : 1
  const overscanRows = Math.max(0, Math.floor(input.overscanRows ?? 2))
  const width = Math.max(0, input.containerWidth)
  const height = Math.max(0, input.containerHeight)
  const itemCount = Math.max(0, Math.floor(input.itemCount))

  const columns = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)))
  const itemWidth = columns > 0 ? Math.max(1, (width - gap * (columns - 1)) / columns) : minItemWidth
  const itemHeight = Math.max(1, itemWidth / aspectRatio)
  const rows = itemCount === 0 ? 0 : Math.ceil(itemCount / columns)
  const totalHeight = rows === 0 ? 0 : rows * itemHeight + (rows - 1) * gap

  const rowStride = itemHeight + gap
  const scrollTop = Math.max(0, Math.min(input.scrollTop, Math.max(0, totalHeight - height)))
  const firstVisibleRow = rowStride > 0 ? Math.floor(scrollTop / rowStride) : 0
  const lastVisibleRow = rowStride > 0 ? Math.ceil((scrollTop + height) / rowStride) - 1 : 0
  const startRow = rows === 0 ? 0 : Math.max(0, Math.min(firstVisibleRow - overscanRows, rows - 1))
  const endRow = rows === 0 ? -1 : Math.max(startRow, Math.min(lastVisibleRow + overscanRows, rows - 1))

  const visibleStart = startRow * columns
  const visibleEnd = Math.min(itemCount, (endRow + 1) * columns)

  return { columns, rows, itemWidth, itemHeight, totalHeight, startRow, endRow, visibleStart, visibleEnd }
}

/** Row top offset in px for a rendered row index. */
export function rowOffset(rowIndex: number, metrics: Pick<VirtualGridMetrics, 'itemHeight'>, gap = 8): number {
  return Math.max(0, rowIndex) * (metrics.itemHeight + gap)
}