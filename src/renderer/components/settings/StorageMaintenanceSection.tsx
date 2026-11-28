// 数据页的「维护」区块：清理候选 + 自动备份 + 待清理区。
//
// 和导出/导入一样遵守「先看再动」：清理弹窗列出每一项的路径、体积和理由，用户勾选后才移动；
// 备份列表显示时间与体积，恢复前明确提示会重启。

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Archive, CheckCircle2, HardDriveDownload, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { formatStorageBytes } from '../../../shared/storage-types'

type CleanupCandidate = {
  id: string; label: string; paths: string[]; bytes: number; files: number
  reason: string; kind: 'file' | 'directory'; requiresRestart?: boolean
}
type TrashRecord = { id: string; label: string; originalPath: string; bytes: number; reason: string; createdAt: string; kind: 'file' | 'directory' }
type BackupRecord = { path: string; bytes: number; createdAt: string }

export function StorageMaintenanceSection({ onChanged }: { onChanged?: () => void }) {
  const [candidates, setCandidates] = useState<CleanupCandidate[]>([])
  const [trash, setTrash] = useState<TrashRecord[]>([])
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)

  const load = useCallback(async () => {
    const api = window.api?.storage
    if (!api) return
    try {
      const [plan, trashList, backupList] = await Promise.all([api.cleanupPlan(), api.trashList(), api.backupsList()])
      setCandidates(Array.isArray(plan) ? plan : [])
      setTrash(Array.isArray(trashList) ? trashList : [])
      setBackups(Array.isArray(backupList) ? backupList : [])
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '读取维护信息失败' })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const totalReclaimable = candidates.reduce((total, candidate) => total + candidate.bytes, 0)
  const totalTrash = trash.reduce((total, record) => total + record.bytes, 0)

  const applyCleanup = async () => {
    const api = window.api?.storage
    if (!api) return
    const ids = Object.keys(picked).filter((id) => picked[id])
    if (ids.length === 0) return
    setBusy('cleanup')
    try {
      const result = await api.cleanupApply(ids)
      setCleanupOpen(false)
      setPicked({})
      setMessage({ tone: 'success', text: `已移入待清理区 ${result.moved} 项（24 小时后或手动确认才真正删除）` })
      await load()
      onChanged?.()
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '清理失败' })
    } finally {
      setBusy(null)
    }
  }

  const runBackup = async () => {
    const api = window.api?.storage
    if (!api) return
    setBusy('backup')
    try {
      const record = await api.backupsCreate()
      setMessage({ tone: 'success', text: `已备份：${record.path}（${formatStorageBytes(record.bytes)}）` })
      await load()
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '备份失败' })
    } finally {
      setBusy(null)
    }
  }

  const restore = async (filePath: string) => {
    const api = window.api?.storage
    if (!api) return
    setBusy('restore')
    try {
      await api.backupsRestore(filePath)
      setMessage({ tone: 'success', text: '已恢复该备份，重启应用后生效（当前库已自动留 .before-import 副本）。' })
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : '恢复失败' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="ui-list-card ui-list-card-no-hover space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Archive size={16} className="text-[var(--color-accent-text)]" aria-hidden="true" />
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">清理与备份</span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          可回收 {formatStorageBytes(totalReclaimable)}{trash.length > 0 ? ` · 待清理区 ${trash.length} 项 ${formatStorageBytes(totalTrash)}` : ''}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setCleanupOpen(true)} disabled={busy !== null || candidates.length === 0}>
            清理
          </Button>
          <Button size="sm" variant="ghost" icon={HardDriveDownload} onClick={() => void runBackup()} disabled={busy !== null}>
            {busy === 'backup' ? '备份中' : '立即备份'}
          </Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={busy !== null}>刷新</Button>
        </div>
      </div>

      {message && (
        <div className={`ui-inline-note ui-inline-note-${message.tone === 'success' ? 'success' : message.tone === 'danger' ? 'danger' : 'info'} text-[11px]`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.tone === 'success' ? <CheckCircle2 size={14} aria-hidden="true" /> : message.tone === 'danger' ? <AlertTriangle size={14} aria-hidden="true" /> : null}
          <span className="min-w-0 flex-1 break-all">{message.text}</span>
        </div>
      )}

      {/* 自动备份列表 */}
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">自动备份（每天一次，保留最近 7 份且不超过 200MB）</div>
        {backups.length === 0 && <div className="text-[11px] text-[var(--color-text-secondary)]">还没有备份；应用首次运行当天会自动做一份。</div>}
        {backups.slice(0, 7).map((record) => (
          <div key={record.path} className="flex min-w-0 items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate" title={record.path}>{record.createdAt.slice(0, 19).replace('T', ' ')}</span>
            <span className="shrink-0 tabular-nums text-[var(--color-text-secondary)]">{formatStorageBytes(record.bytes)}</span>
            <Button size="sm" variant="ghost" onClick={() => void restore(record.path)} disabled={busy !== null}>恢复</Button>
          </div>
        ))}
      </div>

      {/* 待清理区 */}
      {trash.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">待清理区（可还原）</div>
          {trash.slice(0, 6).map((record) => (
            <div key={record.id} className="flex min-w-0 items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate" title={record.originalPath}>{record.label}</span>
              <span className="shrink-0 tabular-nums text-[var(--color-text-secondary)]">{formatStorageBytes(record.bytes)}</span>
              <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void window.api.storage.trashRestore(record.id).then(load)} disabled={busy !== null}>还原</Button>
            </div>
          ))}
        </div>
      )}

      <Modal title="清理" open={cleanupOpen} onClose={() => setCleanupOpen(false)} maxWidth="max-w-lg">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">
            勾选的项会移进待清理区（不是直接删除），24 小时后或手动确认才真正清掉。可随时还原。
          </p>
          <div className="max-h-64 space-y-2 overflow-auto">
            {candidates.map((candidate) => (
              <label key={candidate.id} className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(picked[candidate.id])}
                  onChange={(event) => setPicked((current) => ({ ...current, [candidate.id]: event.target.checked }))}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{candidate.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[var(--color-text-secondary)]">{formatStorageBytes(candidate.bytes)}</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--color-text-secondary)]">{candidate.reason} · {candidate.files} 个文件</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCleanupOpen(false)} disabled={busy === 'cleanup'}>取消</Button>
            <Button size="sm" variant="primary" icon={Trash2} onClick={() => void applyCleanup()} disabled={busy === 'cleanup' || Object.values(picked).every((value) => !value)}>
              {busy === 'cleanup' ? '清理中' : '移入待清理区'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
