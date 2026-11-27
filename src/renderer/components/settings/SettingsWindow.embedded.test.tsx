// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
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

const sectionIds = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-ui="settings.section"]')].map(node => node.getAttribute('data-section'))

const railButton = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('nav[aria-label="设置分区"] button')]
    .find(button => (button.textContent || '').includes(label)) as HTMLButtonElement

describe('settings panel layout', () => {
  it('shows one section at a time and moves the active rail state with the click', () => {
    const { container } = render(<SettingsWindow embedded />)
    // The defect this replaces: clicking a rail item scrolled the stacked page and left the
    // highlight frozen on 通用, so the colour never told you where you were.
    expect(sectionIds(container)).toEqual(['general'])

    const general = railButton(container, '通用')
    const appearance = railButton(container, '外观')
    expect(general.getAttribute('aria-current')).toBe('page')
    expect(general.className).toContain('ui-settings-rail-item-active')
    expect(appearance.getAttribute('aria-current')).toBeNull()

    fireEvent.click(appearance)

    expect(sectionIds(container)).toEqual(['appearance'])
    expect(appearance.getAttribute('aria-current')).toBe('page')
    expect(appearance.className).toContain('ui-settings-rail-item-active')
    expect(general.getAttribute('aria-current')).toBeNull()
    expect(general.className).not.toContain('ui-settings-rail-item-active')
  })

  it('every rail entry is reachable and renders exactly its own section', () => {
    const { container } = render(<SettingsWindow embedded />)
    for (const label of ['外观', 'API 配置', 'AI 工作台', '无限画布', '快捷键', '数据', '关于']) {
      fireEvent.click(railButton(container, label))
      const ids = sectionIds(container)
      expect(ids.length).toBe(1)
      expect(railButton(container, label).getAttribute('aria-current')).toBe('page')
    }
  })

  it('switches to a stacked, collapsible result view while searching', () => {
    const { container } = render(<SettingsWindow embedded />)
    const shell = container.querySelector('.ui-settings-shell') as HTMLElement
    expect(shell.getAttribute('data-search')).toBe('false')
    // Page mode has no collapse chrome at all.
    expect(container.querySelector('button[aria-expanded]')).toBeNull()

    fireEvent.change(screen.getByLabelText('搜索设置'), { target: { value: '快捷键' } })
    expect(shell.getAttribute('data-search')).toBe('true')
    const toggle = container.querySelector('[data-section] button[aria-expanded]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters the rail by the search box', () => {
    const { container } = render(<SettingsWindow embedded />)
    const input = screen.getByLabelText('搜索设置') as HTMLInputElement
    fireEvent.change(input, { target: { value: '快捷键' } })
    const railLabels = [...container.querySelectorAll('nav[aria-label="设置分区"] button')].map(button => button.textContent || '')
    expect(railLabels.some(label => label.includes('快捷键'))).toBe(true)
    expect(railLabels.some(label => label.includes('外观'))).toBe(false)
  })
})
