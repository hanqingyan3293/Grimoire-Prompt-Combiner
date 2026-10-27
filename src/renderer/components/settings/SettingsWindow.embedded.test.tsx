// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SettingsWindow } from './SettingsWindow'

// jsdom has no matchMedia; the appearance section reads it during render.
beforeEach(() => {
  cleanup()
  // antd's resize observer and jsdom do not ship these.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverStub })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: ResizeObserverStub })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      settings: { getAll: async () => ({}), set: async () => true },
      providers: { list: async () => [] },
      db: { onRefresh: () => () => undefined, onFocus: () => () => undefined },
      ai: { sessions: { catalog: { providers: async () => [], models: async () => [] } } },
    },
  })
})

describe('settings panel layout', () => {
  it('stacks every category as a collapsible card in embedded mode', () => {
    const { container } = render(<SettingsWindow embedded />)
    const sections = container.querySelectorAll('[data-ui="settings.section"]')
    expect(sections.length).toBe(8)
    // Every category is present at once — the panel is a full page, not a switcher.
    const ids = [...sections].map(node => node.getAttribute('data-section'))
    expect(ids).toEqual(['general', 'appearance', 'api', 'ai', 'canvas', 'shortcuts', 'data', 'about'])
  })

  it('collapses one card without touching the others', () => {
    const { container } = render(<SettingsWindow embedded />)
    const general = container.querySelector('[data-section="general"]') as HTMLElement
    const toggle = general.querySelector('button[aria-expanded]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const before = general.textContent?.length || 0
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(general.textContent?.length || 0).toBeLessThan(before)
    const appearance = container.querySelector('[data-section="appearance"]') as HTMLElement
    expect(appearance.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('filters categories by the search box', () => {
    const { container } = render(<SettingsWindow embedded />)
    const input = screen.getByLabelText('搜索设置') as HTMLInputElement
    fireEvent.change(input, { target: { value: '快捷键' } })
    const visible = [...container.querySelectorAll('[data-ui="settings.section"]')]
    expect(visible.length).toBe(8) // cards stay mounted; the rail filters
    const railLabels = [...container.querySelectorAll('nav[aria-label="设置分区"] button')].map(button => button.textContent || '')
    expect(railLabels.some(label => label.includes('快捷键'))).toBe(true)
    expect(railLabels.some(label => label.includes('外观'))).toBe(false)
  })
})
