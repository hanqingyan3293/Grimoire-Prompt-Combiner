// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NovelAIAssetPanel } from './NovelAIAssetPanel'

const assets = [
  { id: 'a1', kind: 'character', name: '雨中少女', payload: '{{long hair}}, rain', examples: [], uses: 2, updatedAt: '2026-10-27' },
  { id: 'a2', kind: 'style', name: '水彩', payload: 'watercolor', examples: [], uses: 0, updatedAt: '2026-10-27' },
]

const api = {
  list: vi.fn(async () => assets),
  create: vi.fn(async () => assets[0]),
  update: vi.fn(async () => assets[0]),
  remove: vi.fn(async () => true),
  use: vi.fn(async () => true),
  images: vi.fn(async (assetId: string) => (assetId === 'a1' ? [{ imageId: 'img_1', via: 'manual', usedAt: 'now' }] : [])),
  byImage: vi.fn(async () => [assets[1]]),
  versions: vi.fn(async () => [{ versionId: 'v9', workId: 'w1', number: 3, imageId: 'img_1' }]),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: { novelai: { assets: typeof api } } }).api = { novelai: { assets: api } }
})

afterEach(() => cleanup())

describe('NovelAI asset library panel (M6 UI)', () => {
  it('keeps a deletion preview requested immediately when the first selected asset becomes clickable', async () => {
    const observer = new MutationObserver(() => {
      const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent === '删除素材')
      if (!button) return
      observer.disconnect()
      button.click()
    })
    observer.observe(document.body, { subtree: true, childList: true })
    try {
      render(<NovelAIAssetPanel />)
      await waitFor(() => expect(screen.getByRole('dialog', { name: '确认删除素材' })).toBeTruthy())
      expect(api.remove).not.toHaveBeenCalled()
    } finally { observer.disconnect() }
  })
  it('lists assets with their reference counts and shows the selected asset usages', async () => {
    render(<NovelAIAssetPanel />)
    await waitFor(() => expect(screen.getAllByText('雨中少女').length).toBeGreaterThan(0))
    expect(screen.getAllByText('水彩').length).toBeGreaterThan(0)
    // img_1 now appears twice on purpose: once as a usage, once under 「用在哪些版本」.
    await waitFor(() => expect(screen.getAllByText(/img_1/).length).toBeGreaterThanOrEqual(2))
    expect(api.images).toHaveBeenCalledWith('a1')
  })

  it('records a usage and refreshes both the list and the usage line', async () => {
    render(<NovelAIAssetPanel />)
    await waitFor(() => expect(screen.getAllByText('雨中少女').length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('图片 ID'), { target: { value: 'img_9' } })
    fireEvent.click(screen.getByRole('button', { name: '记一次引用' }))
    // The UI does not invent a `via`; the main-process handler defaults it to 'manual'.
    await waitFor(() => expect(api.use).toHaveBeenCalledWith({ assetId: 'a1', imageId: 'img_9' }))
    // At least one refresh after the write; the exact count also depends on selection effects.
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('requires an explicit preview and cancellation before any destructive asset call', async () => {
    render(<NovelAIAssetPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: '删除素材' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '删除素材' }))
    expect(api.remove).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('dialog', { name: '确认删除素材' })).toBeTruthy())
    expect(screen.getAllByText(/img_1/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '取消删除' }))
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('calls force deletion only after the user explicitly confirms the preview', async () => {
    render(<NovelAIAssetPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: '删除素材' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '删除素材' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy())
    expect(api.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledExactlyOnceWith('a1', true, ['img_1']))
  })

  it('discards a pending delete preview when selection changes', async () => {
    render(<NovelAIAssetPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: '删除素材' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '删除素材' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: '确认删除素材' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /水彩/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认删除素材' })).toBeNull())
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('answers 「这张图用了哪些素材」 through the reverse lookup', async () => {
    render(<NovelAIAssetPanel />)
    await waitFor(() => expect(screen.getAllByText('雨中少女').length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('反查图片 ID'), { target: { value: 'img_1' } })
    fireEvent.click(screen.getByRole('button', { name: '反查' }))
    await waitFor(() => expect(api.byImage).toHaveBeenCalledWith('img_1'))
    await waitFor(() => expect(screen.getAllByText('水彩').length).toBeGreaterThan(0))
  })
})
