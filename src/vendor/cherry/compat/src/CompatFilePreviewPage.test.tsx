import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../source/src/renderer/pages/filePreview/FilePreviewPage', () => ({
  FilePreviewPage: ({ filePath }: { filePath?: string }) => <span data-testid="file-preview-path">{filePath ?? 'invalid'}</span>
}))

import CompatFilePreviewPage from './CompatFilePreviewPage'

function navigate(filePath?: string) {
  const query = filePath === undefined ? '' : '?' + new URLSearchParams({ path: filePath }).toString()
  window.history.replaceState(null, '', '#/app/file-preview' + query)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

afterEach(() => window.history.replaceState(null, '', '#/app/chat'))

describe('source file preview route wrapper', () => {
  it('uses the source invalid-path state for missing and relative paths', () => {
    navigate()
    render(<CompatFilePreviewPage />)
    expect(screen.getByTestId('file-preview-path').textContent).toBe('invalid')
    act(() => navigate('relative.md'))
    expect(screen.getByTestId('file-preview-path').textContent).toBe('invalid')
  })

  it('preserves validated paths across query navigation', () => {
    navigate('C:/fixture/first.md')
    render(<CompatFilePreviewPage />)
    expect(screen.getByTestId('file-preview-path').textContent?.replaceAll('\\', '/')).toBe('C:/fixture/first.md')
    act(() => navigate('C:/fixture/second.md'))
    expect(screen.getByTestId('file-preview-path').textContent?.replaceAll('\\', '/')).toBe('C:/fixture/second.md')
  })
})
