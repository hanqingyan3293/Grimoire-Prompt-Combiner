// 魔导书 Grimoire v7 — 底部状态栏
import React, { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Copy, Tag, XCircle } from 'lucide-react'
import { useI18n } from '../../i18n/context'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Feedback'
import type { ErrorLog } from '@shared/types'

export function StatusBar() {
  const { t } = useI18n()
  const positive = usePromptsStore(s => s.positive)
  const negative = usePromptsStore(s => s.negative)
  const tags = useTagsStore(s => s.tags)
  const [errorOpen, setErrorOpen] = useState(false)
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([])
  const [errorCount, setErrorCount] = useState(0)
  
  const loadErrors = async () => {
    try {
      const logs = await window.api.error.getAll()
      setErrorLogs(logs)
      setErrorCount(logs.length)
    } catch { /* ignore */ }
  }
  
  useEffect(() => { loadErrors() }, [])
  
  return (
    <>
      <div className="ui-app-chrome flex h-7 items-center justify-between border-t border-[var(--color-border)] px-3 text-[11px] select-none">
        <div className="flex items-center gap-2">
          <span className="ui-status-pill"><Tag size={11} aria-hidden='true' />{tags.length} 标签</span>
          <span className="ui-status-pill"><CheckCircle2 size={11} className='text-[var(--color-success)]' aria-hidden='true' />正面 {positive.length}</span>
          <span className="ui-status-pill"><XCircle size={11} className='text-[var(--color-danger)]' aria-hidden='true' />负面 {negative.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <button
              onClick={() => { setErrorOpen(true); loadErrors() }}
              className="ui-status-pill ui-status-error hover:brightness-110"
            >
              <AlertTriangle size={11} aria-hidden='true' />{errorCount} 错误
            </button>
          )}
          <span className="ui-status-pill">Grimoire v7.2.0 | AGPL-3.0</span>
        </div>
      </div>
      
      {/* Error Log Modal */}
      <Modal title={t.errors.title} open={errorOpen} onClose={() => setErrorOpen(false)} maxWidth="max-w-2xl">
        {errorLogs.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t.settings.noErrors} description='应用运行期间记录到的错误会显示在这里' />
        ) : (
          <div className="space-y-3 max-h-96 overflow-auto">
            {errorLogs.map(log => (
              <div key={log.id} className="ui-list-card p-3">
                <div className="text-sm text-[var(--color-danger)] font-medium mb-1">{log.message}</div>
                {log.stack && <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap mb-1">{log.stack.slice(0, 300)}</pre>}
                {log.context && <div className="text-xs text-[var(--color-text-secondary)] opacity-70">{log.context}</div>}
                <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">{log.created_at}</div>
              </div>
            ))}
            <Button size='sm' icon={Copy} onClick={() => void navigator.clipboard.writeText(JSON.stringify(errorLogs, null, 2))}>{t.errors.copyError}</Button>
          </div>
        )}
      </Modal>
    </>
  )
}
