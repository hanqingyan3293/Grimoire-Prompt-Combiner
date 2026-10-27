// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoverPreview } from './HoverPreview'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// React 19 的 onMouseEnter/onMouseLeave 由 mouseover/mouseout 合成，测试需触发后两者
function hover(element: HTMLElement) { fireEvent.mouseOver(element) }
function unhover(element: HTMLElement) { fireEvent.mouseOut(element) }

function renderPreview() {
  const result = render(
    <HoverPreview preview={<span>悬浮预览</span>}>
      <div>触发卡片</div>
    </HoverPreview>,
  )
  return {
    anchor: result.container.firstElementChild as HTMLElement,
    unmount: result.unmount,
  }
}

function previewSurface() {
  return document.querySelector('[data-hover-preview]') as HTMLElement
}

describe('HoverPreview', () => {
  it('waits for delayMs before showing the preview', () => {
    const { anchor } = renderPreview()
    hover(anchor)

    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByText('悬浮预览')).toBeNull()

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByText('悬浮预览')).toBeTruthy()
  })

  it('cancels the pending preview when the pointer leaves early', () => {
    const { anchor } = renderPreview()
    hover(anchor)
    unhover(anchor)

    act(() => { vi.advanceTimersByTime(600) })
    expect(screen.queryByText('悬浮预览')).toBeNull()
  })

  it('hides after hideDelayMs when the pointer leaves the anchor', () => {
    const { anchor } = renderPreview()
    hover(anchor)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('悬浮预览')).toBeTruthy()

    unhover(anchor)
    act(() => { vi.advanceTimersByTime(79) })
    expect(screen.getByText('悬浮预览')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('悬浮预览')).toBeNull()
  })

  it('stays open while the pointer moves onto the preview surface', () => {
    const { anchor } = renderPreview()
    hover(anchor)
    act(() => { vi.advanceTimersByTime(500) })

    unhover(anchor)
    hover(previewSurface())
    act(() => { vi.advanceTimersByTime(90) })
    expect(screen.getByText('悬浮预览')).toBeTruthy()

    unhover(previewSurface())
    act(() => { vi.advanceTimersByTime(90) })
    expect(screen.queryByText('悬浮预览')).toBeNull()
  })

  it('hides on window scroll and resize', () => {
    const { anchor } = renderPreview()
    hover(anchor)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('悬浮预览')).toBeTruthy()

    fireEvent.scroll(window)
    expect(screen.queryByText('悬浮预览')).toBeNull()

    hover(anchor)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByText('悬浮预览')).toBeTruthy()

    fireEvent(window, new Event('resize'))
    expect(screen.queryByText('悬浮预览')).toBeNull()
  })

  it('clears pending timers on unmount', () => {
    const { anchor, unmount } = renderPreview()
    hover(anchor)
    act(() => { vi.advanceTimersByTime(500) })
    unhover(anchor)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('悬浮预览')).toBeNull()
  })
})