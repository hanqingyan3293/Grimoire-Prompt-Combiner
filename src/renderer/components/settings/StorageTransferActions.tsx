// 数据存储的备份 / 恢复入口。
//
// 交互原则：先看再动。
//  * 导出：整库备份 / 选中条目两种模式；带媒体是整库才有的选项。
//  * 导入：先 inspect（格式、版本、条目）→ 明确告知后果（整库替换需重启 / 选择性导入只写选中表）
//    → 用户确认才 apply。
//  * 进度来自主进程事件 `storage:transferProgress`，失败时保留对话框并显示原因。

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Download, FileArchive, Info, LoaderCircle, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { formatStorageBytes, type StorageEntry, type StorageInventory } from '../../../shared/storage-types'
import type { ImportInspection, TransferProgress } from '../../../shared/storage-transfer-types'

type Busy = 'export' | 'diagnostics' | 'inspect' | 'apply' | null
type Conflict = 'keep-both' | 'skip' | 'overwrite'

const PHASE_LABELS: Record<TransferProgress['phase'], string> = {
  preparing: '准备中',
  compressing: '打包中',
  verifying: '校验中',
  writing: '写入中',
  done: '完成',
  failed: '失败',
}

const CONFLICT_LABELS: Record<Conflict, { label: string; hint: string }> = {
  'keep-both': { label: '保留双方', hint: '主键冲突时改 id 后插入，两份都留着' },
  skip: { label: '跳过重复', hint: '已存在的条目不动' },
  overwrite: { label: '覆盖', hint: '用包里的数据替换同名条目' },
}

