// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeUsesFreeformModel, runtimeUsesGrimoireProvider } from '@shared/runtime-contract'
import { CherryProviderModelSelector } from './ProviderModelSelector'

afterEach(cleanup)

function renderSelector(contract?: { provider: 'grimoire' | 'runtime'; model: 'catalog' | 'freeform' }) {
  return render(<CherryProviderModelSelector
    providers={[{ id: 'p', name: 'Provider', default_model: 'm', models: ['m'] }]}
    provider={{ id: 'p', name: 'Provider', default_model: 'm', models: ['m'] }}
    catalogModels={[{ id: 'm', name: 'Model' }]}
    model="m"
    runtime="opencode"
    contract={contract}
    onProviderChange={vi.fn(async () => {})}
    ready={Boolean(contract)}
    onModelChange={vi.fn(async () => {})}
  />)
}

describe('runtime selection contract in the provider/model selector', () => {
  it('uses runtime-owned provider and freeform model metadata without a runtime-name branch', () => {
    renderSelector({ provider: 'runtime', model: 'freeform' })
    expect((screen.getByRole('button', { name: /Provider/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('本地 Runtime 不需要 Provider')).toBeTruthy()
    expect(screen.getByPlaceholderText('输入 Runtime 模型名')).toBeTruthy()
  })

  it('keeps the provider catalog when the contract says Grimoire owns selection', () => {
    renderSelector({ provider: 'grimoire', model: 'catalog' })
    expect((screen.getByRole('button', { name: /Provider/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('本地 Runtime 不需要 Provider')).toBeNull()
    expect(screen.queryByPlaceholderText('输入 Runtime 模型名')).toBeNull()
  })

  it('keeps missing runtime metadata pending with both selectors disabled', () => {
    renderSelector()
    expect(runtimeUsesGrimoireProvider(undefined)).toBe(false)
    expect(runtimeUsesFreeformModel(undefined)).toBe(false)
    expect(screen.getByText(/Runtime 状态加载中/)).toBeTruthy()
    expect(screen.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true)
  })
})
