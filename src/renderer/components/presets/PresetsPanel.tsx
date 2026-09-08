// 魔导书 Grimoire v7 — 预设面板
import React, { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, FolderOpen, Layers3, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n/context'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { Modal } from '../ui/Modal'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'
import type { Preset } from '@shared/types'
import { ResourceCard, ResourceGroup } from '../ui/ResourceCards'

export function PresetsPanel() {
  const { t } = useI18n()
  const { getPresetData, loadPresetData, positive, negative } = usePromptsStore()
  const tags = useTagsStore(s => s.tags)
  const [presets, setPresets] = useState<Preset[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const loadPresets = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.presets.list()
      setPresets(list)
      setError(null)
    } catch (cause) {
      console.error('Failed to load presets:', cause)
      setError('预设加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])
  
  useEffect(() => { loadPresets() }, [loadPresets])
  useEffect(() => {
    const cleanup = window.api.db.onReload(() => loadPresets())
    return cleanup
  }, [loadPresets])
  
  const handleSave = async () => {
    if (!presetName.trim()) return
    setBusy('save')
    try {
      const data = getPresetData()
      await window.api.presets.save({ name: presetName.trim(), data })
      setPresetName('')
      setSaveOpen(false)
      await loadPresets()
      showToast(t.actions.presetSaved, 'success')
    } catch (cause) {
      console.error('Failed to save preset:', cause)
      showToast('保存预设失败', 'error')
    } finally { setBusy(null) }
  }
  
  const handleLoad = async (preset: Preset) => {
    const tagMap = new Map(tags.map(t => [t.id, t]))
    loadPresetData(preset.data, tagMap)
    showToast(`已加载预设: ${preset.name}`, 'success')
  }
  
  const handleDelete = async (id: string) => {
    setBusy('delete')
    try {
      await window.api.presets.delete(id)
      await loadPresets()
      setDeleteConfirm(null)
      showToast('预设已删除', 'success')
    } catch (cause) {
      console.error('Failed to delete preset:', cause)
      showToast('删除预设失败', 'error')
    } finally { setBusy(null) }
  }
  
  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <PanelHeader icon={Layers3} title='提示词预设' description={`${presets.length} 个已保存组合`} actions={<IconButton icon={RefreshCw} label='刷新预设' onClick={() => void loadPresets()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />} />
      {/* Save Button */}
      <Button variant='primary' icon={Plus} onClick={() => setSaveOpen(true)} disabled={positive.length === 0} className='w-full'>保存当前组合</Button>
      <div className='flex justify-center gap-2'><Badge tone='success'>正面 {positive.length}</Badge><Badge tone='danger'>负面 {negative.length}</Badge></div>
      {error && <div className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={15} aria-hidden='true' /><span className='flex-1'>{error}</span><Button size='sm' variant='ghost' onClick={() => void loadPresets()}>重试</Button></div>}
      
      {/* Preset List */}
      {loading && presets.length === 0 ? (
        <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载预设</div>
      ) : presets.length === 0 ? (
        <EmptyState icon={Layers3} title={t.presets.noPresets} description='组合好提示词后，可保存为预设重复使用' />
      ) : (
        <ResourceGroup id="presets:saved" title="已保存预设" count={presets.length}>
          {presets.map(preset => (
            <ResourceCard
              key={preset.id}
              className="p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{preset.name}</span>
                <IconButton icon={Trash2} label={`删除预设 ${preset.name}`} onClick={() => setDeleteConfirm(preset.id)} className='ui-icon-button-danger' />
              </div>
              <div className="flex gap-1"><Badge tone='success'>正面 {preset.data.positive.length}</Badge><Badge tone='danger'>负面 {preset.data.negative.length}</Badge></div>
              <div className="text-[10px] text-[var(--color-text-secondary)] opacity-60 mt-1">
                {new Date(preset.updated_at).toLocaleString('zh-CN')}
              </div>
              <Button size='sm' icon={FolderOpen} onClick={() => void handleLoad(preset)} className='mt-2 w-full'>{t.presets.load}</Button>
            </ResourceCard>
          ))}
        </ResourceGroup>
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
              className="ui-field mt-1"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div className="flex gap-2"><Badge tone='success'>正面 {positive.length}</Badge><Badge tone='danger'>负面 {negative.length}</Badge></div>
          <div className="flex gap-2">
            <Button onClick={() => setSaveOpen(false)} className='flex-1' disabled={busy === 'save'}>{t.app.cancel}</Button>
            <Button variant='primary' icon={Save} onClick={() => void handleSave()} disabled={!presetName.trim() || busy === 'save'} className='flex-1'>{busy === 'save' ? '保存中' : t.app.save}</Button>
          </div>
        </div>
      </Modal>
      
      {/* Delete Confirm */}
      <Modal title={t.app.delete} open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <div className="space-y-3">
          <p className="text-sm">{t.presets.deleteConfirm}</p>
          <div className="flex gap-2">
            <Button onClick={() => setDeleteConfirm(null)} className='flex-1' disabled={busy === 'delete'}>{t.app.cancel}</Button>
            <Button variant='danger' icon={Trash2} onClick={() => deleteConfirm && void handleDelete(deleteConfirm)} className='flex-1' disabled={busy === 'delete'}>{busy === 'delete' ? '删除中' : t.app.delete}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function showToast(message: string, type: 'success' | 'error' | 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}
