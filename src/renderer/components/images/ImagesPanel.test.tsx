// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagesPanel } from './ImagesPanel'

const images = [1, 2].map(id => ({ id, file_path: '/fixtures/' + id + '.png', storage_mode: 'external', asset_hash: null, mime_type: 'image/png', file_size: 12, original_name: id + '.png', available: true, created_at: '2026-11-06' }))
const api = {
  images: { listPaged: vi.fn(async () => ({ items: images, total: 2, limit: 60, offset: 0 })), delete: vi.fn(async () => true), existingIds: vi.fn(async (input: { ids: number[] }) => input.ids), deleteBatch: vi.fn(async () => ({ status: 'completed', deletedIds: [1, 2], cleanup: [], failures: [] })) },
  media: { list: vi.fn(async () => []), thumbs: vi.fn(async () => ({})), onScanProgress: vi.fn(() => () => undefined) },
  tags: { assetLinks: { listBatch: vi.fn(async () => []) } },
  db: { onReload: vi.fn(() => () => undefined) },
  tasks: { onUpdated: vi.fn(() => () => undefined) },
}
beforeEach(() => {
  vi.clearAllMocks()
  api.images.listPaged.mockResolvedValue({ items: images, total: 2, limit: 60, offset: 0 })
  api.images.existingIds.mockImplementation(async input => input.ids)
  Object.assign(window, { api })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function selectBoth() {
  await waitFor(() => expect(screen.getByLabelText('选择 1.png')).toBeTruthy())
  fireEvent.click(screen.getByLabelText('选择 1.png'))
  fireEvent.click(screen.getByLabelText('选择 2.png'))
}

describe('image panel batch deletion contract', () => {
  it('uses one main-owned prechecked batch instead of parallel single deletion', async () => {
    render(<ImagesPanel />)
    await selectBoth()
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    await waitFor(() => expect(api.images.deleteBatch).toHaveBeenCalledExactlyOnceWith({ ids: [1, 2] }))
    expect(api.images.delete).not.toHaveBeenCalled()
  })

  it('keeps selected ids and displays a failed batch instead of silently clearing selection', async () => {
    api.images.deleteBatch.mockRejectedValueOnce(new Error('ASSET_IN_USE: referenced by two versions'))
    render(<ImagesPanel />)
    await selectBoth()
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('ASSET_IN_USE'))
    expect((screen.getByLabelText('选择 1.png') as HTMLInputElement).checked).toBe(true)
    expect(api.images.delete).not.toHaveBeenCalled()
  })

  it('removes a successful single deletion from selection before a subsequent batch', async () => {
    render(<ImagesPanel />)
    await selectBoth()
    api.images.listPaged.mockResolvedValue({ items: [images[1]], total: 1, limit: 60, offset: 0 })
    fireEvent.click(screen.getByRole('button', { name: '删除 1.png' }))
    fireEvent.click(screen.getByRole('button', { name: /^删除$/ }))
    await waitFor(() => expect(api.images.delete).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByLabelText('选择 1.png')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    await waitFor(() => expect(api.images.deleteBatch).toHaveBeenCalledWith({ ids: [2] }))
  })

  it('revalidates stale ids across pages without dropping live off-page selection', async () => {
    api.images.listPaged.mockResolvedValueOnce({ items: images, total: 120, limit: 60, offset: 0 })
    render(<ImagesPanel />)
    await selectBoth()
    api.images.existingIds.mockResolvedValue([2])
    api.images.listPaged.mockResolvedValue({ items: [{ ...images[0], id: 3, original_name: '3.png' }], total: 120, limit: 60, offset: 60 })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(screen.getByLabelText('选择 3.png')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('已选 1 张')).toBeTruthy())
    expect(api.images.existingIds).toHaveBeenCalledWith({ ids: [1, 2] })
  })

  it('does not delete anything when the user cancels the confirmation', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<ImagesPanel />)
    await selectBoth()
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    expect(api.images.deleteBatch).not.toHaveBeenCalled()
    expect(api.images.delete).not.toHaveBeenCalled()
  })
})
