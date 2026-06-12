import React, { useEffect, useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useI18n } from '../../i18n/context'
import PanelSection from '../ui/PanelSection'

interface HistoryPanelProps { showToast: (msg: string, type?: string) => void }

const HistoryPanel: React.FC<HistoryPanelProps> = ({ showToast }) => {
  const { t } = useI18n()
  const [history, setHistory] = useState<any[]>([])
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [view, setView] = useState<'history' | 'snapshots'>('history')

  useEffect(() => {
    loadHistory()
    loadSnapshots()
  }, [])

  const loadHistory = async () => {
    try { const h = await window.electronAPI.history.getAll(); setHistory(Array.isArray(h) ? h : []) } catch { setHistory([]) }
  }
  const loadSnapshots = async () => {
    try { const s = await window.electronAPI.history.getSnapshots(); setSnapshots(Array.isArray(s) ? s : []) } catch { setSnapshots([]) }
  }

  const restoreSnapshot = async (s: any) => {
    const store = usePromptsStore.getState()
    if (s.data) {
      store.clearPositive(); store.clearNegative()
      if (s.data.positive) for (const pt of s.data.positive) store.addPositive(pt)
      if (s.data.negative) for (const nt of s.data.negative) store.addNegative(nt)
    }
    showToast(t('history.restored'), 'success')
  }

  const clearAll = async () => {
    try { await window.electronAPI.history.clearAll(); await loadHistory(); await loadSnapshots(); showToast(t('history.deleted'), 'success') } catch {}
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, padding: 8, borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={() => setView('history')} className={'ps-btn ps-btn--sm' + (view === 'history' ? ' ps-btn--primary' : '')}>{t('history.tabHistory')}</button>
        <button onClick={() => setView('snapshots')} className={'ps-btn ps-btn--sm' + (view === 'snapshots' ? ' ps-btn--primary' : '')}>{t('history.tabSnapshots')}</button>
        <div style={{ flex: 1 }} />
        <button onClick={clearAll} className="ps-btn ps-btn--sm ps-btn--danger" title={t('history.clearAll')}>{t('history.clearAll')}</button>
      </div>

      {view === 'history' ? (
        <PanelSection title={t('panels.history.operations')} badge={String(history.length)}>
          <div style={{ padding: 4 }}>
            {history.length === 0 ? (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)', padding: 16, textAlign: 'center' }}>{t('history.noHistory')}</div>
            ) : (
              history.slice().reverse().map((h: any, i: number) => (
                <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--separator-color)', fontSize: 'var(--font-size-ui)' }}>
                  <div className="truncate" style={{ color: 'var(--color-text-secondary)' }} title={h.prompt}>{h.prompt}</div>
                  <div style={{ color: 'var(--color-text-dim)', fontSize: 10 }}>{h.created_at ? new Date(h.created_at).toLocaleString() : ''}</div>
                </div>
              ))
            )}
          </div>
        </PanelSection>
      ) : (
        <PanelSection title={t('panels.history.snapshots')} badge={String(snapshots.length)}>
          <div style={{ padding: 4 }}>
            {snapshots.length === 0 ? (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-ui)', padding: 16, textAlign: 'center' }}>{t('history.noSnapshots')}</div>
            ) : (
              snapshots.map((s: any, i: number) => (
                <div key={i} style={{ padding: '4px 8px', borderBottom: '1px solid var(--separator-color)', fontSize: 'var(--font-size-ui)', display: 'flex', alignItems: 'center' }}>
                  <div className="truncate flex-1" style={{ color: 'var(--color-text-secondary)' }}>{s.name}</div>
                  <button onClick={() => restoreSnapshot(s)} className="ps-btn ps-btn--xs" title={t('history.restore')}>{t('history.restore')}</button>
                </div>
              ))
            )}
          </div>
        </PanelSection>
      )}
    </div>
  )
}

export default HistoryPanel