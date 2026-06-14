// 魔导书 Grimoire v7 — 预设面板
import React, { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n/context'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { Modal } from '../ui/Modal'
import type { Preset } from '@shared/types'

export function PresetsPanel() {
  const { t } = useI18n()
  const { getPresetData, loadPresetData, positive, negative } = usePromptsStore()
  const tags = useTagsStore(s => s.tags)
  const [presets, setPresets] = useState<Preset[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  
  const loadPresets = useCallback(async () => {
    try {
      const list = await window.api.presets.list()
      setPresets(list)
    } catch { /* ignore */ }
  }, [])
  
  useEffect(() => { loadPresets() }, [loadPresets])
  useEffect(() => {
    const cleanup = window.api.db.onReload(() => loadPresets())
    return cleanup
  }, [loadPresets])
  
  const handleSave = async () => {
    if (!presetName.trim()) return
    const data = getPresetData()
    await window.api.presets.save({ name: presetName.trim(), data })
    setPresetName('')
    setSaveOpen(false)
    await loadPresets()
    showToast(t.actions.presetSaved, 'success')
  }
  
  const handleLoad = async (preset: Preset) => {
    const tagMap = new Map(tags.map(t => [t.id, t]))
    loadPresetData(preset.data, tagMap)
    showToast(`已加载预设: ${preset.name}`, 'success')
  }
  
  const handleDelete = async (id: string) => {
    await window.api.presets.delete(id)
    await loadPresets()
    setDeleteConfirm(null)
  }
  
  return (
    <div className="p-3 space-y-3">
      {/* Save Button */}
      <button
          onClick={() => setSaveOpen(true)}
          disabled={positive.length === 0}
          className="w-full py-2.5 text-sm bg-[var(--color-accent)] text-white rounded hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
        >
          💾 保存当前 (正面{positive.length} + 负面{negative.length})
        </button>
      
      {/* Preset List */}
      {presets.length === 0 ? (
        <div className="text-center text-[var(--color-text-secondary)] py-8 text-sm">
          {t.presets.noPresets}
        </div>
      ) : (
        <div className="space-y-2">
          {presets.map(preset => (
            <div
              key={preset.id}
              className="p-3 rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{preset.name}</span>
                <button
                  onClick={() => setDeleteConfirm(preset.id)}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]"
                >
                  🗑
                </button>
              </div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                ✅ {preset.data.positive.length} 正面 | ❌ {preset.data.negative.length} 负面
              </div>
              <div className="text-[10px] text-[var(--color-text-secondary)] opacity-60 mt-1">
                {new Date(preset.updated_at).toLocaleString('zh-CN')}
              </div>
              <button
                onClick={() => handleLoad(preset)}
                className="mt-2 w-full py-1 text-xs bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded hover:bg-[var(--color-accent)]/25 transition-colors"
              >
                📂 {t.presets.load}
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* Save Modal */}
      <Modal title={t.presets.save} open={saveOpen} onClose={() => setSaveOpen(false)}>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-[var(--color-text-secondary)]">{t.presets.name}</label>
            <input
              type="text"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              placeholder={t.presets.name}
              className="w-full mt-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            ✅ {positive.length} 正面标签 | ❌ {negative.length} 负面标签
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSaveOpen(false)} className="flex-1 py-2 text-sm bg-[var(--color-bg-tertiary)] rounded">
              {t.app.cancel}
            </button>
            <button onClick={handleSave} disabled={!presetName.trim()} className="flex-1 py-2 text-sm bg-[var(--color-accent)] text-white rounded disabled:opacity-50">
              {t.app.save}
            </button>
          </div>
        </div>
      </Modal>
      
      {/* Delete Confirm */}
      <Modal title={t.app.delete} open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <div className="space-y-3">
          <p className="text-sm">{t.presets.deleteConfirm}</p>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 text-sm bg-[var(--color-bg-tertiary)] rounded">
              {t.app.cancel}
            </button>
            <button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="flex-1 py-2 text-sm bg-[var(--color-danger)] text-white rounded">
              {t.app.delete}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function showToast(message: string, type: 'success' | 'error' | 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}