export function StorageTransferActions({ inventory, onImported }: { inventory: StorageInventory | null; onImported?: () => void }) {
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [includeMedia, setIncludeMedia] = useState(false)
  const [exportMode, setExportMode] = useState<'full' | 'selection'>('full')
  const [selectedEntries, setSelectedEntries] = useState<Record<string, boolean>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [inspection, setInspection] = useState<ImportInspection | null>(null)
  const [importTables, setImportTables] = useState<Record<string, boolean>>({})
  const [conflict, setConflict] = useState<Conflict>('keep-both')
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  useEffect(() => {
    const api = window.api?.storage
    if (!api?.onTransferProgress) return
    unsubscribe.current = api.onTransferProgress((next) => setProgress(next))
    return () => { unsubscribe.current?.(); unsubscribe.current = null }
  }, [])

  const exportable = (inventory?.groups ?? [])
    .flatMap((group) => group.entries)
    .filter((entry: StorageEntry) => entry.exportable && entry.kind === 'table')

  const runExport = async () => {
    const api = window.api?.storage
    if (!api) return
    setBusy('export')
    setProgress(null)
    try {
      const ids = Object.keys(selectedEntries).filter((id) => selectedEntries[id])
      const result = exportMode === 'selection'
        ? (ids.length === 0 ? null : await api.exportSelection(ids))
        : await api.exportBackup({ includeMedia })
      if (!result) { setBusy(null); return }
      setExportOpen(false)
      setMessage({ tone: 'success', text: `已导出到 ${result.path}（${formatStorageBytes(result.manifest.totals.bytes)}）` })
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '导出失败' })
    } finally {
      setBusy(null)
    }
  }

  const runDiagnostics = async () => {
    const api = window.api?.storage
    if (!api) return
    setBusy('diagnostics')
    try {
      const result = await api.exportDiagnostics()
      if (result) setMessage({ tone: 'success', text: `诊断包已导出：${result.path}` })
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '导出诊断包失败' })
    } finally {
      setBusy(null)
    }
  }

  const pickImport = async () => {
    const api = window.api?.storage
    if (!api) return
    setBusy('inspect')
    setProgress(null)
    try {
      const result = await api.inspectImport()
      if (!result) { setBusy(null); return }
      setInspection(result)
      // 默认全选：用户既然选了包，通常是要全部内容；取消勾选比逐个勾选省事。
      setImportTables(Object.fromEntries(result.items.map((item) => [item.id, true])))
      setImportOpen(true)
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '无法识别这个文件' })
    } finally {
      setBusy(null)
    }
  }

  const runImport = async () => {
    const api = window.api?.storage
    if (!api || !inspection) return
    setBusy('apply')
    try {
      const tables = inspection.kind === 'partial'
        ? inspection.items.filter((item) => importTables[item.id]).map((item) => item.id.replace(/^db\./, ''))
        : undefined
      const result = await api.applyImport({ filePath: inspection.path, tables, conflict })
      setImportOpen(false)
      setMessage({
        tone: 'success',
        text: result.kind === 'partial'
          ? `选择性导入完成，写入 ${result.restoredEntries} 条。`
          : result.restartRequired ? '导入完成，重启应用后生效（当前库已自动备份为 .before-import 文件）。' : '导入完成。',
      })
      onImported?.()
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '导入失败' })
    } finally {
      setBusy(null)
    }
  }

  const progressLine = progress && progress.phase !== 'done' ? (
    <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]" role="status">
      <LoaderCircle size={12} className="ui-spin" aria-hidden="true" />
      {PHASE_LABELS[progress.phase]}{progress.message ? ` · ${progress.message}` : ''}
    </div>
  ) : null

  const selectedCount = Object.values(selectedEntries).filter(Boolean).length
  const importTableCount = Object.values(importTables).filter(Boolean).length

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={Download} onClick={() => setExportOpen(true)} disabled={busy !== null}>导出</Button>
        <Button size="sm" variant="ghost" icon={Upload} onClick={() => void pickImport()} disabled={busy !== null}>
          {busy === 'inspect' ? '识别中' : '导入'}
        </Button>
        <Button size="sm" variant="ghost" icon={FileArchive} onClick={() => void runDiagnostics()} disabled={busy !== null}>
          {busy === 'diagnostics' ? '导出中' : '诊断包'}
        </Button>
      </div>

      {progressLine}

      {message && (
        <div className={`ui-inline-note ui-inline-note-${message.tone === 'success' ? 'success' : message.tone === 'danger' ? 'danger' : 'info'} text-[11px]`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.tone === 'success' ? <CheckCircle2 size={14} aria-hidden="true" /> : message.tone === 'danger' ? <AlertTriangle size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}
          <span className="min-w-0 flex-1 break-all">{message.text}</span>
        </div>
      )}

      <Modal title="导出备份" open={exportOpen} onClose={() => setExportOpen(false)} maxWidth="max-w-lg">
        <div className="space-y-3 text-sm">
          <div className="ui-segmented flex" role="group" aria-label="导出范围">
            <button type="button" className={`ui-segmented-item min-w-0 flex-1 text-xs ${exportMode === 'full' ? 'ui-segmented-item-active' : ''}`} aria-pressed={exportMode === 'full'} onClick={() => setExportMode('full')}>整库备份</button>
            <button type="button" className={`ui-segmented-item min-w-0 flex-1 text-xs ${exportMode === 'selection' ? 'ui-segmented-item-active' : ''}`} aria-pressed={exportMode === 'selection'} onClick={() => setExportMode('selection')}>选中条目</button>
          </div>

          {exportMode === 'full' ? (
            <>
              <p className="text-xs text-[var(--color-text-secondary)]">把整个数据库打成 zip（内部先做 <code className="font-mono">VACUUM INTO</code> 一致快照），附一份带 sha256 的 manifest。</p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={includeMedia} onChange={(event) => setIncludeMedia(event.target.checked)} />
                同时打包媒体文件（可能很大）
              </label>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-secondary)]">只导出选中的表（父表会自动带上，避免导入时出现孤立引用）。已选 {selectedCount} 项。</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedEntries(Object.fromEntries(exportable.map((entry) => [entry.id, true])))}>全选</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedEntries({})}>清空</Button>
              </div>
              <div className="max-h-64 space-y-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
                {exportable.length === 0 && <div className="text-xs text-[var(--color-text-secondary)]">没有可导出的条目</div>}
                {exportable.map((entry) => (
                  <label key={entry.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedEntries[entry.id])}
                      onChange={(event) => setSelectedEntries((current) => ({ ...current, [entry.id]: event.target.checked }))}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{entry.rows ?? 0} 行</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {progressLine}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExportOpen(false)} disabled={busy === 'export'}>取消</Button>
            <Button size="sm" variant="primary" icon={Download} onClick={() => void runExport()} disabled={busy === 'export' || (exportMode === 'selection' && selectedCount === 0)}>
              {busy === 'export' ? '导出中' : '选择位置并导出'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal title="导入备份" open={importOpen} onClose={() => setImportOpen(false)} maxWidth="max-w-lg">
        {inspection && (
          <div className="space-y-3 text-sm">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2 text-xs">
              <div className="flex items-center gap-2">
                <Database size={14} className="text-[var(--color-accent-text)]" aria-hidden="true" />
                <span className="font-medium">{inspection.kind === 'full' ? '完整备份包' : inspection.kind === 'database' ? '数据库文件' : '选择性备份包'}</span>
                <span className="ml-auto text-[var(--color-text-secondary)]">{formatStorageBytes(inspection.totals.bytes)}</span>
              </div>
              <div className="mt-1 break-all text-[10px] text-[var(--color-text-secondary)]">{inspection.path}</div>
              <div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
                {inspection.appVersion ? `应用 ${inspection.appVersion} · ` : ''}
                {inspection.schemaVersion !== undefined ? `schema ${inspection.schemaVersion} · ` : ''}
                {inspection.items.length} 个条目
              </div>
            </div>

            {!inspection.compatible && (
              <div className="ui-inline-note ui-inline-note-danger text-[11px]" role="alert">
                <AlertTriangle size={14} aria-hidden="true" /><span>{inspection.reason ?? '该文件与当前版本不兼容'}</span>
              </div>
            )}

            {inspection.compatible && inspection.kind === 'partial' && (
              <>
                <div className="text-[11px] text-[var(--color-text-secondary)]">选择要写入的表（已选 {importTableCount} 项，按父表优先顺序写入）</div>
                <div className="max-h-52 space-y-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
                  {inspection.items.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(importTables[item.id])}
                        onChange={(event) => setImportTables((current) => ({ ...current, [item.id]: event.target.checked }))}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{item.rows ?? 0} 行</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] text-[var(--color-text-secondary)]">冲突处理</div>
                  <div className="ui-segmented flex" role="group" aria-label="冲突处理">
                    {(Object.keys(CONFLICT_LABELS) as Conflict[]).map((policy) => (
                      <button
                        key={policy}
                        type="button"
                        className={`ui-segmented-item min-w-0 flex-1 text-xs ${conflict === policy ? 'ui-segmented-item-active' : ''}`}
                        aria-pressed={conflict === policy}
                        title={CONFLICT_LABELS[policy].hint}
                        onClick={() => setConflict(policy)}
                      >{CONFLICT_LABELS[policy].label}</button>
                    ))}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-secondary)]">{CONFLICT_LABELS[conflict].hint}</div>
                </div>
              </>
            )}

            {inspection.compatible && inspection.kind !== 'partial' && (
              <div className="ui-inline-note ui-inline-note-warning text-[11px]" role="status">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>这会替换当前整个数据库。替换前会自动把当前库备份为 <code className="font-mono">.before-import-*.bak</code>，导入后需要重启应用。</span>
              </div>
            )}

            {progressLine}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)} disabled={busy === 'apply'}>取消</Button>
              <Button
                size="sm"
                variant="primary"
                icon={Upload}
                onClick={() => void runImport()}
                disabled={!inspection.compatible || busy === 'apply' || (inspection.kind === 'partial' && importTableCount === 0)}
              >
                {busy === 'apply' ? '导入中' : '确认导入'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
