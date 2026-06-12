import React, { useEffect, useState } from 'react'
import { usePromptsStore, PanelTag } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'

interface PresetsModalProps {
  onClose: () => void
  showToast: (msg: string, type?: string) => void
}

interface Preset {
  id: string
  name: string
  data: {
    positive?: PanelTag[]
    negative?: PanelTag[]
    tags?: string[]
    weights?: Record<string, number>
    negative_tags?: string[]
    negative_weights?: Record<string, number>
    qualityWords?: boolean
  }
  created_at: string
}

const PresetsModal: React.FC<PresetsModalProps> = ({ onClose, showToast }) => {
  const [presets, setPresets] = useState<Preset[]>([])
  const [saveName, setSaveName] = useState('')
  const { positive, negative, qualityWords, clearPositive, clearNegative } = usePromptsStore()
  const { categories } = useTagsStore()

  useEffect(() => { loadPresets() }, [])

  const loadPresets = async () => {
    try {
      const r = await window.electronAPI.presets.getAll()
      setPresets(r.presets || [])
    } catch {}
  }

  const handleSave = async () => {
    if (!saveName.trim()) return
    await window.electronAPI.presets.save({
      name: saveName.trim(),
      data: { positive, negative, qualityWords }
    })
    showToast('预设已保存', 'success')
    setSaveName('')
    await loadPresets()
  }

  const handleLoad = (preset: Preset) => {
    const store = usePromptsStore.getState()
    store.clearPositive()
    store.clearNegative()

    // Restore from saved PanelTag[] (v5 format)
    if (preset.data.positive && Array.isArray(preset.data.positive) && preset.data.positive.length > 0) {
      preset.data.positive.forEach((t: any) => {
        if (t.tag && t.tag.en) {
          store.addPositive({
            tag: {
              id: t.tag.id || t.tag.en,
              subcategory_id: t.tag.subcategory_id || '',
              en: t.tag.en,
              zh: t.tag.zh || '',
              sort_order: t.tag.sort_order || 0,
              source: t.tag.source || 'builtin',
              created_at: t.tag.created_at || ''
            },
            weight: t.weight || 1.0,
            category: t.category || '',
            subcategory: t.subcategory || ''
          })
        }
      })
    }
    // Fallback: restore from tags[] (v4 format)
    else if (preset.data.tags && Array.isArray(preset.data.tags)) {
      const allTags = categories.flatMap(c =>
        (c.subcategories || []).flatMap(s =>
          (s.tags || []).map(t => ({ ...t, _cat: c.name, _sub: s.name }))
        )
      )
      for (const tagName of preset.data.tags) {
        const found = allTags.find(t => t.en === tagName || t.zh === tagName)
        if (found) {
          store.addPositive({
            tag: {
              id: found.id,
              subcategory_id: found.subcategory_id,
              en: found.en,
              zh: found.zh,
              sort_order: found.sort_order || 0,
              source: found.source || 'builtin',
              created_at: found.created_at || ''
            },
            weight: preset.data.weights?.[tagName] || 1.0,
            category: found._cat || '',
            subcategory: found._sub || ''
          })
        }
      }
    }

    if (preset.data.negative && Array.isArray(preset.data.negative)) {
      preset.data.negative.forEach((t: any) => {
        if (t.tag && t.tag.en) store.addNegative({
          tag: {
            id: t.tag.id || t.tag.en,
            subcategory_id: t.tag.subcategory_id || '',
            en: t.tag.en,
            zh: t.tag.zh || '',
            sort_order: t.tag.sort_order || 0,
            source: t.tag.source || 'builtin',
            created_at: t.tag.created_at || ''
          },
          weight: t.weight || 1.0,
          category: t.category || '',
          subcategory: t.subcategory || ''
        })
      })
    }

    showToast('已加载: ' + preset.name, 'success')
    onClose()
  }

  const handleDelete = async (id: string) => {
    await window.electronAPI.presets.delete(id)
    showToast('预设已删除', 'success')
    await loadPresets()
  }

  const handleExport = async (id: string) => {
    const data = await window.electronAPI.presets.export(id)
    const json = JSON.stringify(data, null, 2)
    await navigator.clipboard.writeText(json)
    showToast('已复制到剪贴板', 'success')
  }

  const handleImport = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const data = JSON.parse(text)
      await window.electronAPI.presets.import(data)
      showToast('预设已导入', 'success')
      await loadPresets()
    } catch {
      showToast('导入失败：剪贴板内容无效', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-lg mx-4 p-6 rounded-xl max-h-[80vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-accent)' }}>💾 预设管理</h2>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="预设名称..."
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button onClick={handleSave} className="btn btn-primary">保存</button>
          <button onClick={handleImport} className="btn btn-sm" title="从剪贴板导入JSON">📥</button>
        </div>

        <div className="text-xs mb-3 px-2" style={{ color: 'var(--color-text-muted)' }}>
          当前: {positive.length} 正面 + {negative.length} 负面标签
        </div>

        <div className="space-y-2">
          {presets.length === 0 ? (
            <p className="text-center py-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>暂无预设 — 添加标签后保存</p>
          ) : (
            presets.map(p => (
              <div key={p.id} className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {p.data.tags?.length || p.data.positive?.length || 0} 标签 | {p.created_at}
                  </div>
                </div>
                <button onClick={() => handleLoad(p)} className="btn btn-sm btn-primary">加载</button>
                <button onClick={() => handleExport(p.id)} className="btn btn-sm">📋</button>
                <button onClick={() => handleDelete(p.id)} className="btn btn-sm btn-danger">🗑️</button>
              </div>
            ))
          )}
        </div>

        <button onClick={onClose} className="btn w-full mt-4">关闭</button>
      </div>
    </div>
  )
}

export default PresetsModal