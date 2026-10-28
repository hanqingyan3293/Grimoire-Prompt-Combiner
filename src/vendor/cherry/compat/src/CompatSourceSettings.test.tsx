import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompatSourceSettings, isCompatSourceSettingsRoute } from './CompatSourceSettings'
import { parseCompatRoute } from './route-registry'

// Wrapper/dispatch contract tests intentionally isolate source presentation. The actual
// source render still needs the parent's isolated-window audit: root-resolved Radix
// Switch currently duplicates React in this test project without changing build config.
const originalApi = window.api
const sourceAction = vi.hoisted(() => vi.fn())
vi.mock('../../source/src/renderer/pages/settings/BrowserSettings', () => ({
  BrowserSettings: () => <div data-testid="fixture-source-browser"><input aria-label="browser preference" /><button onClick={sourceAction}>source browser action</button></div>
}))
vi.mock('../../source/src/renderer/pages/settings/ScreenshotSettings/ScreenshotSettings', () => ({
  default: () => <div data-testid="fixture-source-screenshot"><input aria-label="screenshot preference" /><button onClick={sourceAction}>source screenshot action</button></div>
}))
const settingsSet = vi.fn(async () => true)

function installApi() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ...originalApi,
      settings: { getAll: async () => ({}), set: settingsSet },
      db: { onRefresh: () => () => undefined },
      shortcut: { onRegistrationConflict: () => () => undefined }
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  installApi()
})
afterEach(() => Object.defineProperty(window, 'api', { configurable: true, value: originalApi }))

function mount(path: string) {
  const route = parseCompatRoute('#' + path)
  return { route, ...render(<CompatSourceSettings route={route} />) }
}

function readonlyFieldset(title: string) {
  return screen.getByRole('group', { name: title + '（只读）' }) as HTMLFieldSetElement
}

