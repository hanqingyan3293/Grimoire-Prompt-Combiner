import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { SWRConfig } from 'swr'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { DataRequest } from '@shared/data/api/types'
import { preferenceService } from './shims/preference-service'
import { CompatModelSettings } from './CompatModelSettings'

// Isolate the picker presentation only. ModelSettings itself, its filters,
// useDefaultModel, usePreference, useQuery and DataApi client remain real.
// These tests do not claim popup/keyboard parity of the ModelSelector.
vi.mock('@renderer/components/DefaultModelSelector', () => ({
  DefaultModelSelector: ({ model, filter, onSelect }: {
    model?: Model; filter: (model: Model) => boolean; onSelect: (model: Model) => void
  }) => <select aria-label="fixture model picker" value={model?.id ?? ''}
    onChange={event => onSelect(models.find(item => item.id === event.target.value)!)}>
    <option value="">Empty</option>
    {models.filter(filter).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select>
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
const drawerMount = vi.hoisted(() => vi.fn())
vi.mock('../../source/src/renderer/pages/settings/ModelSettings/TopicNamingSettings', () => ({
  TopicNamingSettings: () => { drawerMount('naming'); return <div>Unsupported naming drawer</div> }
}))
vi.mock('@renderer/pages/translate/TranslateSettings', () => ({
  TranslateSettingsPanelContent: () => { drawerMount('translation'); return <div>Unsupported translate drawer</div> }
}))

const models = [
  { id: 'p::chat-a', providerId: 'p', name: 'Chat A', capabilities: [], endpointTypes: [] },
  { id: 'p::chat-b', providerId: 'p', name: 'Chat B', capabilities: [], endpointTypes: [] },
  { id: 'p::image', providerId: 'p', name: 'Image', capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION], endpointTypes: [] },
  { id: 'p::embed', providerId: 'p', name: 'Embed', capabilities: [MODEL_CAPABILITY.EMBEDDING], endpointTypes: [] }
] as unknown as Model[]
const settings: Record<string, string> = {}
const requests: string[] = []
const write = vi.fn(async (key: string, value: string) => { settings[key] = value; return true })
const originalApi = window.api

beforeEach(() => {
  preferenceService.cleanup()
  preferenceService.clearCache()
  Object.keys(settings).forEach(key => delete settings[key])
  requests.length = 0
  vi.clearAllMocks()
  window.location.hash = '#/settings/model'
  Object.defineProperty(window, 'api', { configurable: true, value: {
    ...originalApi,
    settings: { getAll: async () => ({ ...settings }), set: write },
    db: { onRefresh: () => () => undefined },
    dataApi: {
      onDataChanged: () => () => undefined,
      request: async (request: DataRequest) => {
        requests.push(request.path)
        const data = request.path === '/providers' ? [{ id: 'p', name: 'Provider', enabled: true }]
          : request.path.startsWith('/models/') ? models.find(model => model.id === request.path.slice('/models/'.length))
            : undefined
        if (!data) throw new Error('Unexpected fixture request: ' + request.path)
        return { id: request.id, status: 200, data }
      }
    }
  } })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  preferenceService.cleanup()
  preferenceService.clearCache()
  Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
})
function mount() {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CompatModelSettings /></SWRConfig>)
}
function picker(id: string) {
  return document.querySelector<HTMLSelectElement>('#' + id + ' select')!
}
async function choose(id: string, value: string, key: string) {
  fireEvent.change(picker(id), { target: { value } })
  await waitFor(() => expect(settings['cherry_pref.' + key]).toBe(JSON.stringify(value)))
  await waitFor(() => expect(picker(id)).toHaveValue(value))
}

const defaultRow = 'setting-model-default-assistant-model'
const quickRow = 'setting-model-quick-model'
const translateRow = 'setting-model-translate-model'
const paintingRow = 'setting-model-painting-model'

describe('source ModelSettings compat wrapper', () => {
  it('mounts all four source anchors, honest capability note, no unsupported drawers or automatic writes', async () => {
    mount()
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
    expect(screen.getByRole('note', { name: '模型设置能力边界' })).toHaveTextContent('保存配置不代表执行已接入')
    await waitFor(() => expect(requests).toContain('/providers'))
    expect(write).not.toHaveBeenCalled()
    expect(drawerMount).not.toHaveBeenCalled()
    expect(screen.queryByText('Unsupported naming drawer')).not.toBeInTheDocument()
    expect(screen.queryByText('Unsupported translate drawer')).not.toBeInTheDocument()
    for (const id of [defaultRow, quickRow, translateRow, paintingRow]) expect(picker(id)).not.toBeNull()
    expect(picker(defaultRow).options).toHaveLength(3) // Empty + two chat models
    expect(picker(translateRow).options).toHaveLength(3)
    expect([...picker(paintingRow).options].map(option => option.value)).toEqual(['', 'p::image'])
  })

  it('persists unique model IDs, source empty-slot cascade and independent painting; reload reads the DataApi records', async () => {
    const mounted = mount()
    await choose(defaultRow, 'p::chat-a', 'chat.default_model_id')
    await waitFor(() => expect(picker(quickRow)).toHaveValue('p::chat-a'))
    await waitFor(() => expect(picker(translateRow)).toHaveValue('p::chat-a'))
    expect(settings['cherry_pref.feature.quick_assistant.model_id']).toBe('"p::chat-a"')
    expect(settings['cherry_pref.feature.translate.model_id']).toBe('"p::chat-a"')
    expect(settings['cherry_pref.feature.paintings.default_model_id']).toBeUndefined()
    await choose(quickRow, 'p::chat-b', 'feature.quick_assistant.model_id')
    await choose(translateRow, 'p::chat-b', 'feature.translate.model_id')
    await choose(paintingRow, 'p::image', 'feature.paintings.default_model_id')
    await choose(defaultRow, 'p::chat-b', 'chat.default_model_id')
    await choose(defaultRow, 'p::chat-a', 'chat.default_model_id')
    expect(picker(quickRow)).toHaveValue('p::chat-b')
    expect(picker(translateRow)).toHaveValue('p::chat-b')
    expect(picker(paintingRow)).toHaveValue('p::image')
    mounted.unmount()
    preferenceService.cleanup()
    preferenceService.clearCache()
    mount()
    await waitFor(() => expect(picker(defaultRow)).toHaveValue('p::chat-a'))
    await waitFor(() => expect(picker(quickRow)).toHaveValue('p::chat-b'))
    await waitFor(() => expect(picker(translateRow)).toHaveValue('p::chat-b'))
    await waitFor(() => expect(picker(paintingRow)).toHaveValue('p::image'))
    expect(requests).toContain('/models/p::image')
    expect(requests).toContain('/models/p::chat-b')
  })

  it.each(['default', 'translate', 'invalid', '', 'DEFAULT'])('uses the source focus validator for %s', async focus => {
    window.location.hash = '#/settings/model?focus=' + focus
    mount()
    if (focus === 'default' || focus === 'translate') {
      await waitFor(() => expect(screen.getByTestId('model-settings-focus-guide')).toBeInTheDocument())
      const row = focus === 'default' ? defaultRow : translateRow
      expect(document.getElementById(row)).toContainElement(screen.getByTestId('model-settings-focus-guide'))
    } else {
      expect(screen.queryByTestId('model-settings-focus-guide')).not.toBeInTheDocument()
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('updates validated focus when the hash route changes without remounting', async () => {
    mount()
    fireEvent(window, new HashChangeEvent('hashchange'))
    window.location.hash = '#/settings/model?focus=translate'
    fireEvent(window, new HashChangeEvent('hashchange'))
    await waitFor(() => expect(document.getElementById(translateRow)).toContainElement(screen.getByTestId('model-settings-focus-guide')))
  })
})
