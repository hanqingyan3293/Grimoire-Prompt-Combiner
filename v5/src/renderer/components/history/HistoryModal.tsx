import React, { useEffect, useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'

interface HistoryModalProps {
  onClose: () => void
  showToast: (msg: string, type?: string) => void
}

const HistoryModal: React.FC<HistoryModalProps> = ({ onClose, showToast }) => {
  const [items, setItems] = useState<any[]>([])
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [tab, setTab] = useState<'history' | 'snapshots'>('history')

  useEffect(() => { loadData() }, [tab])

  const loadData = async () => {
    try {
      const [h, s] = await Promise.all([window.electronAPI.history.getAll(50), window.electronAPI.snapshots.getAll()])
      setItems(h.items || [])
      setSnapshots(s.snapshots || [])
    } catch {}
  }

  const handleClear = async () => { await window.electronAPI.history.clear(); showToast('Cleared', 'success'); await loadData() }
  const handleDelete = async (id: string) => { await window.electronAPI.history.delete(id); await loadData() }
  const handleDeleteSnap = async (id: string) => { await window.electronAPI.snapshots.delete(id); showToast('Deleted', 'success'); await loadData() }

  const handleCopyHistory = async (item: any) => {
    try { await navigator.clipboard.writeText(item.prompt || ''); showToast('Copied', 'success') }
    catch { showToast('Copy failed', 'error') }
  }

  const handleRestoreSnapshot = (snap: any) => {
    try {
      const { positive, negative } = snap.data
      const store = usePromptsStore.getState()
      store.clearPositive(); store.clearNegative()
      if (Array.isArray(positive)) positive.forEach((t: any) => { if (t.tag) store.addPositive(t) })
      if (Array.isArray(negative)) negative.forEach((t: any) => { if (t.tag) store.addNegative(t) })
      showToast('Restored: ' + snap.name, 'success')
      onClose()
    } catch { showToast('Restore failed', 'error') }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-lg mx-4 p-6 rounded-xl max-h-[80vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-accent)' }}>History & Snapshots</h2>

        <div className="flex gap-1 mb-4">
          <button onClick={() => setTab('history')} className={'btn btn-sm flex-1 ' + (tab==='history'?'btn-primary':'')}>History</button>
          <button onClick={() => setTab('snapshots')} className={'btn btn-sm flex-1 ' + (tab==='snapshots'?'btn-primary':'')}>Snapshots</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
          {tab === 'history' ? (
            items.length===0 ? <p className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>No history</p> :
            items.map(item => (
              <div key={item.id} className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{item.created_at}</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleCopyHistory(item)} className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--color-accent)', border: '1px solid var(--color-border)' }}>Copy</button>
                    <button onClick={() => handleDelete(item.id)} className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--color-danger)', border: '1px solid var(--color-border)' }}>Del</button>
                  </div>
                </div>
                <div className="break-all text-xs" style={{ color: 'var(--color-text-secondary)' }}>{item.prompt?.substring(0, 300)}{item.prompt?.length>300?'...':''}</div>
              </div>
            ))
          ) : (
            snapshots.length===0 ? <p className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>No snapshots</p> :
            snapshots.map(snap => (
              <div key={snap.id} className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
                <div className="flex-1 min-w-0"><div className="font-medium text-sm">{snap.name}</div><div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{snap.created_at}</div></div>
                <button onClick={() => handleRestoreSnapshot(snap)} className="btn btn-sm btn-primary">Restore</button>
                <button onClick={() => handleDeleteSnap(snap.id)} className="btn btn-sm btn-danger">Del</button>
              </div>
            ))
          )}
        </div>

        {tab==='history' && items.length>0 && <button onClick={handleClear} className="btn btn-sm btn-danger mt-3">Clear All</button>}
        <button onClick={onClose} className="btn w-full mt-2">Close</button>
      </div>
    </div>
  )
}

export default HistoryModal