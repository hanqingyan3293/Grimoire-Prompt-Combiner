// 魔导书 Grimoire v7 — 图库虚拟网格（自有滚动容器 + 行窗口渲染）
// Owns its scroll container and renders only the row window produced by
// computeGridLayout: rows are absolutely positioned inside a relative spacer
// whose height equals totalHeight, so the scrollbar stays truthful.
import React, { useEffect, useRef, useState } from 'react'
import { computeGridLayout, rowOffset } from '../../lib/virtual-grid'

export interface VirtualGridProps<T> {
  items: T[]
  getKey: (item: T, index: number) => string | number
  renderItem: (item: T, index: number) => React.ReactNode
  /** 最小列宽（SDIS 语义），默认 200 */
  minItemWidth?: number
  gap?: number
  aspectRatio?: number
  overscanRows?: number
  className?: string
  onVisibleRangeChange?: (range: { start: number; end: number }) => void
  emptyFallback?: React.ReactNode
}

interface ContainerSize {
  width: number
  height: number
}

export function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  minItemWidth = 200,
  gap = 8,
  aspectRatio = 1,
  overscanRows = 2,
  className = '',
  onVisibleRangeChange,
  emptyFallback,
}: VirtualGridProps<T>): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const lastRangeRef = useRef<{ start: number; end: number } | null>(null)
  // 回调只经 ref 读取：避免调用方函数身份变化触发的重复上报
  const onRangeChangeRef = useRef(onVisibleRangeChange)
  useEffect(() => {
    onRangeChangeRef.current = onVisibleRangeChange
  }, [onVisibleRangeChange])

  const itemCount = items.length

  const metrics = computeGridLayout({
    containerWidth: size.width,
    containerHeight: size.height,
    itemCount,
    scrollTop,
    minItemWidth,
    gap,
    aspectRatio,
    overscanRows,
  })

  // 容器尺寸：ResizeObserver 优先；无该 API 的环境（jsdom）退回 clientWidth/clientHeight。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const readFromClient = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      setSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    readFromClient()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect && (rect.width !== 0 || rect.height !== 0)) {
        setSize(prev => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }))
      } else {
        readFromClient()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 滚动不节流：窗口计算是纯函数、setState 同值会被跳过。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // 列表缩水后滚动位置可能落在 totalHeight 之外：同步 DOM 与 state（窗口计算自身另有钳制）。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const maxScrollTop = Math.max(0, metrics.totalHeight - size.height)
    if (el.scrollTop > maxScrollTop) {
      el.scrollTop = maxScrollTop
      setScrollTop(maxScrollTop)
    }
  }, [metrics.totalHeight, size.height])

  // 渲染窗口 start/end 变化时上报（首帧同样上报一次当前窗口）。
  useEffect(() => {
    const notify = onRangeChangeRef.current
    if (!notify) return
    const { visibleStart, visibleEnd } = metrics
    const last = lastRangeRef.current
    if (last && last.start === visibleStart && last.end === visibleEnd) return
    lastRangeRef.current = { start: visibleStart, end: visibleEnd }
    notify({ start: visibleStart, end: visibleEnd })
  }, [metrics.visibleStart, metrics.visibleEnd])

  const rows: React.ReactElement[] = []
  for (let rowIndex = metrics.startRow; rowIndex <= metrics.endRow; rowIndex += 1) {
    const rowStart = rowIndex * metrics.columns
    const rowEnd = Math.min(rowStart + metrics.columns, itemCount)
    const cells: React.ReactElement[] = []
    for (let index = rowStart; index < rowEnd; index += 1) {
      cells.push(
        // 条目容器不带 role：卡片语义由 renderItem 提供，避免与卡片自身 role 冲突。
        <div key={getKey(items[index], index)} style={{ flex: `0 0 ${metrics.itemWidth}px`, height: metrics.itemHeight, minWidth: 0 }}>
          {renderItem(items[index], index)}
        </div>,
      )
    }
    rows.push(
      <div key={rowIndex} role="presentation" style={{ position: 'absolute', top: rowOffset(rowIndex, metrics, gap), left: 0, width: '100%', display: 'flex', gap }}>
        {cells}
      </div>,
    )
  }

  return (
    <div ref={containerRef} role={itemCount > 0 ? 'list' : undefined} className={`relative h-full w-full overflow-auto ${className}`.trim()}>
      {itemCount === 0 ? (
        emptyFallback ?? null
      ) : (
        <div style={{ position: 'relative', width: '100%', height: metrics.totalHeight }}>{rows}</div>
      )}
    </div>
  )
}