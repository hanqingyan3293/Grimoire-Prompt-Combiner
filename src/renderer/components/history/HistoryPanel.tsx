// 魔导书 Grimoire v7 — 历史记录面板
import React, { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n/context'
import { Modal } from '../ui/Modal'
import type { HistoryItem } from '@shared/types'

export function HistoryPanel() {
  const { t } = useI18n()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [clearConfirm, setClearConfirm] = useState(false)
  
  const loadHistory = useCallback(async () => {
    try {
      const list = await window.api.history.list()
      setHistory(list)
    } catch { /* ignore */ }
  }, [])
  
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => {
    const cleanup = window.api.db.onReload(() => loadHistory())
    return cleanup
  }, [loadHistory])
  
  const handleCopy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      showToast(t.history.copied, 'success')
    } catch {
      showToast(t.app.copyFailed, 'error')
    }
  }
  
  const handleClear = async () => {
    await window.api.history.clear()
    await loadHistory()
    setClearConfirm(false)
    showToast(t.actions.historyCleared, 'success')
  }
  
  return (
    <div className="p-3 space-y-3">
      {history.length > 0 && (
        <button
          onClick={() => setClearConfirm(true)}
          className="ui-subtle-button w-full py-1.5 text-xs hover:text-[var(--color-danger)]"
        >
          {t.history.clearAll}
        </button>
      )}
      
      {history.length === 0 ? (
        <div className="ui-empty-state text-sm">
          {t.history.noHistory}
        </div>
      ) : (
        <div className="space-y-2">
          {history.map(item => (
            <div
              key={item.id}
              className="ui-list-card group p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-[var(--color-text-secondary)]">
                    ✅{item.positive_count}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-secondary)]">
                    ❌{item.negative_count}
                  </span>
                </div>
              </div>
              <div className="text-xs text-[var(--color-text-primary)] font-mono break-all line-clamp-3 mb-2">
                {item.prompt}
              </div>
              <button
                onClick={() => handleCopy(item.prompt)}
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                📋 {t.app.copy}
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* Clear Confirm */}
      <Modal title={t.history.clearAll} open={clearConfirm} onClose={() => setClearConfirm(false)}>
        <div className="space-y-3">
          <p className="text-sm">{t.history.clearConfirm}</p>
          <div className="flex gap-2">
            <button onClick={() => setClearConfirm(false)} className="ui-subtle-button flex-1 py-2 text-sm">
              {t.app.cancel}
            </button>
            <button onClick={handleClear} className="flex-1 py-2 text-sm bg-[var(--color-danger)] text-white rounded">
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
