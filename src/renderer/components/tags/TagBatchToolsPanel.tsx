// 魔导书 Grimoire v7 — 标签批量工具面板
// BDTM/SDIS batch semantics over asset links: build a target set from a tag
// filter (any/all/none) or the empty-assets scope, dry-run the counts, then
// apply add / remove / replace with an over-count confirmation and chunked
// execution. Position options are intentionally absent: asset links are
// orderless (BDTM position applies to ordered tag files only).
import { useState } from 'react'
import { Eraser, ListChecks, Play, Plus, Replace, Search } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import { TagAutocomplete } from './TagAutocomplete'
import { useTagsStore } from '../../stores/tags.store'

type BatchPreview = { total: number; sample: string[]; operationCount: number }
type BatchApplyResult = { total: number; applied: number; tagsTouched: string[] }

const CONFIRM_THRESHOLD = 200

export function TagBatchToolsPanel() {
  const allTags = useTagsStore(state => state.tags)
  const [assetType, setAssetType] = useState('image')
  const [filterTagIds, setFilterTagIds] = useState<string[]>([])
  const [logic, setLogic] = useState<'any' | 'all' | 'none'>('any')
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [opType, setOpType] = useState<'add' | 'remove' | 'replace'>('add')
  const [opTagIds, setOpTagIds] = useState<string[]>([])
  const [fromTagId, setFromTagId] = useState('')
  const [toTagId, setToTagId] = useState('')
  const [preview, setPreview] = useState<BatchPreview | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const nameOf = (id: string) => {
    const tag = allTags.find(item => item.id === id)
    return tag ? tag.zh || tag.en : id
  }

  const buildInput = () => ({
    filter: { assetType, tagIds: filterTagIds, logic },
    operation: opType === 'replace' ? { type: 'replace' as const, fromTagId, toTagId } : { type: opType, tagIds: opTagIds },
    onlyEmpty,
  })

  const validate = (): string | null => {
    if (opType !== 'replace' && opTagIds.length === 0) return '请先选择要操作的标签'
    if (opType === 'replace' && (!fromTagId || !toTagId)) return '替换操作需要源标签和目标标签'
    if (opType === 'replace' && fromTagId === toTagId) return '源标签和目标标签不能相同'
    if (!onlyEmpty && filterTagIds.length === 0) return '请选择筛选标签，或勾选"仅空文件"'
    return null
  }

  const runPreview = async () => {
    const invalid = validate()
    if (invalid) { setMessage(invalid); return }
    setBusy(true)
    setMessage('')
    try {
      const result = await window.api.tags.batchPreview(buildInput()) as BatchPreview
      setPreview(result)
      setMessage(result.total === 0 ? '目标集合为空' : `匹配 ${result.total} 个资产，预计 ${result.operationCount} 条写入`)
    } catch (error) {
      setPreview(null)
      setMessage(error instanceof Error ? error.message : '批量预览失败')
    } finally {
      setBusy(false)
    }
  }

  const runApply = async () => {
    setBusy(true)
    try {
      const result = await window.api.tags.batchApply({ ...buildInput(), chunkSize: 500 }) as BatchApplyResult
      setMessage(`已应用：${result.applied}/${result.total} 个资产（涉及 ${result.tagsTouched.length} 个标签）`)
      setPreview(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量执行失败')
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  const onApplyClick = () => {
    if (!preview) { setMessage('请先执行 dry-run 预览'); return }
    if (preview.total === 0) { setMessage('目标集合为空，无可应用项'); return }
    if (preview.total > CONFIRM_THRESHOLD) { setConfirmOpen(true); return }
    void runApply()
  }

  const renderPicker = (selected: string[], onChange: (ids: string[]) => void, placeholder: string) => (
    <div className="space-y-1.5">
      <TagAutocomplete
        allTags={allTags}
        placeholder={placeholder}
        excludeIds={selected}
        onSelect={item => onChange([...selected, item.id])}
      />
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map(id => (
            <span key={id} className="ui-prompt-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]">
              <span>{nameOf(id)}</span>
              <button type="button" aria-label={`移除${nameOf(id)}`} className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]" onClick={() => onChange(selected.filter(value => value !== id))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="标签批量工具" description="按筛选批量添加 / 删除 / 替换资产标签（先 dry-run 后应用）" />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-xs">
        <section className="space-y-2 rounded border border-[var(--color-border)] p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-[var(--color-text-primary)]"><Search size={13} aria-hidden="true" />目标筛选</span>
            <select value={assetType} onChange={event => setAssetType(event.target.value)} className="ui-field w-32" aria-label="资产类型">
              <option value="image">图片</option>
              <option value="prompt">提示词资产</option>
              <option value="canvas-node">画布节点</option>
            </select>
            <select value={logic} onChange={event => setLogic(event.target.value as 'any' | 'all' | 'none')} className="ui-field w-28" aria-label="匹配逻辑" disabled={onlyEmpty}>
              <option value="any">任一标签</option>
              <option value="all">全部标签</option>
              <option value="none">排除标签</option>
            </select>
            <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <input type="checkbox" checked={onlyEmpty} onChange={event => setOnlyEmpty(event.target.checked)} />
              仅空文件（无任何标签的资产）
            </label>
          </div>
          {renderPicker(
            filterTagIds,
            ids => { setFilterTagIds(ids); setPreview(null) },
            onlyEmpty ? '可选：与空文件集合再取交集' : '按标签筛选目标资产…',
          )}
        </section>

        <section className="space-y-2 rounded border border-[var(--color-border)] p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-[var(--color-text-primary)]"><ListChecks size={13} aria-hidden="true" />操作</span>
            <select value={opType} onChange={event => { setOpType(event.target.value as 'add' | 'remove' | 'replace'); setPreview(null) }} className="ui-field w-28" aria-label="操作类型">
              <option value="add">添加标签</option>
              <option value="remove">删除标签</option>
              <option value="replace">替换标签</option>
            </select>
          </div>
          {opType === 'replace' ? (
            <div className="space-y-2">
              <div>
                <div className="mb-1 inline-flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]"><Replace size={11} aria-hidden="true" />源标签</div>
                {renderPicker(fromTagId ? [fromTagId] : [], ids => { setFromTagId(ids[ids.length - 1] || ''); setPreview(null) }, '选择要替换掉的标签…')}
              </div>
              <div>
                <div className="mb-1 inline-flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]"><Plus size={11} aria-hidden="true" />目标标签</div>
                {renderPicker(toTagId ? [toTagId] : [], ids => { setToTagId(ids[ids.length - 1] || ''); setPreview(null) }, '选择替换为的标签…')}
              </div>
            </div>
          ) : (
            renderPicker(opTagIds, ids => { setOpTagIds(ids); setPreview(null) }, opType === 'add' ? '选择要添加的标签…' : '选择要删除的标签…')
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Button size="sm" icon={Play} onClick={() => void runPreview()} disabled={busy}>dry-run 预览</Button>
            <Button size="sm" variant="primary" icon={ListChecks} onClick={onApplyClick} disabled={busy || !preview}>应用</Button>
            {preview ? <StatusBadge tone={preview.total > 0 ? 'success' : 'neutral'}>{preview.total} 个资产 / {preview.operationCount} 条写入</StatusBadge> : null}
          </div>
          {preview && preview.sample.length > 0 ? (
            <div className="rounded border border-[var(--color-border)] p-2 text-[10px] text-[var(--color-text-secondary)]">
              样例：{preview.sample.join('、')}{preview.total > preview.sample.length ? ` … 其余 ${preview.total - preview.sample.length} 个` : ''}
            </div>
          ) : null}
          {message ? <div role="status" className="text-[11px] text-[var(--color-text-secondary)]">{message}</div> : null}
          {!preview && !message ? (
            <EmptyState icon={Eraser} title="先构建目标集合" description="筛选 + 操作 + dry-run 预览后才会写入" />
          ) : null}
        </section>
      </div>

      <Modal title="确认批量执行" open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <div className="space-y-4 p-2">
          <p className="text-sm">将于 {preview?.total ?? 0} 个资产上执行 {preview?.operationCount ?? 0} 条标签写入。大量写入不可撤销，确认继续？</p>
          <div className="flex gap-3 pt-2">
            <Button onClick={() => setConfirmOpen(false)} className="flex-1">取消</Button>
            <Button variant="danger" onClick={() => void runApply()} className="flex-1" disabled={busy}>确认执行</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}