describe('authentic source settings with disabled unavailable effects', () => {
  it.each([
    ['/settings/browser', '浏览器设置'],
    ['/settings/screenshot', '截图设置']
  ])('mounts the source read surface for %s and identifies its bounded capability', async (path, title) => {
    const { route } = mount(path)
    expect(isCompatSourceSettingsRoute(route.id)).toBe(true)
    const notice = await screen.findByRole('note', { name: title + '能力边界' })
    expect(notice).toHaveTextContent('PARTIALLY_MIGRATED')
    expect(notice).toHaveTextContent('不保存配置')
    expect(readonlyFieldset(title)).toBeDisabled()
  })

  it('dispatches BrowserSettings under a native-disabled boundary without supplying a fake tab context', async () => {
    mount('/settings/browser')
    await vi.dynamicImportSettled()
    await screen.findByTestId('fixture-source-browser')
    const fieldset = readonlyFieldset('浏览器设置')
    expect(within(fieldset).getByRole('button')).toBeDisabled()
    expect(within(fieldset).getByRole('textbox')).toBeDisabled()
    const user = userEvent.setup()
    await user.click(within(fieldset).getByRole('button'))
    await user.type(within(fieldset).getByRole('textbox'), 'attempt')
    expect(sourceAction).not.toHaveBeenCalled()
    expect(within(fieldset).queryByRole('dialog')).toBeNull()
    expect(settingsSet).not.toHaveBeenCalled()
    expect(screen.getByRole('note', { name: '浏览器设置能力边界' })).toHaveTextContent('TabsProvider')
  })

  it('renders ScreenshotSettings behind disabled native controls so screenshot/OCR mutations cannot fire', async () => {
    mount('/settings/screenshot')
    await screen.findByTestId('fixture-source-screenshot')
    const fieldset = readonlyFieldset('截图设置')
    expect(fieldset).toBeDisabled()
    expect(within(fieldset).getByRole('button')).toBeDisabled()
    expect(within(fieldset).getByRole('textbox')).toBeDisabled()
    expect(sourceAction).not.toHaveBeenCalled()
    expect(settingsSet).not.toHaveBeenCalled()
  })

  it('does not mount source pages that would persist secrets or require unsafe lifecycles', () => {
    for (const path of ['/settings/channels', '/settings/quick-assistant', '/settings/device-connections']) {
      const { route, unmount } = mount(path)
      expect(isCompatSourceSettingsRoute(route.id)).toBe(false)
      expect(screen.getByRole('alert')).toHaveTextContent('BLOCKED')
      expect(screen.queryByTestId('compat-source-settings')).toBeNull()
      unmount()
    }
    // api-gateway is no longer read-only: it drives a real gateway, so its fieldset must be
    // enabled while every still-read-only source page keeps the disabled fieldset and the note.
    for (const path of ['/settings/screenshot', '/settings/browser']) {
      const { route, unmount } = mount(path)
      expect(isCompatSourceSettingsRoute(route.id)).toBe(true)
      expect(screen.getByRole('note')).toHaveTextContent('不保存配置')
      expect(readonlyFieldset(screen.getByRole('note').textContent?.includes('截图') ? '截图设置' : '浏览器设置')).toBeDisabled()
      unmount()
    }
    // 联网搜索 became editable once credentials had a dedicated encrypted path.
    {
      const { route, unmount } = mount('/settings/websearch')
      expect(isCompatSourceSettingsRoute(route.id)).toBe(true)
      expect(screen.getByRole('note')).toHaveTextContent('本页可编辑')
      expect(document.querySelector('[data-settings-route="settings-websearch"] fieldset')?.hasAttribute('disabled')).toBe(false)
      unmount()
    }
    {
      const { route, unmount } = mount('/settings/api-gateway')
      expect(isCompatSourceSettingsRoute(route.id)).toBe(true)
      expect(screen.getByRole('note')).toHaveTextContent('本页可编辑')
      // Editable routes carry no 「只读」 suffix, so the fieldset is looked up directly.
      expect(document.querySelector('[data-settings-route="settings-api-gateway"] fieldset')?.hasAttribute('disabled')).toBe(false)
      unmount()
    }
  })

  it('keeps Browser source history/import/clear dialogs behind disabled triggers and no tab provider', async () => {
    const browser = readFileSync(resolve(process.cwd(), '../source/src/renderer/pages/settings/BrowserSettings.tsx'), 'utf8')
    const history = readFileSync(resolve(process.cwd(), '../source/src/renderer/pages/settings/BrowserSettings/BrowserHistoryDialog.tsx'), 'utf8')
    expect(browser).toContain("const [dialog, setDialog] = useState<'import' | 'history' | 'clear' | null>(null)")
    expect(browser).toContain('<DialogTrigger asChild>')
    expect(browser).toContain('<BrowserHistoryDialog onOpenPage={() => setDialog(null)} />')
    expect(history).toContain('const { openTab } = useTabs()')
    // The compatibility shell supplies no TabsProvider; the disabled native
    // fieldset around all three triggers makes the source dialogs unreachable.
    mount('/settings/browser')
    await screen.findByRole('note', { name: '浏览器设置能力边界' })
    expect(readonlyFieldset('浏览器设置')).toBeDisabled()
    expect(screen.getByRole('note', { name: '浏览器设置能力边界' })).toHaveTextContent('TabsProvider')
    expect(readonlyFieldset('浏览器设置')).toBeDisabled()
  })

  it('dispatches only the approved source pages in the settings main slot', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/cherry-chat-shell-entry.tsx'), 'utf8')
    const wrapper = readFileSync(resolve(process.cwd(), 'src/CompatSourceSettings.tsx'), 'utf8')
    expect(shell).toContain('isCompatSourceSettingsRoute(route.id) ? (')
    expect(shell.indexOf('isCompatSourceSettingsRoute(route.id) ? (')).toBeLessThan(shell.indexOf('getSettingsDiagnostic(route.id) || route.id === \'settings-invalid\' ? ('))
    expect(wrapper).toContain("pages/settings/BrowserSettings")
    expect(wrapper).toContain("pages/settings/ScreenshotSettings/ScreenshotSettings")
    expect(isCompatSourceSettingsRoute('settings-device-connections')).toBe(false)
    expect(isCompatSourceSettingsRoute('settings-api-gateway')).toBe(true)
    expect(isCompatSourceSettingsRoute('settings-websearch')).toBe(true)
    expect(isCompatSourceSettingsRoute('settings-channels')).toBe(false)
    expect(isCompatSourceSettingsRoute('settings-quick-assistant')).toBe(false)
  })

  it('keeps the general route reachable and hosts the domain capability report there', () => {
    // 2026-10-27 regression guard: `settings-general` is a SOURCE_SETTINGS entry, so an
    // `route.id === 'settings-general'` branch later in the shell chain is unreachable
    // (TS2367 proved it). The report used to live in that dead branch and never rendered.
    const shell = readFileSync(resolve(process.cwd(), 'src/cherry-chat-shell-entry.tsx'), 'utf8')
    const wrapper = readFileSync(resolve(process.cwd(), 'src/CompatSourceSettings.tsx'), 'utf8')
    expect(shell).not.toContain("route.id === 'settings-general' ? (")
    expect(wrapper).toContain('<CompatDomainCapabilities />')
    expect(isCompatSourceSettingsRoute('settings-general')).toBe(true)
  })
  it('falls back to the precise diagnostic if ScreenshotSettings lacks the preload shortcut contract', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: { ...window.api, shortcut: undefined } })
    mount('/settings/screenshot')
    expect(screen.getByRole('alert')).toHaveTextContent('截图设置')
    expect(screen.getByRole('alert')).toHaveTextContent('BLOCKED')
  })
})
