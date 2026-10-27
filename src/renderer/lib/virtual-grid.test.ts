// 魔导书 Grimoire v7 — computeGridLayout / rowOffset 纯函数测试
import { describe, expect, it } from 'vitest'
import { computeGridLayout, rowOffset } from './virtual-grid'

// 默认档：宽 1000 / 最小 200 / 间隙 8 → 4 列，条目宽 244，条目高 244，行距 252。
const BASE = { containerWidth: 1000, containerHeight: 400, itemCount: 40, scrollTop: 0 }

describe('computeGridLayout', () => {
  it('按最小宽度计算列数与条目宽度', () => {
    const metrics = computeGridLayout({ ...BASE, itemCount: 10 })
    expect(metrics.columns).toBe(4)
    expect(metrics.itemWidth).toBe(244) // (1000 - 3 * 8) / 4
    expect(metrics.itemHeight).toBe(244) // aspectRatio 默认 1
  })

  it('宽度不足一列时仍渲染单列', () => {
    const metrics = computeGridLayout({ ...BASE, containerWidth: 150, containerHeight: 300, itemCount: 4 })
    expect(metrics.columns).toBe(1)
    expect(metrics.itemWidth).toBe(150)
    expect(metrics.rows).toBe(4)
  })

  it('行数向上取整且 totalHeight 精确', () => {
    const metrics = computeGridLayout({ ...BASE, itemCount: 10 })
    expect(metrics.rows).toBe(3) // ceil(10 / 4)
    expect(metrics.totalHeight).toBe(748) // 3 * 244 + 2 * 8
  })

  it('scrollTop=0 时窗口从首行开始，overscan 只向下方扩展', () => {
    const withOverscan = computeGridLayout({ ...BASE, containerHeight: 260, overscanRows: 2 })
    const withoutOverscan = computeGridLayout({ ...BASE, containerHeight: 260, overscanRows: 0 })
    expect(withOverscan.startRow).toBe(0) // 顶部过扫被钳制到 0
    expect(withOverscan.endRow).toBe(withoutOverscan.endRow + 2)
    expect(withOverscan.visibleStart).toBe(0)
    expect(withOverscan.visibleEnd).toBe((withOverscan.endRow + 1) * withOverscan.columns)
  })

  it('滚动到中部时窗口正确且与行对齐', () => {
    const metrics = computeGridLayout({ ...BASE, scrollTop: 1000 })
    expect(metrics.rows).toBe(10) // ceil(40 / 4)
    expect(metrics.startRow).toBe(1) // floor(1000 / 252) - overscan 2
    expect(metrics.endRow).toBe(7) // ceil(1400 / 252) - 1 + overscan 2
    expect(metrics.visibleStart).toBe(4) // startRow * columns
    expect(metrics.visibleEnd).toBe(32) // (endRow + 1) * columns
    expect(metrics.visibleStart % metrics.columns).toBe(0)
    expect(metrics.visibleEnd % metrics.columns).toBe(0)
  })

  it('items=0 时返回空窗口', () => {
    const metrics = computeGridLayout({ ...BASE, itemCount: 0 })
    expect(metrics.rows).toBe(0)
    expect(metrics.totalHeight).toBe(0)
    expect(metrics.startRow).toBe(0)
    expect(metrics.endRow).toBe(-1)
    expect(metrics.visibleStart).toBe(0)
    expect(metrics.visibleEnd).toBe(0)
  })

  it('overscanRows=0 时窗口不扩展', () => {
    const metrics = computeGridLayout({ ...BASE, overscanRows: 0 })
    expect(metrics.startRow).toBe(0)
    expect(metrics.endRow).toBe(1) // 仅视口内行：ceil(400 / 252) - 1
    expect(metrics.visibleEnd).toBe(8)
  })

  it('scrollTop 超界被钳制到尾部，不产生尾行空白', () => {
    const metrics = computeGridLayout({ ...BASE, scrollTop: 999_999, overscanRows: 0 })
    expect(metrics.endRow).toBe(metrics.rows - 1) // 最后一行，无空行
    expect(metrics.visibleEnd).toBe(40)
    expect(metrics.startRow).toBe(8) // 底部对齐：(totalHeight - height) / 行距
    expect(metrics.visibleStart).toBe(32)
  })

  it('rowOffset 按行距推进并支持自定义间隙', () => {
    const metrics = computeGridLayout({ ...BASE, itemCount: 10 })
    expect(rowOffset(0, metrics)).toBe(0)
    expect(rowOffset(2, metrics)).toBe(504) // 2 * (244 + 8)
    expect(rowOffset(-3, metrics)).toBe(0)
    expect(rowOffset(1, metrics, 12)).toBe(256) // 1 * (244 + 12)
  })
})