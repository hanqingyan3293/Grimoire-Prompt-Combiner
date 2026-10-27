import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn(async () => { throw new Error('PROCESSOR_SERVICE_UNAVAILABLE') }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key.endsWith('overrides') ? {} : undefined, vi.fn()],
  useMultiplePreferences: () => [{}, vi.fn()]
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

import { CompatProcessingSettings } from './CompatProcessingSettings'

afterEach(() => { cleanup(); request.mockClear() })

describe('authentic processing settings refusal state', () => {
  it.each(['document', 'ocr'] as const)('mounts source %s page and never disguises discovery failure as empty', async kind => {
    render(<CompatProcessingSettings kind={kind} />)
    await waitFor(() => expect(request).toHaveBeenCalledWith('file_processing.list_available_processors'))
    await waitFor(() => expect(screen.getByText('Failed to load available processors')).toBeTruthy())
    expect(screen.queryByText('common.no_results')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('note').textContent).toContain('不会保存密钥')
  })
})
