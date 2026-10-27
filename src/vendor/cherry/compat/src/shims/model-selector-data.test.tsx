import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useModelSelectorData } from './model-selector-data'

afterEach(() => vi.unstubAllGlobals())

it('prefers catalog capability metadata over configured ID placeholders', async () => {
  const original = window.api
  Object.defineProperty(window, 'api', { configurable: true, value: {
    providers: { list: async () => [{ id: 'p', name: 'Provider', models: ['image-model', 'uncatalogued'] }] },
    ai: { sessions: { catalog: {
      providers: async () => [{ id: 'p', name: 'Provider' }],
      models: async () => [{ id: 'p::image-model', providerId: 'p', name: 'Known image', capabilities: ['image-generation'] }]
    } } }
  } })
  try {
    const { result } = renderHook(() => useModelSelectorData())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.selectableModelsById.get('p::image-model')?.capabilities).toEqual(['image-generation'])
    expect(result.current.selectableModelsById.get('p::image-model')?.name).toBe('Known image')
    expect(result.current.selectableModelsById.get('p::uncatalogued')?.capabilities).toEqual([])
    expect(result.current.modelItems.filter(item => item.modelId === 'p::image-model')).toHaveLength(1)
  } finally { Object.defineProperty(window, 'api', { configurable: true, value: original }) }
})
