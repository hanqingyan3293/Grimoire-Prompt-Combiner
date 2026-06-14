// 魔导书 Grimoire v7 — 底部状态栏
import React, { useState, useEffect } from 'react'
import { useI18n } from '../../i18n/context'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { Modal } from '../ui/Modal'
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
      <div className="h-7 flex items-center justify-between px-3 text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] border-t border-[var(--color-border)] select-none">
        <div className="flex items-center gap-3">
          <span>🏷 {tags.length} 标签</span>
          <span>✅ 正面 {positive.length}</span>
          <span>❌ 负面 {negative.length}</span>
        </div>
        <div className="flex items-center gap-3">
          {errorCount > 0 && (
            <button
              onClick={() => { setErrorOpen(true); loadErrors() }}
              className="text-[var(--color-danger)] hover:text-red-400 cursor-pointer"
            >
              ⚠ {errorCount} 错误
            </button>
          )}
          <span>Grimoire v7.0.0 | GPL-3.0</span>
        </div>
      </div>
      
      {/* Error Log Modal */}
      <Modal title={t.errors.title} open={errorOpen} onClose={() => setErrorOpen(false)} maxWidth="max-w-2xl">
        {errorLogs.length === 0 ? (
          <div className="text-center text-[var(--color-text-secondary)] py-4">{t.settings.noErrors}</div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-auto">
            {errorLogs.map(log => (
              <div key={log.id} className="p-3 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border)]">
                <div className="text-sm text-[var(--color-danger)] font-medium mb-1">{log.message}</div>
                {log.stack && <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap mb-1">{log.stack.slice(0, 300)}</pre>}
                {log.context && <div className="text-xs text-[var(--color-text-secondary)] opacity-70">{log.context}</div>}
                <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">{log.created_at}</div>
              </div>
            ))}
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(errorLogs, null, 2))}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              {t.errors.copyError}
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
