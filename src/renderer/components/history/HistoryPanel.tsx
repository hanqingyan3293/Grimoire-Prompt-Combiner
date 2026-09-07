// 魔导书 Grimoire v7 — 历史记录面板
import React, { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Clock3, Copy, History, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n/context'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import type { HistoryItem } from '@shared/types'

export function HistoryPanel() {
  const { t } = useI18n()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [clearConfirm, setClearConfirm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.history.list()
      setHistory(list)
      setError(null)
    } catch (cause) {
      console.error('Failed to load history:', cause)
      setError('历史记录加载失败，请重试')
    } finally {
      setLoading(false)
    }
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
    setClearing(true)
    try {
      await window.api.history.clear()
      await loadHistory()
      setClearConfirm(false)
      showToast(t.actions.historyCleared, 'success')
    } catch (cause) {
      console.error('Failed to clear history:', cause)
      showToast('清空历史记录失败', 'error')
    } finally {
      setClearing(false)
    }
  }
  
  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <PanelHeader icon={History} title='历史记录' description={`${history.length} 条已保存提示词`} actions={<div className='flex gap-1'><IconButton icon={RefreshCw} label='刷新历史记录' onClick={() => void loadHistory()} disabled={loading} className={loading ? 'ui-spin-icon' : ''} />{history.length > 0 && <IconButton icon={Trash2} label={t.history.clearAll} onClick={() => setClearConfirm(true)} className='ui-icon-button-danger' />}</div>} />
      {error && <div className='ui-inline-alert text-xs' role='alert'><AlertTriangle size={15} aria-hidden='true' /><span className='flex-1'>{error}</span><Button size='sm' variant='ghost' onClick={() => void loadHistory()}>重试</Button></div>}
      
      {loading && history.length === 0 ? (
        <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载历史记录</div>
      ) : history.length === 0 ? (
        <EmptyState icon={History} title={t.history.noHistory} description='复制或生成提示词后，历史记录会显示在这里' />
      ) : (
        <div className="space-y-2">
          {history.map(item => (
            <div
              key={item.id}
              className="ui-list-card group p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]"><Clock3 size={12} aria-hidden='true' />
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                </span>
                <div className="flex gap-1">
                  <Badge tone='success'>正面 {item.positive_count}</Badge>
                  <Badge tone='danger'>负面 {item.negative_count}</Badge>
                </div>
              </div>
              <div className="text-xs text-[var(--color-text-primary)] font-mono break-all line-clamp-3 mb-2">
                {item.prompt}
              </div>
              <Button size='sm' variant='ghost' icon={Copy} onClick={() => void handleCopy(item.prompt)}>{t.app.copy}</Button>
            </div>
          ))}
        </div>
      )}
      
      {/* Clear Confirm */}
      <Modal title={t.history.clearAll} open={clearConfirm} onClose={() => setClearConfirm(false)}>
        <div className="space-y-3">
          <p className="text-sm">{t.history.clearConfirm}</p>
          <div className="flex gap-2">
            <Button onClick={() => setClearConfirm(false)} className='flex-1' disabled={clearing}>{t.app.cancel}</Button>
            <Button variant='danger' icon={Trash2} onClick={() => void handleClear()} className='flex-1' disabled={clearing}>{clearing ? '清空中' : t.app.delete}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function showToast(message: string, type: 'success' | 'error' | 'info') {
  window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { message, type } }))
}
