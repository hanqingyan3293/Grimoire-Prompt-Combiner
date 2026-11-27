// 数据存储的备份 / 恢复入口。
//
// 交互刻意做成「先看再动」：
//  * 导出：选是否带媒体 → 显示打包进度 → 完成后给出路径与体积。
//  * 导入：先 inspect（识别格式、版本、条目数）→ 明确告诉用户会发生什么（整库替换 / 需要重启）
//    → 用户点确认才 apply。绝不在选完文件后直接覆盖数据。
//  * 进度来自主进程事件 `storage:transferProgress`，失败时保留对话框并显示原因。

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Download, FileArchive, Info, LoaderCircle, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { formatStorageBytes } from '../../../shared/storage-types'
import type { ImportInspection, TransferProgress } from '../../../shared/storage-transfer-types'

type Busy = 'export' | 'diagnostics' | 'inspect' | 'apply' | null

const PHASE_LABELS: Record<TransferProgress['phase'], string> = {
  preparing: '准备中',
  compressing: '打包中',
  verifying: '校验中',
  writing: '写入中',
  done: '完成',
  failed: '失败',
}

export function StorageTransferActions({ onImported }: { onImported?: () => void }) {
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [includeMedia, setIncludeMedia] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [inspection, setInspection] = useState<ImportInspection | null>(null)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  useEffect(() => {
    const api = window.api?.storage
    if (!api?.onTransferProgress) return
    unsubscribe.current = api.onTransferProgress((next) => setProgress(next))
    return () => { unsubscribe.current?.(); unsubscribe.current = null }
  }, [])

  const runExport = async () => {
    const api = window.api?.storage
    if (!api) return
    setBusy('export')
    setProgress(null)
    try {
      const result = await api.exportBackup({ includeMedia })
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
      const result = await api.applyImport(inspection.path)
      setImportOpen(false)
      setMessage({
        tone: 'success',
        text: result.restartRequired ? '导入完成，重启应用后生效（当前库已自动备份为 .before-import 文件）。' : '导入完成。',
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

      <Modal title="导出完整备份" open={exportOpen} onClose={() => setExportOpen(false)} maxWidth="max-w-md">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">
            会把数据库打成一个 zip（内部先做 <code className="font-mono">VACUUM INTO</code> 一致快照），并附一份带 sha256 的 manifest。
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={includeMedia} onChange={(event) => setIncludeMedia(event.target.checked)} />
            同时打包媒体文件（可能很大）
          </label>
          {progressLine}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExportOpen(false)} disabled={busy === 'export'}>取消</Button>
            <Button size="sm" variant="primary" icon={Download} onClick={() => void runExport()} disabled={busy === 'export'}>
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
                <span className="font-medium">{inspection.kind === 'full' ? '完整备份包' : inspection.kind === 'database' ? '数据库文件' : '部分备份包'}</span>
                <span className="ml-auto text-[var(--color-text-secondary)]">{formatStorageBytes(inspection.totals.bytes)}</span>
              </div>
              <div className="mt-1 break-all text-[10px] text-[var(--color-text-secondary)]">{inspection.path}</div>
              <div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
                {inspection.appVersion ? `应用 ${inspection.appVersion} · ` : ''}
                {inspection.schemaVersion !== undefined ? `schema ${inspection.schemaVersion} · ` : ''}
                {inspection.items.length} 个条目 · {inspection.files.length} 个文件
              </div>
            </div>

            {!inspection.compatible && (
              <div className="ui-inline-note ui-inline-note-danger text-[11px]" role="alert">
                <AlertTriangle size={14} aria-hidden="true" /><span>{inspection.reason ?? '该文件与当前版本不兼容'}</span>
              </div>
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
              <Button size="sm" variant="primary" icon={Upload} onClick={() => void runImport()} disabled={!inspection.compatible || busy === 'apply'}>
                {busy === 'apply' ? '导入中' : '确认导入'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
