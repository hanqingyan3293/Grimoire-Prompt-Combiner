import React, { useEffect, useState } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useI18n } from '../../i18n/context'

interface HistoryModalProps { onClose: () => void; showToast: (msg: string, type?: string) => void }

const HistoryModal: React.FC<HistoryModalProps> = ({ onClose, showToast }) => {
  const { t } = useI18n()
  const [items, setItems] = useState<any[]>([])
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [tab, setTab] = useState<'history'|'snapshots'>('history')
  useEffect(()=>{loadData()},[tab])
  const loadData = async () => { try { const [h,s]=await Promise.all([window.electronAPI.history.getAll(50),window.electronAPI.snapshots.getAll()]); setItems(h.items||[]); setSnapshots(s.snapshots||[]) } catch {} }
  const hc = async()=>{await window.electronAPI.history.clear();showToast(t('history.clearAll'),'success');await loadData()}
  const hd = async(id:string)=>{await window.electronAPI.history.delete(id);await loadData()}
  const hds = async(id:string)=>{await window.electronAPI.snapshots.delete(id);showToast(t('history.deleted'),'success');await loadData()}
  const hcp = async(item:any)=>{try{await navigator.clipboard.writeText(item.prompt||'');showToast(t('history.copy'),'success')}catch{showToast('Copy failed','error')}}
  const hrs = (snap:any)=>{try{const{positive,negative}=snap.data;const s=usePromptsStore.getState();s.clearPositive();s.clearNegative();if(Array.isArray(positive))positive.forEach((t:any)=>{if(t.tag)s.addPositive(t)});if(Array.isArray(negative))negative.forEach((t:any)=>{if(t.tag)s.addNegative(t)});showToast(t('history.restored')+': '+snap.name,'success');onClose()}catch{showToast('Restore failed','error')}}

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{backgroundColor:'rgba(0,0,0,0.6)'}} onClick={onClose}>
      <div className="w-full max-w-lg mx-4 p-6 rounded-xl max-h-[80vh] flex flex-col" style={{backgroundColor:'var(--color-bg-elevated)',border:'1px solid var(--color-border)'}} onClick={e=>e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4" style={{color:'var(--color-accent)'}}>{t('history.title')}</h2>
        <div className="flex gap-1 mb-4"><button onClick={()=>setTab('history')} className={'btn btn-sm flex-1 '+(tab==='history'?'btn-primary':'')}>{t('history.tabHistory')}</button><button onClick={()=>setTab('snapshots')} className={'btn btn-sm flex-1 '+(tab==='snapshots'?'btn-primary':'')}>{t('history.tabSnapshots')}</button></div>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">{tab==='history'?(items.length===0?<p className="text-center py-8 text-sm" style={{color:'var(--color-text-muted)'}}>{t('history.noHistory')}</p>:items.map(item=>(<div key={item.id} className="p-3 rounded-lg text-sm" style={{backgroundColor:'var(--color-bg-primary)',border:'1px solid var(--color-border)'}}><div className="flex justify-between items-start mb-1"><span className="text-xs" style={{color:'var(--color-text-muted)'}}>{item.created_at}</span><div className="flex gap-1"><button onClick={()=>hcp(item)} className="text-xs px-1.5 py-0.5 rounded" style={{color:'var(--color-accent)',border:'1px solid var(--color-border)'}} title={t('history.copy')}>{t('history.copy')}</button><button onClick={()=>hd(item.id)} className="text-xs px-1.5 py-0.5 rounded" style={{color:'var(--color-danger)',border:'1px solid var(--color-border)'}} title={t('common.del')}>{t('common.del')}</button></div></div><div className="break-all text-xs" style={{color:'var(--color-text-secondary)'}}>{item.prompt?.substring(0,300)}{item.prompt?.length>300?'...':''}</div></div>))):(snapshots.length===0?<p className="text-center py-8 text-sm" style={{color:'var(--color-text-muted)'}}>{t('history.noSnapshots')}</p>:snapshots.map(snap=>(<div key={snap.id} className="flex items-center gap-2 p-3 rounded-lg" style={{backgroundColor:'var(--color-bg-primary)',border:'1px solid var(--color-border)'}}><div className="flex-1 min-w-0"><div className="font-medium text-sm">{snap.name}</div><div className="text-xs" style={{color:'var(--color-text-muted)'}}>{snap.created_at}</div></div><button onClick={()=>hrs(snap)} className="btn btn-sm btn-primary" title={t('history.restore')}>{t('history.restore')}</button><button onClick={()=>hds(snap.id)} className="btn btn-sm btn-danger" title={t('common.del')}>{t('common.del')}</button></div>)))}</div>
        {tab==='history'&&items.length>0&&<button onClick={hc} className="btn btn-sm btn-danger mt-3">{t('history.clearAll')}</button>}
        <button onClick={onClose} className="btn w-full mt-2">{t('common.close')}</button>
      </div>
    </div>
  )
}
export default HistoryModal