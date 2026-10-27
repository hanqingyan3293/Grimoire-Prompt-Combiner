import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import { isGenerateImageModel, isNonChatModel } from '@shared/utils/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'

// No picker, data-hook, shell, row or virtual-list mocks: this exercises the source's
// relative hook import with the SAME alias table as the shipped compatibility build.
const originalApi = window.api
afterEach(() => Object.defineProperty(window, 'api', { configurable: true, value: originalApi }))

it('opens the real source picker and selects an enabled configured model absent from the catalog', async () => {
  const list = vi.fn(async () => [
    { id: 'settings-smoke-provider', name: 'Settings smoke provider', is_active: true, models: ['gpt-4o'] },
    { id: 'disabled-provider', name: 'Disabled provider', is_active: false, models: ['disabled-model'] }
  ])
  const dataRequest = vi.fn(originalApi.dataApi.request)
  Object.defineProperty(window, 'api', { configurable: true, value: {
    ...originalApi,
    dataApi: { ...originalApi.dataApi, request: dataRequest },
    providers: { list },
    ai: { sessions: { catalog: {
      providers: async () => [],
      models: async () => []
    } } }
  } })
  const onSelect = vi.fn()
  render(<DefaultModelSelector providers={[]} placeholder="Choose default model"
    filter={model => !isNonChatModel(model)} onSelect={onSelect} />)
  // Closed mount must settle without the shim's old resetTags render loop.
  expect(list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Choose default model' }))
  const option = await screen.findByTestId('model-selector-item-settings-smoke-provider::gpt-4o')
  expect(option).toHaveAttribute('role', 'option')
  expect(option).toHaveTextContent('gpt-4o')
  expect(screen.queryByTestId('model-selector-item-disabled-provider::disabled-model')).not.toBeInTheDocument()
  expect(screen.queryByTestId('model-selector-empty')).not.toBeInTheDocument()
  fireEvent.click(option)
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
  expect(onSelect.mock.calls[0][0]).toMatchObject({
    id: 'settings-smoke-provider::gpt-4o', providerId: 'settings-smoke-provider',
    apiModelId: 'gpt-4o', name: 'gpt-4o', capabilities: []
  })
  // Catalog absence is not permission to invent model metadata, and no source
  // /models request may replace the configured-provider fallback behind our back.
  expect(onSelect.mock.calls[0][0].contextWindow).toBeUndefined()
  expect(dataRequest).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByTestId('model-selector-content')).not.toBeInTheDocument())
  expect(list).toHaveBeenCalledTimes(1)
})

it('uses source painting filters and display tags without promoting an unknown configured ID to an image model', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: {
    ...originalApi,
    providers: { list: async () => [{ id: 'p', name: 'Provider', is_active: true, models: ['image', 'unknown'] }] },
    ai: { sessions: { catalog: {
      providers: async () => [{ id: 'p', name: 'Provider' }],
      models: async () => [{ id: 'p::image', providerId: 'p', name: 'Catalog Image', capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] }]
    } } }
  } })
  const onSelect = vi.fn()
  render(<DefaultModelSelector providers={[]} placeholder="Choose painting model"
    filter={isGenerateImageModel} onSelect={onSelect} />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose painting model' }))
  const option = await screen.findByTestId('model-selector-item-p::image')
  expect(option).toHaveTextContent('Catalog Image')
  expect(screen.queryByTestId('model-selector-item-p::unknown')).not.toBeInTheDocument()
  // Source display tags are derived from source capability/support predicates,
  // not the old shim's hard-coded tag strings (which crashed ModelTag).
  fireEvent.click(option)
  expect(onSelect.mock.calls[0][0].capabilities).toEqual([MODEL_CAPABILITY.IMAGE_GENERATION])
})
