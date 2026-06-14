// SendBar.tsx
import React from 'react'
import { ModelPicker } from './ModelPicker'

interface Props {
  providerName: string
  providers: Array<{ id: string; name: string }>
  providerId: string
  onProviderChange: (id: string) => void
  model: string
  models: string[]
  onModelChange: (model: string) => void
  tokenUsed: number
  tokenMax: number
  compressEnabled: boolean
  onCompressToggle: () => void
  onSend: () => void
  canSend: boolean
}

export function SendBar({
  providerName, providers, providerId, onProviderChange,
  model, models, onModelChange,
  tokenUsed, tokenMax, compressEnabled, onCompressToggle,
  onSend, canSend,
}: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <select
          value={providerId}
          onChange={e => onProviderChange(e.target.value)}
          className="appearance-none px-2 py-1 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] cursor-pointer pr-5"
        >
          {providers.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none opacity-50">v</span>
      </div>

      <ModelPicker models={models} selected={model} onSelect={onModelChange} />

      <div className="flex-1" />

      <span className="text-[10px] text-[var(--color-text-secondary)] opacity-60 tabular-nums"
        title={`已用 ${tokenUsed} / 上限 ${tokenMax} tokens`}>
        {tokenUsed}/{tokenMax}
      </span>

      <button
        onClick={onCompressToggle}
        className={"relative w-8 h-4 rounded-full transition-colors " +
          (compressEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]')}
        title={compressEnabled ? '自动压缩: 开' : '自动压缩: 关'}>
        <span className={"absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform " +
          (compressEnabled ? 'left-4' : 'left-0.5')} />
      </button>

      <button
        onClick={onSend}
        disabled={!canSend}
        className="px-3 py-1 text-xs font-medium bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity">
        发送
      </button>
    </div>
  )
}
