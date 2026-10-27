// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtualGrid } from './VirtualGrid'

// 800x600、默认 200/8/1/2 档：3 列，条目 784/3，行距 808/3。
const VIEWPORT_WIDTH = 800
const VIEWPORT_HEIGHT = 600

// jsdom 无布局也无 ResizeObserver：用固定 contentRect 的 stub 代替真实测量。
class FixedResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element): void {
    const entry = { target, contentRect: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } }
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }

  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver)
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => VIEWPORT_WIDTH })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_HEIGHT })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeItems(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

describe('VirtualGrid', () => {
  it('只渲染首屏与过扫行的条目', () => {
    const { container } = render(
      <VirtualGrid items={makeItems(100)} getKey={(item) => item} renderItem={(item) => <div data-testid="cell">{item}</div>} />,
    )

    const cells = screen.getAllByTestId('cell')
    // 视口内 3 行 + 过扫 2 行 = 5 行，3 列 → 15 项
    expect(container.querySelectorAll('[role="presentation"]')).toHaveLength(5)
    expect(cells).toHaveLength(15)
    expect(cells.length).toBeLessThan(100)
    expect(cells[0]?.textContent).toBe('0')
    expect(cells[14]?.textContent).toBe('14')
  })

  it('滚动后窗口移动并回调可见范围', () => {
    const onVisibleRangeChange = vi.fn()
    render(
      <VirtualGrid
        items={makeItems(100)}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="cell">{item}</div>}
        onVisibleRangeChange={onVisibleRangeChange}
      />,
    )

    const list = screen.getByRole('list')
    expect(onVisibleRangeChange).toHaveBeenCalled() // 首帧窗口
    onVisibleRangeChange.mockClear()

    list.scrollTop = 2000
    act(() => {
      fireEvent.scroll(list)
    })

    // scrollTop 2000 → startRow 5、endRow 11 → [15, 36)
    const cells = screen.getAllByTestId('cell')
    expect(cells).toHaveLength(21)
    expect(cells[0]?.textContent).toBe('15')
    expect(cells[cells.length - 1]?.textContent).toBe('35')
    expect(screen.queryByText('0')).toBeNull()
    expect(onVisibleRangeChange).toHaveBeenCalledTimes(1)
    expect(onVisibleRangeChange).toHaveBeenCalledWith({ start: 15, end: 36 })
  })

  it('空数组渲染 emptyFallback', () => {
    render(
      <VirtualGrid
        items={[] as number[]}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="cell">{item}</div>}
        emptyFallback={<div data-testid="empty">暂无图片</div>}
      />,
    )

    expect(screen.getByTestId('empty')).toBeTruthy()
    expect(screen.queryAllByTestId('cell')).toHaveLength(0)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('items 减少后滚动位置被钳制回顶部', () => {
    const view = render(<VirtualGrid items={makeItems(40)} getKey={(item) => item} renderItem={(item) => <div data-testid="cell">{item}</div>} />)

    const list = screen.getByRole('list')
    list.scrollTop = 2000
    act(() => {
      fireEvent.scroll(list)
    })

    view.rerender(<VirtualGrid items={makeItems(6)} getKey={(item) => item} renderItem={(item) => <div data-testid="cell">{item}</div>} />)

    // 6 项两行不足一屏：内容高度 < 视口高度 → 滚动位置归零
    expect(list.scrollTop).toBe(0)
    expect(screen.getAllByTestId('cell')[0]?.textContent).toBe('0')
  })
})